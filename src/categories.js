// Keyword rules for Israeli merchants. First match wins; the user's own rules (merchant_rules) beat these.
// `excluded: true` means the row is money moving between the user's own accounts, not real income/expense.
export const CATEGORIES = [
  { name: 'חיוב כרטיס אשראי', icon: '💳', excluded: true, bankOnly: true,
    keywords: ['מקס איט', 'מקס פיננס', 'max it', 'maxit', 'לאומי קארד', 'ישראכרט', 'isracard', 'כאל ', 'כ.א.ל', 'cal ', 'אמריקן אקספרס', 'american express', 'דיינרס', 'diners'] },
  { name: 'חיוב כרטיס דיירקט', icon: '💳', excluded: true, bankOnly: true, manualOnly: true, keywords: [] },
  { name: 'כרטיס דיירקט (ללא פירוט)', icon: '💳', bankOnly: true, keywords: ['דירקט', 'דיירקט', 'direct'] },
  { name: 'הכנסות מהעסק', icon: '🧾', income: true,
    keywords: ['קארדקום', 'cardcom', 'גרואו', 'grow', 'פיימנט', 'payment', 'סליקה', 'משולם', 'meshulam', 'טרנזילה', 'tranzila', 'פייפלוס', 'payplus', 'icount', 'מורנינג', 'ריווחית', 'חשבונית ירוקה'] },
  { name: 'משכורת והכנסות', icon: '💰', income: true,
    keywords: ['משכורת', 'שכר', 'קצבת', 'קצבה', 'ביטוח לאומי', 'מס הכנסה', 'החזר מס', 'דיבידנד', 'ריבית זכות', 'זיכוי'] },
  { name: 'מיסים ורשויות', icon: '🏛️',
    keywords: ['ביטוח לאומי', 'מס הכנסה', 'מע"מ', 'מעמ', 'מכס', 'רשות המסים', 'רשות המיסים', 'מיסים', 'מקדמות'] },
  { name: 'העברות', icon: '🔁',
    keywords: ['העברה', 'העב\'', 'העב', 'הע.', 'ביט', 'bit', 'פייבוקס', 'paybox', 'זיכוי מהעברה', 'משיכת שיק', 'הפקדת שיק', 'שיק', 'צ\'ק'] },
  { name: 'מזומן', icon: '🏧', keywords: ['משיכה', 'משיכת מזומן', 'משיכה מכספומט', 'כספומט', 'בנקט', 'משיכת מזומנים', 'מזומן'] },
  { name: 'עמלות בנק', icon: '🏦', keywords: ['עמל', 'עמלת', 'ע.מפעולות', 'ע.פעולות', 'עמ.', 'דמי כרטיס', 'דמי ניהול', 'ריבית חובה', 'ריבית', 'רבית', 'פנקס'] },
  { name: 'הלוואות ומשכנתא', icon: '🏠', keywords: ['משכנתא', 'הלוואה', 'הלואה', 'החזר הלוואה'] },
  { name: 'חיסכון והשקעות', icon: '📈', excluded: true, keywords: ['הפקדה לחיסכון', 'הפקדה לפקדון', 'תוכנית חיסכון', 'תכנית חיסכון', 'חסכון', 'פקדון', 'פיקדון', 'קרן השתלמות', 'פנסיה', 'קופת גמל', 'גמל', 'ני"ע', 'ניירות ערך', 'קניית ני'] },
  { name: 'בריאות ופארם', icon: '💊',
    keywords: ['סופר פארם', 'סופר-פארם', 'superpharm', 'super pharm', 'בי פארם', 'ניו פארם', 'פארם', 'pharm', 'בית מרקחת', 'כללית', 'מכבי', 'מאוחדת', 'לאומית', 'רופא', 'ד"ר', 'דר ', 'מרפא', 'קליניק', 'שיניים', 'דנטל', 'dental', 'אופטיק', 'אופטומטר', 'משקפיים', 'עדשות', 'בית חולים', 'מעבדה', 'פסיכולוג', 'טיפול'] },
  { name: 'מזון וסופר', icon: '🛒',
    keywords: ['נטו חיסכון', 'נטו', 'שופרסל', 'רמי לוי', 'ויקטורי', 'יוחננוף', 'אושר עד', 'מגה ', 'טיב טעם', 'יינות ביתן', 'חצי חינם', 'סופר ', 'סופר-', 'סופרמרקט', 'מכולת', 'מינימרקט', 'מיני מרקט', 'am:pm', 'am pm', 'ampm', 'קשת טעמים', 'זול ובגדול', 'יש חסד', 'נתיב החסד', 'ברכל', 'סטופ מרקט', 'קרפור', 'carrefour', 'פרש מרקט', 'שוק ', 'ירקות', 'פירות', 'מאפיית', 'מאפייה', 'קצביה', 'קצבייה', 'אטליז', 'good pharm'] },
  { name: 'מסעדות וקפה', icon: '🍽️',
    keywords: ['מסעד', 'קפה', 'cafe', 'coffee', 'פיצה', 'pizza', 'בורגר', 'burger', 'וולט', 'wolt', 'תן ביס', '10bis', 'משלוחה', 'מקדונלד', 'mcdonald', 'ארומה', 'aroma', 'גרג', 'לנדוור', 'שווארמה', 'שוארמה', 'פלאפל', 'גלידה', 'סושי', 'sushi', 'ג\'פניקה', 'japanika', 'דומינו', 'domino', 'bbb', 'מוזס', 'בר ', 'ביסטרו', 'מטבח', 'grill', 'גריל', 'קונדיטוריה', 'רולדין', 'roladin', 'שניצל', 'בייגל', 'bagel'] },
  { name: 'תחבורה ורכב', icon: '🚗',
    keywords: ['דלק', 'פז ', 'פז-', 'paz', 'סונול', 'sonol', 'דור אלון', 'alon', 'טן ', 'ten ', 'חניון', 'חניה', 'חנייה', 'פנגו', 'pango', 'cellopark', 'סלופארק', 'רב קו', 'רב-קו', 'ravkav', 'אגד', 'egged', 'דן ', 'קווים', 'מטרופולין', 'נתיב אקספרס', 'רכבת', 'gett', 'גט טקסי', 'yango', 'יאנגו', 'uber', 'מונית', 'מוסך', 'טסט', 'רישוי', 'צמיג', 'כביש 6', 'כביש שש', 'נתיבי ישראל', 'דרך ארץ', 'כרמלטון', 'שטיפת', 'קארגלס', 'מוטורס', 'motors', 'רכב'] },
  { name: 'חשבונות בית', icon: '🏡',
    keywords: ['חברת החשמל', 'חשמל', 'מקורות', 'מי ', 'מים', 'תאגיד', 'גיחון', 'ארנונה', 'עיריית', 'עירית', 'מועצה', 'אמישראגז', 'פזגז', 'סופרגז', 'גז ', 'ועד בית', 'ועד הבית', 'שכר דירה', 'שכירות', 'דירה'] },
  { name: 'תקשורת ומנויים', icon: '📱',
    keywords: ['בזק', 'bezeq', 'הוט', 'hot ', 'hot-', 'סלקום', 'cellcom', 'פרטנר', 'partner', 'פלאפון', 'pelephone', 'גולן', 'golan', '019', '012', 'we4g', 'רמי לוי תקשורת', 'yes', 'נטפליקס', 'netflix', 'spotify', 'ספוטיפיי', 'apple.com', 'apple ', 'itunes', 'google', 'youtube', 'icloud', 'disney', 'microsoft', 'adobe', 'zoom', 'openai', 'chatgpt', 'anthropic', 'claude', 'canva', 'dropbox', 'amazon web', 'aws', 'wix', 'godaddy', 'notion'] },
  { name: 'ביטוח', icon: '🛡️',
    keywords: ['ביטוח', 'הראל', 'מגדל', 'כלל ', 'הפניקס', 'מנורה', 'איילון', 'שירביט', 'aig', 'ליברה', 'libra', 'ווישור', 'wesure', 'הכשרה'] },
  { name: 'קניות ואופנה', icon: '🛍️',
    keywords: ['zara', 'זארה', 'h&m', 'h & m', 'קסטרו', 'castro', 'פוקס', 'fox', 'רנואר', 'renuar', 'גולף', 'golf', 'טרמינל', 'terminal', 'next', 'shein', 'שיין', 'aliexpress', 'עלי אקספרס', 'amazon', 'אמזון', 'ebay', 'איביי', 'איקאה', 'ikea', 'ace', 'איס ', 'הום סנטר', 'home center', 'ביתילי', 'ksp', 'באג', 'bug', 'איידיגיטל', 'idigital', 'istore', 'מחסני חשמל', 'שקם אלקטריק', 'אלקטריק', 'טוויסטו', 'מנגו', 'mango', 'אמריקן איגל', 'american eagle', 'דלתא', 'delta', 'אינטימה', 'שילב', 'shilav', 'לייף', 'life', 'מקס סטוק', 'max stock', 'סטוק', 'נעלי', 'shoes', 'סקצ\'רס', 'nike', 'נייק', 'adidas', 'אדידס', 'decathlon', 'דקטלון', 'תכשיט', 'jewel', 'מתנות', 'צעצוע', 'toys', 'ספרים', 'סטימצקי', 'צומת ספרים', 'פייסבוק', 'facebook', 'meta', 'paypal', 'פייפאל', 'temu', 'טמו'] },
  { name: 'ילדים וחינוך', icon: '🎒',
    keywords: ['גן ', 'גני ', 'צהרון', 'בית ספר', 'בי"ס', 'ביה"ס', 'חוג', 'מעון', 'קייטנה', 'משפחתון', 'תלמוד תורה', 'ישיבה', 'סמינר', 'מכללה', 'אוניברסיט', 'שכר לימוד', 'שכ"ל', 'קורס', 'לימוד'] },
  { name: 'פנאי ונופש', icon: '🎉',
    keywords: ['סינמה', 'יס פלאנט', 'cinema', 'קולנוע', 'תיאטרון', 'הופעה', 'כרטיסים', 'eventim', 'מלון', 'hotel', 'booking', 'airbnb', 'אל על', 'el al', 'elal', 'ישראייר', 'israir', 'arkia', 'ארקיע', 'wizz', 'ryanair', 'נופש', 'צימר', 'חדר כושר', 'כושר', 'holmes', 'הולמס', 'בריכה', 'ספא', 'spa', 'מוזיאון', 'לונה פארק', 'סופרלנד', 'ספארי', 'גן חיות', 'פארק', 'ימית', 'אטרקצי', 'טיול'] },
  { name: 'טיפוח ויופי', icon: '💇', keywords: ['מספרה', 'ספר ', 'עיצוב שיער', 'שיער', 'קוסמטיק', 'מניקור', 'פדיקור', 'לק ', 'איפור', 'ללין', 'laline', 'סבון', 'sabon', 'mac ', 'סופר-פארם ביוטי', 'ביוטי', 'beauty'] },
  { name: 'תרומות', icon: '🤲', keywords: ['תרומה', 'צדקה', 'עמותה', 'עמותת', 'קופת העיר', 'יד ', 'עזר', 'חסד', 'קרן ', 'מוסדות', 'בית כנסת'] },
];

