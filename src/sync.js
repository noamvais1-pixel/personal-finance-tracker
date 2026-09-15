// Logs into each configured institution (one at a time), pulls transactions and balances,
// and stores them locally. Never runs two syncs at once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import puppeteer from 'puppeteer';
import { createScraper } from 'israeli-bank-scrapers';
import { db, now, getSetting, setSetting } from './db.js';
import { COMPANIES, DATA_DIR, log } from './config.js';
import { getCredentials, hasCredentials } from './keychain.js';
import { categorize, normalizeMerchant } from './categories.js';

export const syncState = {
  running: false,
  company: null,
  stage: null,          // Hebrew text shown in the dashboard
  startedAt: null,
  results: [],          // per-company results of the last run
  lastError: null,
};

const STAGE_TEXT = {
  INITIALIZING: 'מכין את הדפדפן…',
  START_SCRAPING: 'מתחיל לקרוא נתונים…',
  LOGGING_IN: 'מתחבר לאתר…',
  LOGIN_SUCCESS: 'ההתחברות הצליחה, קורא תנועות…',
  LOGIN_FAILED: 'ההתחברות נכשלה',
  CHANGE_PASSWORD: 'האתר מבקש להחליף סיסמה',
  END_SCRAPING: 'מסיים…',
  TERMINATING: 'סוגר את הדפדפן…',
};

const ERROR_TEXT = {
  INVALID_PASSWORD: 'שם המשתמש או הסיסמה לא נכונים. לבדוק בהגדרות.',
  CHANGE_PASSWORD: 'האתר דורש להחליף סיסמה. להיכנס לאתר הבנק/החברה מהדפדפן, להחליף, ולעדכן כאן בהגדרות.',
  ACCOUNT_BLOCKED: 'החשבון נחסם באתר. לפנות לבנק/לחברה.',
  TIMEOUT: 'ההתחברות לא הושלמה. אם האתר מבקש קוד אימות ב-SMS, יש ללחוץ על "אישור המחשב הזה" בהגדרות. אחרת לבדוק את שם המשתמש והסיסמה.',
  TWO_FACTOR_RETRIEVER_MISSING: 'האתר דורש קוד אימות, והתוכנה עדיין לא תומכת בזה עבור מוסד זה.',
  GENERIC: 'שגיאה כללית באתר. לנסות שוב מאוחר יותר.',
  GENERAL_ERROR: 'שגיאה כללית. לנסות שוב מאוחר יותר.',
};

