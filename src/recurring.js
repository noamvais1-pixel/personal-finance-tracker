// Finds charges that repeat: same merchant, similar amount, regular gap between dates.
// The user can force a merchant in or out of the list (recurring_overrides).
import { db, now } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS recurring_overrides (
  merchant TEXT NOT NULL, direction TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (merchant, direction)
)`);

const SKIP_CATEGORIES = new Set(['חיוב כרטיס אשראי', 'חיוב כרטיס דיירקט', 'כרטיס דיירקט (ללא פירוט)', 'מזומן']);
const GENERIC = /^(העברה|העב'? לאחר-נייד|העברה-נייד|העברה מיידית|זיכוי|שיק|bit העברת כסף|העברה\/הפקדה.*)$/;

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const median = arr => { const s = [...arr].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function cadence(gapDays) {
  if (gapDays >= 5 && gapDays <= 9) return { key: 'weekly', label: 'שבועי', perMonth: 4.33 };
  if (gapDays >= 12 && gapDays <= 16) return { key: 'biweekly', label: 'דו-שבועי', perMonth: 2.17 };
  if (gapDays >= 24 && gapDays <= 38) return { key: 'monthly', label: 'חודשי', perMonth: 1 };
  if (gapDays >= 55 && gapDays <= 70) return { key: 'bimonthly', label: 'דו-חודשי', perMonth: 0.5 };
  if (gapDays >= 80 && gapDays <= 100) return { key: 'quarterly', label: 'רבעוני', perMonth: 1 / 3 };
  if (gapDays >= 170 && gapDays <= 200) return { key: 'halfyear', label: 'חצי-שנתי', perMonth: 1 / 6 };
  if (gapDays >= 340 && gapDays <= 390) return { key: 'yearly', label: 'שנתי', perMonth: 1 / 12 };
  return null;
}

export function setRecurringOverride(merchant, direction, state) {
  if (!state) return db.prepare('DELETE FROM recurring_overrides WHERE merchant = ? AND direction = ?').run(merchant, direction);
  db.prepare('INSERT INTO recurring_overrides (merchant, direction, state, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(merchant, direction) DO UPDATE SET state = excluded.state').run(merchant, direction, state, now());
}

export function detectRecurring() {
  const rows = db.prepare(`SELECT merchant, description, date, amount, category, company, account_number, installment_number, installment_total, status
    FROM transactions WHERE excluded = 0 AND status = 'completed' ORDER BY merchant, date`).all();
  const overrides = new Map(db.prepare('SELECT * FROM recurring_overrides').all().map(o => [o.merchant + '|' + o.direction, o.state]));
  const today = new Date().toLocaleDateString('en-CA');

  // installment plans are their own section
  const plans = new Map();
  for (const r of rows) {
    if (!r.installment_total || r.installment_total < 2) continue;
    const key = `${r.merchant}|${r.installment_total}|${Math.abs(r.amount).toFixed(0)}`;
    const p = plans.get(key) || { merchant: r.merchant, description: r.description, category: r.category, company: r.company, amount: Math.abs(r.amount), total: r.installment_total, paid: 0, lastNumber: 0, lastDate: null, firstDate: r.date };
    p.paid = Math.max(p.paid, r.installment_number || 0); p.lastNumber = Math.max(p.lastNumber, r.installment_number || 0);
    if (!p.lastDate || r.date > p.lastDate) p.lastDate = r.date;
    if (r.date < p.firstDate) p.firstDate = r.date;
    plans.set(key, p);
  }
  const installments = [...plans.values()].filter(p => p.lastNumber < p.total).map(p => {
    const remaining = p.total - p.lastNumber;
    const end = new Date(p.lastDate); end.setMonth(end.getMonth() + remaining);
    return { ...p, remaining, remainingAmount: remaining * p.amount, endDate: end.toLocaleDateString('en-CA') };
  }).sort((a, b) => b.remainingAmount - a.remainingAmount);

  // group non-installment rows by merchant + direction
  const groups = new Map();
  for (const r of rows) {
    if (r.installment_total && r.installment_total > 1) continue;
    if (SKIP_CATEGORIES.has(r.category)) continue;
    const direction = r.amount > 0 ? 'in' : 'out';
    const key = r.merchant + '|' + direction;
    if (!groups.has(key)) groups.set(key, { merchant: r.merchant, direction, items: [] });
    groups.get(key).items.push(r);
  }

  const result = [];
  for (const g of groups.values()) {
    const ov = overrides.get(g.merchant + '|' + g.direction);
    if (ov === 'no') continue;
    // one row per day (a daily total can be split), then look at gaps and amounts
    const byDay = new Map();
    for (const it of g.items) byDay.set(it.date, (byDay.get(it.date) || 0) + Math.abs(it.amount));
    const dates = [...byDay.keys()].sort();
    const amounts = dates.map(d => byDay.get(d));
    const last = g.items[g.items.length - 1];
    const medAmt = median(amounts);
    let cad = null, gap = null, score = 0;
    if (dates.length >= 2) {
      const gaps = dates.slice(1).map((d, i) => days(dates[i], d)).filter(x => x > 2);
      if (gaps.length) {
        gap = median(gaps);
        cad = cadence(gap);
        const regular = gaps.filter(x => Math.abs(x - gap) <= Math.max(4, gap * 0.2)).length / gaps.length;
        const similar = amounts.filter(a => Math.abs(a - medAmt) <= Math.max(3, medAmt * 0.15)).length / amounts.length;
        score = (cad ? 1 : 0) + regular + similar;
        const generic = GENERIC.test(g.merchant);
        const minCount = generic || (cad && cad.perMonth > 1) ? 3 : 2;   // weekly patterns need more proof
        const ended = days(dates[dates.length - 1], today) > gap * 2.5 + 7;   // stopped a while ago
        const ok = ov === 'yes' || (cad && regular >= 0.6 && similar >= (generic ? 0.8 : 0.5) && dates.length >= minCount && medAmt >= 5 && !ended);
        if (!ok) continue;
      } else if (ov !== 'yes') continue;
    } else if (ov !== 'yes') continue;

    const nextDate = gap ? new Date(new Date(dates[dates.length - 1]).getTime() + gap * 86400000).toLocaleDateString('en-CA') : null;
    const overdue = nextDate && days(nextDate, today) > 7;
    result.push({
      merchant: g.merchant, description: last.description, category: last.category, company: last.company, account_number: last.account_number,
      direction: g.direction, count: dates.length, typicalAmount: medAmt, lastAmount: amounts[amounts.length - 1], lastDate: dates[dates.length - 1], firstDate: dates[0],
      cadence: cad?.label || (gap ? `כל ~${Math.round(gap)} ימים` : 'לא סדיר'), cadenceKey: cad?.key || 'other', perMonth: cad?.perMonth ?? (gap ? 30 / gap : 1),
      monthlyEquivalent: medAmt * (cad?.perMonth ?? (gap ? 30 / gap : 1)), nextDate, overdue: Boolean(overdue), forced: ov === 'yes', score,
    });
  }
  const expenses = result.filter(r => r.direction === 'out').sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  const income = result.filter(r => r.direction === 'in').sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  return {
    expenses, income, installments,
    monthlyExpenses: expenses.reduce((s, r) => s + r.monthlyEquivalent, 0) + installments.reduce((s, p) => s + p.amount, 0),
    monthlyIncome: income.reduce((s, r) => s + r.monthlyEquivalent, 0),
  };
}
