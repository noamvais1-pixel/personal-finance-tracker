// Gemini (free tier) names a category for merchants the keyword rules do not know.
// One request handles up to 40 merchants; results are cached per merchant so each name is asked once.
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import { db, now, setSetting } from './db.js';
import { log } from './config.js';
import { getCredentials, setCredentials, hasCredentials } from './keychain.js';
import { CATEGORY_NAMES, OTHER } from './categories.js';

db.exec(`CREATE TABLE IF NOT EXISTS ai_categories (
  merchant TEXT PRIMARY KEY, category TEXT NOT NULL, created_at TEXT NOT NULL
)`);

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS || 13000);
const BATCH = 40;
const MAX_CALLS_PER_RUN = 4;

export const aiState = { running: false, stage: null, lastResult: null };

export function geminiKey() {
  const k = getCredentials('gemini')?.apiKey;
  if (k) return k;
  // reuse the key the appointment tracker already has on this Mac, once
  try {
    const env = fs.readFileSync('/Users/miriamweiss/Desktop/appointment tracker/.env', 'utf8');
    const m = env.match(/^GEMINI_API_KEY=\s*(\S+)/m);
    if (m) { setCredentials('gemini', { apiKey: m[1] }); return m[1]; }
  } catch {}
  return null;
}
export const hasGemini = () => hasCredentials('gemini') || Boolean(geminiKey());

let lastCall = 0;
async function pace() {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

function allCategoryNames() {
  const custom = db.prepare('SELECT name FROM custom_categories').all().map(r => r.name);
  const hidden = ['חיוב כרטיס אשראי', 'חיוב כרטיס דיירקט', 'כרטיס דיירקט (ללא פירוט)'];
  return [...CATEGORY_NAMES.filter(n => !hidden.includes(n)), ...custom];
}

async function askGemini(key, merchants, categories) {
  const client = new GoogleGenAI({ apiKey: key });
  const system = `אתה מסווג תנועות בנק וכרטיס אשראי בישראל. לכל שם בית עסק בחר בדיוק קטגוריה אחת מהרשימה. אם אין דרך לדעת, בחר "${OTHER}". השם מופיע כפי שהוא בדף הבנק, לעיתים מקוצר. חשוב: "נטו חיסכון", "אושר עד", "יש חסד" הם סופרמרקטים.`;
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { merchant: { type: 'string' }, category: { type: 'string', enum: categories } }, required: ['merchant', 'category'] } } },
    required: ['items'],
  };
  const contents = `קטגוריות אפשריות: ${categories.join(' | ')}\n\nבתי עסק:\n${merchants.map(m => `- ${m}`).join('\n')}`;
  const call = async model => {
    await pace();
    const r = await client.models.generateContent({
      model, contents,
      config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.1, httpOptions: { timeout: 60000 } },
    });
    return JSON.parse(r.text).items || [];
  };
  try { return await call(MODEL); } catch (e) {
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message))) { log('gemini quota on', MODEL, '- trying', FALLBACK); return call(FALLBACK); }
    throw e;
  }
}

/** Categorize merchants still filed under "אחר". Returns counts. */
export async function runAiCategorization({ limitCalls = MAX_CALLS_PER_RUN } = {}) {
  if (aiState.running) return { started: false, reason: 'running' };
  const key = geminiKey();
  if (!key) return { started: false, reason: 'no-key' };
  aiState.running = true;
  aiState.stage = 'אוסף בתי עסק לא מזוהים…';
  let asked = 0, applied = 0, calls = 0, error = null;
  try {
    const rows = db.prepare(`SELECT merchant, MIN(description) AS description, COUNT(*) AS n FROM transactions
      WHERE category_source IN ('none', 'bank', 'ai') AND category = ?
        AND merchant NOT IN (SELECT merchant FROM ai_categories)
        AND merchant NOT IN (SELECT merchant FROM merchant_rules)
      GROUP BY merchant ORDER BY n DESC`).all(OTHER);
    const categories = allCategoryNames();
    const ins = db.prepare('INSERT OR REPLACE INTO ai_categories (merchant, category, created_at) VALUES (?, ?, ?)');
    const upd = db.prepare("UPDATE transactions SET category = ?, category_source = 'ai', updated_at = ? WHERE merchant = ? AND category_source != 'user'");
    for (let i = 0; i < rows.length && calls < limitCalls; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      aiState.stage = `שואל את Gemini על ${batch.length} בתי עסק…`;
      calls++;
      const items = await askGemini(key, batch.map(b => b.description), categories);
      asked += batch.length;
      for (const b of batch) {
        const d = b.description.trim();
        const hit = items.find(it => (it.merchant || '').trim() === d) || items.find(it => it.merchant && d.includes(it.merchant.trim()));
        const cat = hit && categories.includes(hit.category) ? hit.category : OTHER;
        ins.run(b.merchant, cat, now());
        if (cat !== OTHER) applied += upd.run(cat, now(), b.merchant).changes;
      }
    }
    setSetting('lastAiRun', now());
  } catch (e) {
    error = /429|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message)) ? 'המכסה החינמית של Gemini נגמרה להיום. ינסה שוב מחר.' : `Gemini: ${e?.message || e}`;
    log('ai categorization error', e?.message || e);
  } finally {
    aiState.running = false;
    aiState.stage = null;
    aiState.lastResult = { asked, applied, calls, error, at: now() };
  }
  log(`ai categorization: ${asked} merchants asked, ${applied} rows updated${error ? ', error: ' + error : ''}`);
  return { started: true, asked, applied, error };
}

// Apply cached answers to rows imported later (no API call).
export function aiApplyKnown() {
  const r = db.prepare(`UPDATE transactions
    SET category = (SELECT category FROM ai_categories a WHERE a.merchant = transactions.merchant), category_source = 'ai', updated_at = ?
    WHERE category = ? AND category_source IN ('none', 'bank')
      AND merchant IN (SELECT merchant FROM ai_categories WHERE category != ?)`).run(now(), OTHER, OTHER);
  return r.changes;
}