function isoDay(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function systemChrome() {
  const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return fs.existsSync(p) ? p : undefined;
}

// One Chrome profile per institution. After the user approves this computer once (SMS code),
// the bank's "known device" cookie lives here and headless syncs are not asked again.
export function profileDir(companyId) {
  const dir = `${DATA_DIR}/chrome-profile-${companyId}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function launchBrowser(companyId, { visible = false } = {}) {
  const browser = await puppeteer.launch({
    headless: !visible,
    executablePath: process.env.USE_BUNDLED_CHROME === '1' ? undefined : systemChrome(),
    userDataDir: profileDir(companyId),
    defaultViewport: visible ? null : { width: 1280, height: 900 },
    args: ['--lang=he-IL', '--no-first-run', '--no-default-browser-check', visible ? '--window-size=1100,820' : '--window-size=1280,900'],
  });
  // Headless Chrome announces itself as "HeadlessChrome"; keep the same identity the user approved with.
  const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
  return { browser, ua };
}

export const LOGIN_PAGES = {
  hapoalim: { url: 'https://login.bankhapoalim.co.il/cgi-bin/poalwwwc?reqName=getLogonPage', success: /homepage/i },
  max: { url: 'https://www.max.co.il/login', success: /max\.co\.il\/(homepage|personal|dashboard|home)/i },
};

export const approvalState = { running: false, company: null, stage: null, startedAt: null, lastResult: null };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Opens a visible Chrome window on the institution's login page using the persistent profile.
 * The user logs in and types the SMS code herself; once the site reaches its home page we close
 * the window and the profile keeps the "known device" state. Then a normal sync runs.
 */
export async function approveDevice(companyId) {
  if (!COMPANIES[companyId] || !LOGIN_PAGES[companyId]) return { started: false, reason: 'unknown' };
  if (syncState.running || approvalState.running) return { started: false, reason: 'busy' };
  approvalState.running = true;
  approvalState.company = companyId;
  approvalState.startedAt = now();
  approvalState.lastResult = null;
  approvalState.stage = 'פותח חלון דפדפן…';
  let browser;
  let ok = false;
  try {
    ({ browser } = await launchBrowser(companyId, { visible: true }));
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(LOGIN_PAGES[companyId].url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    approvalState.stage = 'נפתח חלון של האתר. יש להתחבר שם כרגיל ולהקליד את קוד ה-SMS. כשמגיעים לדף הבית, החלון ייסגר לבד.';
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      if (!browser.connected) break;                       // the user closed the window
      let url = '';
      try { url = page.url(); } catch { break; }
      if (LOGIN_PAGES[companyId].success.test(url)) { ok = true; break; }
      await sleep(1500);
    }
    if (ok) {
      approvalState.stage = 'ההתחברות הצליחה! שומר את האישור וסוגר את החלון…';
      await sleep(5000);                                   // let the site finish writing its cookies
    }
  } catch (e) {
    log('approveDevice error', e?.stack || e);
  } finally {
    try { await browser?.close(); } catch {}
    approvalState.running = false;
    approvalState.company = null;
    approvalState.stage = null;
    approvalState.lastResult = { company: companyId, ok, at: now() };
  }
  log(`approveDevice ${companyId}: ${ok ? 'ok' : 'not completed'}`);
  if (ok) runSync({ companies: [companyId], reason: 'after-approval' }).catch(e => log('post-approval sync error', e));
  return { started: true, ok };
}

function startDateFor(companyId) {
  const months = Number(getSetting('monthsBack', 12));
  const last = db.prepare('SELECT MAX(finished_at) AS t FROM sync_log WHERE company = ? AND ok = 1').get(companyId)?.t;
  const d = new Date();
  if (last) {
    // Re-read the last 45 days so pending rows settle and late postings are picked up.
    d.setDate(d.getDate() - 45);
  } else {
    d.setMonth(d.getMonth() - months);
  }
  return d;
}

function userRules() {
  const map = new Map();
  for (const r of db.prepare('SELECT merchant, category, excluded, direction FROM merchant_rules').all()) map.set(r.merchant, r);
  return map;
}

const insertTx = db.prepare(`
  INSERT INTO transactions (id, company, account_number, date, processed_date, amount, original_amount, original_currency,
    description, merchant, memo, status, type, installment_number, installment_total, bank_category,
    category, category_source, excluded, created_at, updated_at)
  VALUES (@id, @company, @account_number, @date, @processed_date, @amount, @original_amount, @original_currency,
    @description, @merchant, @memo, @status, @type, @installment_number, @installment_total, @bank_category,
    @category, @category_source, @excluded, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    processed_date = excluded.processed_date,
    status = excluded.status,
    memo = COALESCE(excluded.memo, transactions.memo),
    bank_category = COALESCE(excluded.bank_category, transactions.bank_category),
    installment_number = excluded.installment_number,
    installment_total = excluded.installment_total,
    updated_at = excluded.updated_at
`);

function storeAccount(companyId, kind, acc, seenIds) {
  const accountId = `${companyId}|${acc.accountNumber}`;
  db.prepare(`INSERT INTO accounts (id, company, account_number, kind, balance, balance_date, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET balance = COALESCE(excluded.balance, accounts.balance),
      balance_date = COALESCE(excluded.balance_date, accounts.balance_date), currency = COALESCE(excluded.currency, accounts.currency), updated_at = excluded.updated_at`)
    .run(accountId, companyId, String(acc.accountNumber), kind, acc.balance ?? null, isoDay(acc.balanceDate), acc.currency ?? 'ILS', now());

  const rules = userRules();
  const counter = new Map();
  let added = 0;
  const t = now();
  for (const tx of acc.txns || []) {
    const date = isoDay(tx.date);
    if (!date) continue;
    const description = String(tx.description || '').trim() || '(ללא תיאור)';
    const merchant = normalizeMerchant(description) || description.toLowerCase();
    const amount = Number(tx.chargedAmount ?? tx.originalAmount ?? 0);
    const baseKey = `${companyId}|${acc.accountNumber}|${date}|${amount.toFixed(2)}|${merchant}`;
    const n = (counter.get(baseKey) || 0) + 1;
    counter.set(baseKey, n);
    const id = crypto.createHash('sha1').update(`${baseKey}#${n}`).digest('hex').slice(0, 20);
    seenIds.add(id);
    const cat = categorize({ merchant, description, amount, company: companyId, kind, bankCategory: tx.category }, rules.get(merchant));
    const r = insertTx.run({
      id, company: companyId, account_number: String(acc.accountNumber), date, processed_date: isoDay(tx.processedDate) || date,
      amount, original_amount: tx.originalAmount ?? null, original_currency: tx.originalCurrency ?? null,
      description, merchant, memo: tx.memo || null, status: tx.status || 'completed', type: tx.type || 'normal',
      installment_number: tx.installments?.number ?? null, installment_total: tx.installments?.total ?? null,
      bank_category: tx.category || null, category: cat.category, category_source: cat.source, excluded: cat.excluded,
      created_at: t, updated_at: t,
    });
    // sqlite reports 1 change for both insert and update; detect a real insert via created_at
    if (db.prepare('SELECT created_at FROM transactions WHERE id = ?').get(id)?.created_at === t) added++;
  }
  return added;
}

function dropVanishedPending(companyId, sinceDate, seenIds) {
  // A pending row that no longer appears in a fresh read was cancelled or re-posted with different details.
  const rows = db.prepare("SELECT id FROM transactions WHERE company = ? AND status = 'pending' AND date >= ?").all(companyId, sinceDate);
  const del = db.prepare('DELETE FROM transactions WHERE id = ?');
  let n = 0;
  for (const r of rows) if (!seenIds.has(r.id)) { del.run(r.id); n++; }
  return n;
}

// ---- Bank Hapoalim: bank-issued "Direct" debit card ----
// The account feed only shows a daily total ("דירקט- מצטבר"). The bank's card API lists each purchase
// with the merchant name, so we read it in the same logged-in session and hide the daily totals.
const HP = 'https://login.bankhapoalim.co.il';
const ymd = s => (s && /^\d{8}$/.test(String(s)) ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6, 8)}` : null);

async function pageGetJson(page, url) {
  const r = await page.evaluate(async u => {
    const res = await fetch(u, { credentials: 'include' });
    const text = await res.text();
    return { status: res.status, text };
  }, url);
  if (r.status === 204 || !r.text) return null;
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url.split('?')[0]}`);
  return JSON.parse(r.text);
}