export const OTHER = 'אחר';
export const CATEGORY_NAMES = [...CATEGORIES.map(c => c.name), OTHER];
export const CATEGORY_ICONS = Object.fromEntries([...CATEGORIES.map(c => [c.name, c.icon]), [OTHER, '📦']]);

export function normalizeMerchant(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')            // Hebrew vowel points, if any
    .replace(/\d{2,}/g, ' ')                     // long numbers (branch, reference, dates)
    .replace(/[^\p{L}\p{N}&'"\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORY_BY_NAME = Object.fromEntries(CATEGORIES.map(c => [c.name, c]));

// Keywords match at a word start (so "בר" never matches "מצטבר"); very short keywords must be whole words.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RE = new Map();
for (const c of CATEGORIES) {
  KEYWORD_RE.set(c.name, c.keywords.map(k => {
    const t = k.trim().toLowerCase();
    const tail = t.length <= 3 ? '(?![\\p{L}\\p{N}])' : '';
    return new RegExp('(?<![\\p{L}\\p{N}])' + escapeRe(t) + tail, 'u');
  }));
}

// Some Max categories map cleanly onto ours; used only when no keyword matched.
const BANK_CATEGORY_MAP = [
  [/מזון|סופר|מכולת|מרכולים/, 'מזון וסופר'],
  [/מסעד|קפה|בתי אוכל/, 'מסעדות וקפה'],
  [/דלק|תחבורה|רכב|חניה|חנייה/, 'תחבורה ורכב'],
  [/פארם|בריאות|רפוא/, 'בריאות ופארם'],
  [/ביטוח/, 'ביטוח'],
  [/ביגוד|אופנה|הלבשה|הנעלה|קניות|חשמל ואלקטרוניקה|ריהוט|בית וגן/, 'קניות ואופנה'],
  [/תקשורת|מנוי|מחשבים|אינטרנט/, 'תקשורת ומנויים'],
  [/חינוך|ילדים|לימוד/, 'ילדים וחינוך'],
  [/פנאי|בידור|תיירות|נופש|תעופה|ספורט|תרבות/, 'פנאי ונופש'],
  [/עירייה|רשויות|ממשלה|חשבונות|מים|חשמל/, 'חשבונות בית'],
  [/תרומ/, 'תרומות'],
  [/טיפוח|יופי|קוסמטיקה/, 'טיפוח ויופי'],
];

/**
 * Decide category for a transaction.
 * @returns {{category:string, source:'user'|'rule'|'bank'|'none', excluded:0|1}}
 */
export function categorize({ merchant, description, amount, company, kind, bankCategory }, userRule) {
  const dirOk = !userRule || userRule.direction === 'any' || !userRule.direction || (userRule.direction === 'in' ? amount > 0 : amount < 0);
  if (userRule && dirOk) return { category: userRule.category, source: 'user', excluded: userRule.excluded ? 1 : 0 };
  const hay = ` ${merchant} ${String(description || '').toLowerCase()} `;
  for (const c of CATEGORIES) {
    if (c.manualOnly) continue;
    if (c.bankOnly && kind !== 'bank') continue;
    if (c.income && !(amount > 0)) continue;
    if (KEYWORD_RE.get(c.name).some(re => re.test(hay))) {
      return { category: c.name, source: 'rule', excluded: c.excluded ? 1 : 0 };
    }
  }
  if (bankCategory) {
    const m = BANK_CATEGORY_MAP.find(([re]) => re.test(bankCategory));
    if (m) return { category: m[1], source: 'bank', excluded: 0 };
  }
  if (amount > 0 && kind === 'bank') return { category: 'משכורת והכנסות', source: 'none', excluded: 0 };
  return { category: OTHER, source: 'none', excluded: 0 };
}

export const RULES_VERSION = 4;

export function isExcludedCategory(name) {
  return Boolean(CATEGORY_BY_NAME[name]?.excluded);
}

export function recategorizeAll(db) {
  const rules = new Map(db.prepare('SELECT merchant, category, excluded, direction FROM merchant_rules').all().map(r => [r.merchant, r]));
  const rows = db.prepare("SELECT t.id, t.merchant, t.description, t.amount, t.company, t.bank_category, t.category_source, a.kind FROM transactions t LEFT JOIN accounts a ON a.id = t.company || '|' || t.account_number WHERE t.category != 'חיוב כרטיס דיירקט'").all();
  const upd = db.prepare('UPDATE transactions SET category = ?, category_source = ?, excluded = ? WHERE id = ? AND (category != ? OR excluded != ?)');
  let n = 0;
  for (const r of rows) {
    const rule = rules.get(r.merchant);
    if (r.category_source === 'user') {
      // keep manual choices, except rows a merchant rule set in the wrong direction (fixed by the direction column)
      const mismatch = rule && rule.direction && rule.direction !== 'any' && (rule.direction === 'in' ? r.amount < 0 : r.amount > 0);
      if (!mismatch) continue;
    }
    const c = categorize({ merchant: r.merchant, description: r.description, amount: r.amount, company: r.company, kind: r.kind || 'bank', bankCategory: r.bank_category }, rule);
    n += upd.run(c.category, c.source, c.excluded, r.id, c.category, c.excluded).changes;
  }
  return n;
}
