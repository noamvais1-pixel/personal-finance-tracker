import express from 'express';
import path from 'node:path';
import { db, now, getSetting, setSetting } from './db.js';
import { COMPANIES, PORT, ROOT, log } from './config.js';
import { CATEGORY_NAMES, CATEGORY_ICONS, isExcludedCategory, RULES_VERSION, recategorizeAll } from './categories.js';
import { setCredentials, deleteCredentials, hasCredentials } from './keychain.js';
import { runSync, syncState, approvalState, approveDevice } from './sync.js';
import { aiState, runAiCategorization, hasGemini } from './ai.js';
import { detectRecurring, setRecurringOverride } from './recurring.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public'), { etag: false, maxAge: 0, setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));

const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const monthOk = m => /^\d{4}-\d{2}$/.test(m || '');

function allCategories() {
  const custom = db.prepare('SELECT name, icon FROM custom_categories ORDER BY name').all();
  return [
    ...CATEGORY_NAMES.map(n => ({ name: n, icon: CATEGORY_ICONS[n], excluded: isExcludedCategory(n) })),
    ...custom.map(c => ({ name: c.name, icon: c.icon || '🏷️', excluded: false, custom: true })),
  ];
}

app.get('/api/state', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY kind, account_number').all();
  const futureDebits = db.prepare('SELECT * FROM future_debits ORDER BY charge_date').all();
  const lastOk = db.prepare('SELECT company, MAX(finished_at) AS t, message FROM sync_log WHERE ok = 1 GROUP BY company').all();
  const lastAny = db.prepare('SELECT company, started_at, finished_at, ok, message FROM sync_log WHERE id IN (SELECT MAX(id) FROM sync_log GROUP BY company)').all();
  const counts = db.prepare('SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM transactions').get();
  res.json({
    companies: Object.values(COMPANIES).map(c => ({
      id: c.id, name: c.name, kind: c.kind, fields: c.fields.map(f => ({ key: f.key, label: f.label, type: f.type })),
      configured: hasCredentials(c.id),
      lastOk: lastOk.find(l => l.company === c.id) || null,
      last: lastAny.find(l => l.company === c.id) || null,
    })),
    accounts, futureDebits, counts,
    sync: { ...syncState, companyName: syncState.company ? COMPANIES[syncState.company].name : null },
    approval: { ...approvalState, companyName: approvalState.company ? COMPANIES[approvalState.company].name : null },
    ai: { ...aiState, configured: hasGemini(), lastRun: getSetting('lastAiRun', null),
      unknown: db.prepare("SELECT COUNT(DISTINCT merchant) AS n FROM transactions WHERE category = 'אחר' AND category_source != 'user'").get().n },
    settings: { syncHour: getSetting('syncHour', 7), monthsBack: getSetting('monthsBack', 12) },
    categories: allCategories(),
    month: thisMonth(),
  });
});