async function fetchHapoalimCards(page, accountNumber) {
  const cards = [];   // { suffix, name, txns: [], totals: [{debitDate, amount}] }
  const q = { accountId: accountNumber, lang: 'he' };
  const qs = o => new URLSearchParams({ ...q, ...o }).toString();
  const totals = await pageGetJson(page, `${HP}/ServerServices/cards/transactions-totals?${qs({ transactionsType: 'current', totalCurrencyDebitDate: 'true' })}`);
  const periods = [{ type: 'current', data: totals }];
  // earlier billing months, when the bank lists any (each is one request; empty months come back as 204)
  const months = (totals?.debitDateList || []).map(d => d.debitMonth).filter(Boolean).slice(1, 4);
  for (const m of months) {
    try {
      const prev = await pageGetJson(page, `${HP}/ServerServices/cards/transactions-totals?${qs({ transactionsType: 'previous', totalCurrencyDebitDate: 'true', debitDate: m })}`);
      if (prev?.cards?.length) periods.push({ type: 'previous', data: prev });
    } catch (e) { log('hapoalim cards: previous month', m, 'skipped:', e.message); }
  }
  for (const { type, data } of periods) {
    for (const c of data?.cards || []) {
      const id = c.cardIdentification || {};
      if (id.nonBankCardInd) continue;
      let card = cards.find(x => x.suffix === id.cardSuffix);
      if (!card) { card = { suffix: id.cardSuffix, name: id.cardVendorProductName || 'כרטיס', txns: [], totals: [] }; cards.push(card); }
      const dates = (c.cardBookedBalances?.nationalTransactionsTotal || []).map(t => ({ debitDate: t.debitDate, amount: t.currentAmount }));
      for (const d of dates) {
        card.totals.push({ debitDate: ymd(d.debitDate), amount: d.amount });
        const url = `${HP}/ServerServices/cards/transactions?${qs({ cardSuffix: id.cardSuffix, cardIssuingSPCode: id.cardIssuingSPCode, cardIdServiceProvider: id.cardIdServiceProvider, cardIdHapoalim: id.cardIdHapoalim, transactionsType: type, totalInd: '1', debitDate: d.debitDate, eventCurrencyDescription: 'NIS', debitEventOrigin: '1', offset: '0', limit: '200' })}`;
        const detail = await pageGetJson(page, url);
        for (const group of detail?.card?.nationalTransactions || []) {
          for (const t of group.transactionsDetails || []) {
            const amt = Number(t.currencyAmount?.amount ?? t.originalAmount ?? 0);
            const credit = /זיכוי|החזר|ביטול/.test(t.creditTransactionType || '');
            card.txns.push({
              type: t.paymentsNumber > 1 ? 'installments' : 'normal',
              identifier: t.transactionIndexNumber || t.transactionRreferance || undefined,
              date: ymd(t.eventDate) || ymd(group.transactionsTotal?.debitDate),
              processedDate: ymd(t.debitDate) || ymd(group.transactionsTotal?.debitDate),
              originalAmount: credit ? amt : -amt,
              originalCurrency: 'ILS',
              chargedAmount: credit ? amt : -amt,
              description: t.merchantDetails?.merchantName?.trim() || t.creditTransactionType || 'דירקט',
              memo: t.comment || null,
              status: 'completed',
              installments: t.paymentsNumber > 1 ? { number: t.paymentNumber, total: t.paymentsNumber } : undefined,
              category: t.merchantDetails?.merchantCategoryDescription || undefined,
            });
          }
        }
      }
    }
  }
  return cards;
}

