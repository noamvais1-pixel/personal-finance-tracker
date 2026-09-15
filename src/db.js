import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,            -- company|accountNumber
  company TEXT NOT NULL,
  account_number TEXT NOT NULL,
  kind TEXT NOT NULL,             -- bank | card
  label TEXT,
  balance REAL,
  balance_date TEXT,
  currency TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  account_number TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD (purchase date)
  processed_date TEXT,            -- YYYY-MM-DD (charge date)
  amount REAL NOT NULL,           -- ILS, negative = expense
  original_amount REAL,
  original_currency TEXT,
  description TEXT NOT NULL,
  merchant TEXT NOT NULL,         -- normalized description used for rules
  memo TEXT,
  status TEXT NOT NULL,           -- completed | pending
  type TEXT,
  installment_number INTEGER,
  installment_total INTEGER,
  bank_category TEXT,             -- category as reported by the institution (Max gives one)
  category TEXT NOT NULL,
  category_source TEXT NOT NULL,  -- user | rule | bank | none
  excluded INTEGER NOT NULL DEFAULT 0, -- 1 = not counted as income/expense (card bill, own transfers)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_merchant ON transactions(merchant);
CREATE TABLE IF NOT EXISTS merchant_rules (
  merchant TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_categories (
  name TEXT PRIMARY KEY,
  icon TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS future_debits (
  company TEXT NOT NULL,
  charge_date TEXT,
  amount REAL NOT NULL,
  currency TEXT,
  account_number TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  message TEXT,
  new_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// migrations
const ruleCols = db.prepare('PRAGMA table_info(merchant_rules)').all().map(c => c.name);
if (!ruleCols.includes('direction')) db.exec("ALTER TABLE merchant_rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any'"); // in | out | any

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