// Monthly summary: totals, per-category, per-day, top merchants, plus a 6-month trend.
app.get('/api/summary', (req, res) => {
  const month = monthOk(req.query.month) ? req.query.month : thisMonth();
  const like = month + '%';
  const base = "FROM transactions WHERE excluded = 0 AND date LIKE ?";
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS income,
      COUNT(*) AS count ${base}`).get(like);
  const byCategory = db.prepare(`SELECT category, COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count ${base} AND amount < 0 GROUP BY category ORDER BY total DESC`).all(like);
  const incomeByCategory = db.prepare(`SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count ${base} AND amount > 0 GROUP BY category ORDER BY total DESC`).all(like);
  const byDay = db.prepare(`SELECT date, COALESCE(SUM(-amount), 0) AS total ${base} AND amount < 0 GROUP BY date ORDER BY date`).all(like);
  const topMerchants = db.prepare(`SELECT description, merchant, category, COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count ${base} AND amount < 0 GROUP BY merchant ORDER BY total DESC LIMIT 8`).all(like);
  const largest = db.prepare(`SELECT id, date, description, amount, category, company ${base} AND amount < 0 ORDER BY amount ASC LIMIT 5`).all(like);
  const pending = db.prepare(`SELECT COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count FROM transactions WHERE excluded = 0 AND status = 'pending' AND amount < 0`).get();

  // 6-month trend ending at the selected month
  const [y, m] = month.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const trendRows = db.prepare(`SELECT substr(date, 1, 7) AS ym,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS income
      FROM transactions WHERE excluded = 0 AND substr(date, 1, 7) BETWEEN ? AND ? GROUP BY ym`).all(months[0], months[5]);
  const trend = months.map(ym => ({ month: ym, ...(trendRows.find(r => r.ym === ym) || { expenses: 0, income: 0 }) }));

  // previous month per-category, for the "vs last month" arrows
  const prev = new Date(y, m - 2, 1);
  const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const prevByCategory = db.prepare(`SELECT category, COALESCE(SUM(-amount), 0) AS total ${base} AND amount < 0 GROUP BY category`).all(prevYm + '%');

  // card bill for the selected month (bank-side charge rows), useful as a cross-check
  const cardBill = db.prepare(`SELECT COALESCE(SUM(-amount), 0) AS total FROM transactions WHERE category = 'חיוב כרטיס אשראי' AND date LIKE ?`).get(like);

  res.json({ month, totals, byCategory, incomeByCategory, byDay, topMerchants, largest, pending, trend, prevByCategory, prevMonth: prevYm, cardBill: cardBill.total });
});

app.get('/api/transactions', (req, res) => {
  const where = [];
  const args = [];
  if (monthOk(req.query.month)) { where.push('date LIKE ?'); args.push(req.query.month + '%'); }
  if (req.query.category) { where.push('category = ?'); args.push(req.query.category); }
  if (req.query.company) { where.push('company = ?'); args.push(req.query.company); }
  if (req.query.q) { where.push('(description LIKE ? OR memo LIKE ? OR merchant LIKE ?)'); const q = `%${req.query.q}%`; args.push(q, q, q); }
  if (req.query.kind === 'expense') where.push('amount < 0');
  if (req.query.kind === 'income') where.push('amount > 0');
  if (req.query.kind === 'pending') where.push("status = 'pending'");
  if (req.query.excluded === '0') where.push('excluded = 0');
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const sql = `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, processed_date DESC, rowid DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...args, limit);
  const total = db.prepare(`SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN excluded = 0 THEN amount END), 0) AS net,
      COALESCE(SUM(CASE WHEN excluded = 0 AND amount < 0 THEN -amount END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN excluded = 0 AND amount > 0 THEN amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN excluded = 1 THEN 1 ELSE 0 END), 0) AS excludedCount
    FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args);
  res.json({ rows, total: total.n, net: total.net, expenses: total.expenses, income: total.income, excludedCount: total.excludedCount });
});

// Change a category. With applyToMerchant, every past and future row from the same merchant follows.
app.patch('/api/transactions/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'not found' });
  const category = String(req.body.category || tx.category).trim();
  if (!allCategories().some(c => c.name === category)) return res.status(400).json({ error: 'unknown category' });
  const excluded = req.body.excluded == null ? (isExcludedCategory(category) ? 1 : 0) : (req.body.excluded ? 1 : 0);
  const t = now();
  if (req.body.applyToMerchant) {
    // A rule follows the direction of the row it was made from: income rules never touch expenses and vice versa.
    const direction = tx.amount > 0 ? 'in' : 'out';
    db.prepare('INSERT INTO merchant_rules (merchant, category, excluded, direction, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(merchant) DO UPDATE SET category = excluded.category, excluded = excluded.excluded, direction = excluded.direction')
      .run(tx.merchant, category, excluded, direction, t);
    const r = db.prepare(`UPDATE transactions SET category = ?, excluded = ?, category_source = 'user', updated_at = ? WHERE merchant = ? AND ${direction === 'in' ? 'amount > 0' : 'amount < 0'}`).run(category, excluded, t, tx.merchant);
    return res.json({ ok: true, updated: r.changes });
  }
  db.prepare("UPDATE transactions SET category = ?, excluded = ?, category_source = 'user', updated_at = ? WHERE id = ?").run(category, excluded, t, tx.id);
  res.json({ ok: true, updated: 1 });
});

app.get('/api/merchant-rules', (_req, res) => {
  res.json(db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM transactions t WHERE t.merchant = r.merchant AND (r.direction = 'any' OR (r.direction = 'in' AND t.amount > 0) OR (r.direction = 'out' AND t.amount < 0))) AS count,
      (SELECT description FROM transactions t WHERE t.merchant = r.merchant LIMIT 1) AS example
      FROM merchant_rules r ORDER BY created_at DESC`).all());
});
app.delete('/api/merchant-rules', (req, res) => {
  db.prepare('DELETE FROM merchant_rules WHERE merchant = ?').run(String(req.body.merchant || ''));
  res.json({ ok: true });
});

app.post('/api/categories', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'שם לא תקין' });
  if (allCategories().some(c => c.name === name)) return res.status(400).json({ error: 'הקטגוריה כבר קיימת' });
  db.prepare('INSERT INTO custom_categories (name, icon, created_at) VALUES (?, ?, ?)').run(name, String(req.body.icon || '🏷️').slice(0, 4), now());
  res.json({ ok: true, categories: allCategories() });
});
app.delete('/api/categories/:name', (req, res) => {
  const name = req.params.name;
  db.prepare("UPDATE transactions SET category = 'אחר', category_source = 'none' WHERE category = ?").run(name);
  db.prepare("UPDATE merchant_rules SET category = 'אחר' WHERE category = ?").run(name);
  db.prepare('DELETE FROM custom_categories WHERE name = ?').run(name);
  res.json({ ok: true, categories: allCategories() });
});