// Hide the bank-feed daily totals that are now covered by itemized card purchases (matched by amount and date).
function reconcileDirectRows(companyId, accountNumber, cards) {
  const rows = db.prepare("SELECT id, date, amount FROM transactions WHERE company = ? AND account_number = ? AND (merchant LIKE 'דירקט%' OR merchant LIKE 'דיירקט%') AND category_source != 'user'").all(companyId, accountNumber);
  const upd = db.prepare("UPDATE transactions SET category = 'חיוב כרטיס דיירקט', excluded = 1, category_source = 'rule', updated_at = ? WHERE id = ?");
  const near = (a, b) => Math.abs(a - b) < 0.011;
  const within = (bankDate, debitDate) => { const d = (new Date(debitDate) - new Date(bankDate)) / 86400000; return d >= -1 && d <= 4; };
  let n = 0;
  for (const r of rows) {
    const amt = -r.amount;
    const hit = cards.some(c => c.totals.some(t => near(t.amount, amt) && within(r.date, t.debitDate)))
      || cards.some(c => c.txns.some(t => near(-t.chargedAmount, amt) && within(r.date, t.processedDate)));
    if (hit) n += upd.run(now(), r.id).changes;
  }
  return n;
}

async function syncCompany(companyId, { onStage } = {}) {
  const company = COMPANIES[companyId];
  const creds = getCredentials(companyId);
  if (!creds) return { company: companyId, ok: false, message: 'לא הוגדרו פרטי התחברות' };

  const startDate = startDateFor(companyId);
  const logId = db.prepare('INSERT INTO sync_log (company, started_at) VALUES (?, ?)').run(companyId, now()).lastInsertRowid;
  let result;
  let browser;
  try {
    // Our own browser: installed Google Chrome (the puppeteer download on this Mac is incomplete)
    // with the per-institution profile that holds the "known device" approval.
    let ua;
    ({ browser, ua } = await launchBrowser(companyId));
    const options = {
      companyId,
      startDate,
      browser,
      combineInstallments: false,
      defaultTimeout: 90_000,
      timeout: 90_000,
      navigationRetryCount: 1,
      futureMonthsToScrape: 1,
      additionalTransactionInformation: false,
      storeFailureScreenShotPath: `${DATA_DIR}/last-failure-${companyId}.png`,
      preparePage: async page => { await page.setUserAgent(ua); },
      skipCloseBrowser: true,   // we close it ourselves, after reading the page on failure
    };
    const scraper = createScraper(options);
    scraper.onProgress((_c, { type }) => onStage?.(STAGE_TEXT[type] || type));
    result = await Promise.race([
      scraper.scrape(creds),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 8 * 60_000)),
    ]);
  } catch (e) {
    try { await browser?.close(); } catch {}
    const msg = /TIMEOUT/.test(String(e?.message)) ? ERROR_TEXT.TIMEOUT : `תקלה טכנית: ${e?.message || e}`;
    log(`sync ${companyId} crashed:`, e?.stack || e);
    db.prepare('UPDATE sync_log SET finished_at = ?, ok = 0, message = ? WHERE id = ?').run(now(), msg, logId);
    return { company: companyId, ok: false, message: msg };
  }

  // Extra step for Hapoalim: itemized Direct-card purchases from the still-open session.
  let cardAccounts = [];
  if (companyId === 'hapoalim') {
    try {
      if (result.success) {
        onStage?.('קורא את פירוט כרטיס הדיירקט…');
        const pages = await browser.pages();
        const page = pages[pages.length - 1];
        // fetch() only works from a page on the bank's own origin
        if (!page.url().startsWith(HP)) await page.goto(`${HP}/ng-portals/rb/he/homepage`, { waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
        else await page.goto(`${HP}/ng-portals/rb/he/homepage`, { waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
        for (const acc of result.accounts || []) {
          const cards = await fetchHapoalimCards(page, acc.accountNumber);
          for (const c of cards) cardAccounts.push({ bankAccount: acc.accountNumber, cards: [c], account: { accountNumber: `דירקט ${c.suffix}`, txns: c.txns, currency: 'ILS' } });
        }
        log(`hapoalim cards: ${cardAccounts.reduce((s, x) => s + x.account.txns.length, 0)} itemized purchases`);
      }
    } catch (e) {
      log('hapoalim cards failed (daily totals stay counted):', e?.message || e);
    }
  }

  // On failure, read what the site actually shows, so the message is accurate (wrong password vs. SMS code).
  let pageHint = null;
  if (!result.success) {
    try {
      const pages = await browser.pages();
      const page = pages[pages.length - 1];
      const text = await page.evaluate(() => document.body?.innerText || '');
      if (/שכחת את הפרטים|פרטים שגויים|שם משתמש או סיסמה|הפרטים שהוזנו|אינם נכונים|לא נכונים|שגוי/.test(text)) pageHint = 'INVALID_PASSWORD';
      else if (/קוד אימות|קוד האימות|SMS|מסרון|כניסה חדשה ממחשב זה|OTP/.test(text)) pageHint = 'OTP';
      else if (/החלפת סיסמה|להחליף סיסמה|פג תוקף/.test(text)) pageHint = 'CHANGE_PASSWORD';
    } catch {}
  }
  try { await browser.close(); } catch {}

  if (!result.success) {
    let msg = ERROR_TEXT[result.errorType] || `${result.errorType || ''} ${result.errorMessage || ''}`.trim() || 'שגיאה לא ידועה';
    if (pageHint === 'INVALID_PASSWORD') msg = ERROR_TEXT.INVALID_PASSWORD;
    else if (pageHint === 'OTP') msg = 'האתר ביקש קוד אימות ב-SMS. יש ללחוץ על "אישור המחשב הזה" בהגדרות ולהקליד את הקוד פעם אחת.';
    else if (pageHint === 'CHANGE_PASSWORD') msg = ERROR_TEXT.CHANGE_PASSWORD;
    log(`sync ${companyId} failed:`, result.errorType, result.errorMessage);
    db.prepare('UPDATE sync_log SET finished_at = ?, ok = 0, message = ? WHERE id = ?').run(now(), msg, logId);
    return { company: companyId, ok: false, errorType: result.errorType, message: msg };
  }

  onStage?.('שומר תנועות…');
  const seen = new Set();
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const acc of result.accounts || []) added += storeAccount(companyId, company.kind, acc, seen);
    dropVanishedPending(companyId, startDate.toISOString().slice(0, 10), seen);
    for (const ca of cardAccounts) {
      const cardSeen = new Set();
      added += storeAccount(companyId, 'card', ca.account, cardSeen);
      const hidden = reconcileDirectRows(companyId, ca.bankAccount, ca.cards);
      if (hidden) log(`hapoalim cards: ${hidden} daily totals hidden`);
    }
    db.prepare('DELETE FROM future_debits WHERE company = ?').run(companyId);
    for (const fd of result.futureDebits || []) {
      db.prepare('INSERT INTO future_debits (company, charge_date, amount, currency, account_number, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(companyId, isoDay(fd.chargeDate), fd.amount, fd.amountCurrency || 'ILS', fd.bankAccountNumber || null, now());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const total = (result.accounts || []).reduce((s, a) => s + (a.txns?.length || 0), 0);
  const msg = `נקראו ${total} תנועות, ${added} חדשות`;
  db.prepare('UPDATE sync_log SET finished_at = ?, ok = 1, message = ?, new_count = ? WHERE id = ?').run(now(), msg, added, logId);
  log(`sync ${companyId}: ${msg}`);
  return { company: companyId, ok: true, added, total, message: msg };
}

function notify(title, body) {
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
}

export function configuredCompanies() {
  return Object.keys(COMPANIES).filter(hasCredentials);
}

export async function runSync({ companies, reason = 'manual' } = {}) {
  if (syncState.running || approvalState.running) return { started: false, reason: 'already-running' };
  const list = (companies?.length ? companies : configuredCompanies()).filter(c => COMPANIES[c]);
  if (!list.length) return { started: false, reason: 'no-credentials' };

  syncState.running = true;
  syncState.startedAt = now();
  syncState.results = [];
  syncState.lastError = null;
  const awake = spawn('caffeinate', ['-i'], { stdio: 'ignore' });
  log(`sync started (${reason}):`, list.join(', '));
  try {
    for (const c of list) {
      syncState.company = c;
      syncState.stage = 'מתחיל…';
      const r = await syncCompany(c, { onStage: s => { syncState.stage = s; } });
      syncState.results.push(r);
    }
  } finally {
    awake.kill();
    syncState.running = false;
    syncState.company = null;
    syncState.stage = null;
    setSetting('lastSyncFinished', now());
  }
  const okOnes = syncState.results.filter(r => r.ok);
  const added = okOnes.reduce((s, r) => s + (r.added || 0), 0);
  // name the stores the rules did not recognize (cached answers first, then Gemini in the background)
  try {
    const { aiApplyKnown, runAiCategorization, hasGemini } = await import('./ai.js');
    aiApplyKnown();
    if (added && hasGemini()) runAiCategorization().catch(e => log('ai after sync failed', e?.message || e));
  } catch (e) { log('ai module error', e?.message || e); }
  const failed = syncState.results.filter(r => !r.ok);
  if (failed.length) notify('מעקב כספים', `הסנכרון של ${failed.map(f => COMPANIES[f.company].name).join(' ו')} נכשל: ${failed[0].message}`);
  else if (reason !== 'manual' && added) notify('מעקב כספים', `נוספו ${added} תנועות חדשות`);
  return { started: true, results: syncState.results };
}
