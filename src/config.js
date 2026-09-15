import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.FINANCE_DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'finance.sqlite');
export const LOG_PATH = path.join(DATA_DIR, 'finance.log');
export const PORT = Number(process.env.PORT || 3124);
export const KEYCHAIN_SERVICE = 'finance-tracker';

// The two institutions this copy is set up for. Adding another later means adding a row here.
export const COMPANIES = {
  hapoalim: {
    id: 'hapoalim',
    name: 'בנק הפועלים',
    kind: 'bank',
    fields: [
      { key: 'userCode', label: 'קוד משתמש', type: 'text' },
      { key: 'password', label: 'סיסמה', type: 'password' },
    ],
  },
  max: {
    id: 'max',
    name: 'מקס (Max)',
    kind: 'card',
    fields: [
      { key: 'username', label: 'שם משתמש', type: 'text' },
      { key: 'password', label: 'סיסמה', type: 'password' },
    ],
  },
};

export function log(...parts) {
  const line = `[${new Date().toLocaleString('he-IL', { hour12: false })}] ${parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
}