// Credentials go straight to the Keychain and are never echoed back.
app.post('/api/credentials/:company', (req, res) => {
  const c = COMPANIES[req.params.company];
  if (!c) return res.status(404).json({ error: 'unknown company' });
  const fields = {};
  for (const f of c.fields) {
    const v = String(req.body?.[f.key] ?? '').trim();
    if (!v) return res.status(400).json({ error: `חסר: ${f.label}` });
    fields[f.key] = v;
  }
  try { setCredentials(c.id, fields); } catch (e) { log('keychain error', e); return res.status(500).json({ error: 'שמירה לצרור המפתחות נכשלה: ' + e.message }); }
  res.json({ ok: true });
});
app.delete('/api/credentials/:company', (req, res) => {
  if (!COMPANIES[req.params.company]) return res.status(404).json({ error: 'unknown company' });
  deleteCredentials(req.params.company);
  res.json({ ok: true });
});

app.post('/api/settings', (req, res) => {
  if (req.body.syncHour != null) setSetting('syncHour', Math.min(23, Math.max(0, Number(req.body.syncHour) || 0)));
  if (req.body.monthsBack != null) setSetting('monthsBack', Math.min(12, Math.max(1, Number(req.body.monthsBack) || 12)));
  res.json({ ok: true, settings: { syncHour: getSetting('syncHour', 7), monthsBack: getSetting('monthsBack', 12) } });
});

app.post('/api/sync', async (req, res) => {
  const companies = Array.isArray(req.body?.companies) ? req.body.companies : undefined;
  const r = await Promise.race([
    runSync({ companies, reason: 'manual' }).then(x => ({ ...x, finished: true })),
    new Promise(resolve => setTimeout(() => resolve({ started: true, finished: false }), 800)),
  ]);
  res.json(r);
});

// One-time "approve this computer": opens a visible Chrome window for the user to log in and type the SMS code.
app.post('/api/approve-device/:company', (req, res) => {
  if (!COMPANIES[req.params.company]) return res.status(404).json({ error: 'unknown company' });
  if (syncState.running || approvalState.running) return res.json({ started: false, reason: 'busy' });
  approveDevice(req.params.company).catch(e => log('approve error', e));
  setTimeout(() => res.json({ started: true }), 500);
});

// Recurring payments (detected automatically; the user can force a merchant in or out).
app.get('/api/recurring', (_req, res) => {
  const r = detectRecurring();
  const name = c => COMPANIES[c]?.name || c;
  res.json({ ...r, expenses: r.expenses.map(x => ({ ...x, companyName: name(x.company) })), income: r.income.map(x => ({ ...x, companyName: name(x.company) })), installments: r.installments.map(x => ({ ...x, companyName: name(x.company) })) });
});
app.post('/api/recurring/override', (req, res) => {
  const { merchant, direction, state } = req.body || {};
  if (!merchant || !['in', 'out'].includes(direction) || !['yes', 'no', null, ''].includes(state ?? null)) return res.status(400).json({ error: 'bad request' });
  setRecurringOverride(String(merchant), direction, state || null);
  res.json({ ok: true });
});

// Gemini: key lives in the Keychain like the bank logins; the run happens in the background.
app.post('/api/ai/key', (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  if (!apiKey) return res.status(400).json({ error: 'חסר מפתח' });
  try { setCredentials('gemini', { apiKey }); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true });
});
app.delete('/api/ai/key', (_req, res) => { deleteCredentials('gemini'); res.json({ ok: true }); });
app.post('/api/ai/run', (_req, res) => {
  if (!hasGemini()) return res.json({ started: false, reason: 'no-key' });
  if (aiState.running) return res.json({ started: false, reason: 'running' });
  runAiCategorization().catch(e => log('ai run error', e));
  setTimeout(() => res.json({ started: true }), 300);
});

app.get('/api/sync-log', (_req, res) => {
  res.json(db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 30').all().map(r => ({ ...r, companyName: COMPANIES[r.company]?.name || r.company })));
});

// Excel-friendly CSV (UTF-8 with BOM so Hebrew opens correctly).
app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT date, processed_date, company, account_number, description, memo, amount, category, status, installment_number, installment_total FROM transactions ${monthOk(req.query.month) ? "WHERE date LIKE '" + req.query.month + "%'" : ''} ORDER BY date DESC`).all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['תאריך', 'תאריך חיוב', 'מקור', 'חשבון/כרטיס', 'תיאור', 'הערה', 'סכום', 'קטגוריה', 'סטטוס', 'תשלום מספר', 'מתוך'];
  const lines = [head.map(esc).join(','), ...rows.map(r => [r.date, r.processed_date, COMPANIES[r.company]?.name || r.company, r.account_number, r.description, r.memo, r.amount, r.category, r.status === 'pending' ? 'ממתין' : 'בוצע', r.installment_number, r.installment_total].map(esc).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${req.query.month || 'all'}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

app.post('/api/quit', (_req, res) => {
  res.json({ ok: true });
  log('quit requested from dashboard');
  setTimeout(() => process.exit(0), 300);
});

if (getSetting('rulesVersion', 0) !== RULES_VERSION) {
  const n = recategorizeAll(db);
  setSetting('rulesVersion', RULES_VERSION);
  log(`category rules updated to v${RULES_VERSION}: ${n} rows re-categorized`);
}

export function startServer() {
  return new Promise(resolve => {
    const srv = app.listen(PORT, '127.0.0.1', () => { log(`dashboard: http://localhost:${PORT}`); resolve(srv); });
  });
}
