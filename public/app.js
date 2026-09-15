/* Dashboard logic. Plain JS, no build step. */
const $ = s => document.querySelector(s);
const fmt = n => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n || 0));
const fmt2 = n => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shortMonth = ym => MONTHS[Number(ym.split('-')[1]) - 1].slice(0, 3);
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y.slice(2)}`; };
const relTime = iso => { if (!iso) return 'אף פעם'; const mins = Math.round((Date.now() - new Date(iso)) / 60000); if (mins < 2) return 'ממש עכשיו'; if (mins < 60) return `לפני ${mins} דק׳`; const h = Math.round(mins / 60); if (h < 24) return `לפני ${h} שע׳`; return `לפני ${Math.round(h / 24)} ימים`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#2f6fed','#e8743b','#1f9d55','#8e44ad','#d64545','#17a2b8','#b7791f','#5c6bc0','#26a69a','#ef5350','#7e57c2','#9ccc65','#ff7043','#42a5f5'];
const catColor = new Map();
const colorOf = name => { if (!catColor.has(name)) catColor.set(name, COLORS[catColor.size % COLORS.length]); return catColor.get(name); };

const state = { data: null, month: null, tab: 'overview', summary: null, catFilter: null };
// Local API call. A stale keep-alive socket (after the program restarts) makes WebKit fail once with
// "Load failed", so network errors are retried a couple of times before giving up.
const api = async (url, opts, attempt = 0) => {
  let r;
  try { r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, cache: 'no-store', ...opts }); }
  catch (e) {
    if (attempt < 3) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); return api(url, opts, attempt + 1); }
    throw new Error('אין חיבור לתוכנה. אם היא נסגרה, לפתוח את "מעקב כספים" מחדש. (' + (e.message || e) + ')');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const icon = name => (state.data?.categories.find(c => c.name === name)?.icon) || '📦';
const companyName = id => state.data?.companies.find(c => c.id === id)?.name || id;

/* ---------- tabs ---------- */
function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== 'tab-' + name);
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  if (name === 'transactions') loadTransactions();
  if (name === 'recurring') loadRecurring();
  if (name === 'categories') renderCategories();
  if (name === 'settings') renderSettings();
}
window.addEventListener('hashchange', () => showTab(location.hash.slice(1) || 'overview'));

/* ---------- state ---------- */
async function loadState() {
  state.data = await api('/api/state');
  // the program's files changed (new design or code): reload so the window is never stale
  if (state.assetVersion && state.data.assetVersion && state.assetVersion !== state.data.assetVersion) { location.reload(); return; }
  state.assetVersion = state.data.assetVersion;
  if (!state.month) state.month = state.data.month;
  renderSyncStatus();
  renderBanner();
  fillSelects();
}

function renderSyncStatus() {
  const d = state.data;
  const el = $('#syncStatus'); const btn = $('#syncBtn');
  if (d.approval?.running) {
    el.innerHTML = `<span class="spin"></span>${esc(d.approval.companyName || '')}: אישור המחשב…`;
    btn.disabled = true; btn.textContent = 'מסנכרן…';
  } else if (d.ai?.running) {
    el.innerHTML = `<span class="spin"></span>Gemini: ${esc(d.ai.stage || 'מסווג…')}`;
    btn.disabled = false; btn.textContent = 'סנכרן עכשיו';
  } else if (d.sync.running) {
    el.innerHTML = `<span class="spin"></span>${esc(d.sync.companyName || '')}: ${esc(d.sync.stage || '')}`;
    btn.disabled = true; btn.textContent = 'מסנכרן…';
  } else {
    const times = d.companies.filter(c => c.lastOk).map(c => new Date(c.lastOk.t));
    el.textContent = times.length ? `עודכן ${relTime(new Date(Math.max(...times)).toISOString())}` : (d.companies.some(c => c.configured) ? 'עדיין לא סונכרן' : '');
    btn.disabled = !d.companies.some(c => c.configured); btn.textContent = 'סנכרן עכשיו';
  }
}

function renderBanner() {
  const d = state.data; const b = $('#banner');
  const configured = d.companies.filter(c => c.configured);
  if (!configured.length) {
    b.className = 'banner info'; b.hidden = false;
    b.innerHTML = 'ברוכה הבאה! כדי להתחיל, יש להזין את פרטי ההתחברות לבנק ולכרטיס האשראי ב<a href="#settings"><u>הגדרות</u></a>. הסיסמאות נשמרות בצרור המפתחות של ה-Mac בלבד.';
    return;
  }
  if (d.approval?.running) {
    b.className = 'banner info'; b.hidden = false;
    b.innerHTML = `<span class="spin"></span><strong>${esc(d.approval.companyName)}:</strong> ${esc(d.approval.stage || '')}`;
    return;
  }
  const failed = configured.filter(c => c.last && c.last.ok === 0 && !d.sync.running);
  if (failed.length) {
    b.className = 'banner error'; b.hidden = false;
    b.innerHTML = failed.map(c => `<strong>${esc(c.name)}:</strong> ${esc(c.last.message)} ${/SMS|אימות/.test(c.last.message) ? `<button class="btn small" data-approve="${c.id}" style="margin-inline-start:8px">אישור המחשב הזה</button>` : ''}`).join('<br>');
    b.querySelectorAll('[data-approve]').forEach(x => x.onclick = () => startApproval(x.dataset.approve));
    return;
  }
  if (!d.counts.n && !d.sync.running) {
    b.className = 'banner info'; b.hidden = false;
    b.textContent = 'הפרטים נשמרו. לחצי "סנכרן עכשיו" כדי למשוך את התנועות בפעם הראשונה (זה לוקח דקה-שתיים).';
    return;
  }
  b.hidden = true;
}

function fillSelects() {
  const d = state.data;
  const fc = $('#fCompany'); const cur = fc.value;
  fc.innerHTML = '<option value="">כל המקורות</option>' + d.companies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  fc.value = cur;
  const fcat = $('#fCategory'); const curc = fcat.value;
  fcat.innerHTML = '<option value="">כל הקטגוריות</option>' + d.categories.map(c => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('');
  fcat.value = curc;
  const sh = $('#syncHour');
  if (!sh.options.length) sh.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  sh.value = d.settings.syncHour; $('#monthsBack').value = d.settings.monthsBack;
}

/* ---------- overview ---------- */
async function loadOverview() {
  const s = await api('/api/summary?month=' + state.month);
  state.summary = s;
  $('#monthTitle').textContent = monthName(s.month);
  $('#nextMonth').disabled = s.month >= state.data.month;
  const bank = state.data.accounts.filter(a => a.kind === 'bank');
  const balance = bank.reduce((t, a) => t + (a.balance || 0), 0);
  const balDate = bank.map(a => a.balance_date).filter(Boolean).sort().pop();
  const fd = state.data.futureDebits;
  const nextCharge = fd.length ? fd.reduce((t, f) => t + f.amount, 0) : null;
  const net = s.totals.income - s.totals.expenses;
  const prevExp = s.trend[4]?.expenses || 0;
  const expDelta = prevExp ? Math.round((s.totals.expenses - prevExp) / prevExp * 100) : null;
  $('#kpis').innerHTML = `
    <div class="card accent click" data-go='{"company":"hapoalim"}'><div class="label">יתרה בעו"ש</div><div class="value">${bank.length ? (balance < 0 ? '-' : '') + fmt(balance) : '—'}</div><div class="sub">${balDate ? 'נכון ל-' + fmtDate(balDate) : 'יתעדכן אחרי הסנכרון'}</div></div>
    <div class="card click" data-go='{"month":"${s.month}","kind":"expense"}'><div class="label">הוצאות ${monthName(s.month).split(' ')[0]}</div><div class="value">${fmt(s.totals.expenses)}</div><div class="sub">${expDelta == null ? 'לחיצה לפירוט ההוצאות' : (expDelta > 0 ? `▲ ${expDelta}% מהחודש הקודם` : expDelta < 0 ? `▼ ${-expDelta}% מהחודש הקודם` : 'כמו בחודש הקודם')}</div></div>
    <div class="card click" data-go='{"month":"${s.month}","kind":"income"}'><div class="label">הכנסות</div><div class="value pos">${fmt(s.totals.income)}</div><div class="sub">לחיצה לפירוט ההכנסות</div></div>
    <div class="card click" data-go='{"month":"${s.month}"}'><div class="label">נשאר / חסר</div><div class="value ${net >= 0 ? 'pos' : ''}" style="${net < 0 ? 'color:var(--bad)' : ''}">${net < 0 ? '-' : ''}${fmt(net)}</div><div class="sub">הכנסות פחות הוצאות · ${s.totals.count} תנועות</div></div>
    <div class="card click" data-go='{"pending":"1"}'><div class="label">חיוב כרטיס אשראי קרוב</div><div class="value">${nextCharge != null ? fmt(nextCharge) : (s.pending.count ? fmt(s.pending.total) : '—')}</div><div class="sub">${nextCharge != null ? (fd[0].charge_date ? 'ב-' + fmtDate(fd[0].charge_date) : 'לפי מקס') : (s.pending.count ? `${s.pending.count} עסקאות שטרם חויבו` : 'יתעדכן אחרי הסנכרון')}</div></div>`;
  $('#kpis').querySelectorAll('[data-go]').forEach(c => c.onclick = () => goTx(JSON.parse(c.dataset.go)));

  // category bars
  const total = s.byCategory.reduce((t, c) => t + c.total, 0);
  $('#catTotal').textContent = total ? `סה"כ ${fmt(total)}` : '';
  $('#catBars').innerHTML = s.byCategory.length ? s.byCategory.map(c => {
    const prev = s.prevByCategory.find(p => p.category === c.category)?.total || 0;
    const delta = prev ? Math.round((c.total - prev) / prev * 100) : null;
    return `<div class="row" data-cat="${esc(c.category)}">
      <div>${icon(c.category)}</div>
      <div><div class="name">${esc(c.category)} <span class="muted small">· ${c.count}</span></div><div class="bar"><i style="width:${Math.max(2, c.total / total * 100)}%;background:${colorOf(c.category)}"></i></div></div>
      <div class="amt">${fmt(c.total)}<span class="delta muted">${delta == null ? '' : delta > 0 ? `▲${delta}%` : delta < 0 ? `▼${-delta}%` : '='}</span></div>
    </div>`;
  }).join('') : '<div class="empty">אין הוצאות בחודש הזה</div>';
  $('#catBars').querySelectorAll('.row').forEach(r => r.onclick = () => goTx({ month: s.month, category: r.dataset.cat, kind: 'expense' }));

  renderTrend(s.trend);
  renderDaily(s.byDay, s.month);

  $('#topMerchants').innerHTML = s.topMerchants.length ? s.topMerchants.map(m => `<li class="click" data-q="${esc(m.description)}"><div><div>${esc(m.description)}</div><div class="meta">${icon(m.category)} ${esc(m.category)} · ${m.count} ${m.count === 1 ? 'פעם' : 'פעמים'}</div></div><div class="amt">${fmt(m.total)}</div></li>`).join('') : '<li class="empty">עדיין אין נתונים</li>';
  $('#largest').innerHTML = s.largest.length ? s.largest.map(t => `<li class="click" data-q="${esc(t.description)}"><div><div>${esc(t.description)}</div><div class="meta">${fmtDate(t.date)} · ${esc(companyName(t.company))} · ${icon(t.category)} ${esc(t.category)}</div></div><div class="amt">${fmt(t.amount)}</div></li>`).join('') : '<li class="empty">עדיין אין נתונים</li>';
  $('#incomeList').innerHTML = s.incomeByCategory.length ? s.incomeByCategory.map(c => `<li class="click" data-cat="${esc(c.category)}"><div>${icon(c.category)} ${esc(c.category)} <span class="meta">· ${c.count}</span></div><div class="amt pos">${fmt(c.total)}</div></li>`).join('') : '<li class="empty">לא נמצאו הכנסות החודש</li>';
  document.querySelectorAll('#topMerchants [data-q], #largest [data-q]').forEach(li => li.onclick = () => goTx({ month: s.month, q: li.dataset.q }));
  document.querySelectorAll('#incomeList [data-cat]').forEach(li => li.onclick = () => goTx({ month: s.month, category: li.dataset.cat, kind: 'income' }));
}

// Open the transactions tab with the given filters (everything on the overview is clickable).
function goTx({ month = '', kind = '', category = '', company = '', q = '', pending = '' } = {}) {
  setTxMonth(pending ? '' : month, { reload: false });
  $('#fKind').value = pending ? 'pending' : kind;
  $('#fCategory').value = category;
  $('#fCompany').value = company;
  $('#fSearch').value = q;
  location.hash = 'transactions';
  if (state.tab === 'transactions') loadTransactions();
}

function renderTrend(trend) {
  const W = 520, H = 200, padL = 8, padB = 26, padT = 12;
  const max = Math.max(1, ...trend.flatMap(t => [t.expenses, t.income]));
  const bw = (W - padL * 2) / trend.length;
  const y = v => padT + (H - padB - padT) * (1 - v / max);
  const bars = trend.map((t, i) => {
    const x = padL + i * bw;
    return `<rect x="${x + bw * 0.14}" y="${y(t.income)}" width="${bw * 0.32}" height="${H - padB - y(t.income)}" rx="3" fill="#1f9d55" opacity=".85"><title>הכנסות ${monthName(t.month)}: ${fmt(t.income)}</title></rect>
      <rect x="${x + bw * 0.52}" y="${y(t.expenses)}" width="${bw * 0.32}" height="${H - padB - y(t.expenses)}" rx="3" fill="#2f6fed"><title>הוצאות ${monthName(t.month)}: ${fmt(t.expenses)}</title></rect>
      <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#6b7079">${shortMonth(t.month)}</text>
      <text x="${x + bw / 2}" y="${Math.min(y(t.expenses), y(t.income)) - 4}" text-anchor="middle" font-size="10" fill="#6b7079">${t.expenses ? Math.round(t.expenses / 1000) + 'K' : ''}</text>`;
  }).join('');
  $('#trend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" direction="ltr"><line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#e6e4dd"/>${bars}</svg>
    <div class="legend"><span><i style="background:#2f6fed"></i>הוצאות</span><span><i style="background:#1f9d55"></i>הכנסות</span></div>`;
}

function renderDaily(byDay, month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const W = 520, H = 110, padB = 18;
  const vals = Array.from({ length: days }, (_, i) => byDay.find(d => Number(d.date.slice(8)) === i + 1)?.total || 0);
  const max = Math.max(1, ...vals);
  const bw = W / days;
  $('#daily').innerHTML = `<svg viewBox="0 0 ${W} ${H}" direction="ltr">${vals.map((v, i) => `<rect x="${i * bw + 1}" y="${(H - padB) * (1 - v / max)}" width="${bw - 2}" height="${(H - padB) * v / max}" rx="2" fill="${v ? '#2f6fed' : '#eceae3'}" opacity="${v ? .8 : 1}"><title>${i + 1}.${m}: ${fmt(v)}</title></rect>${(i + 1) % 5 === 0 ? `<text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#6b7079">${i + 1}</text>` : ''}`).join('')}</svg>`;
}

/* ---------- transactions ---------- */
async function loadTransactions() {
  const p = new URLSearchParams();
  if ($('#fMonth').value) p.set('month', $('#fMonth').value);
  if ($('#fCompany').value) p.set('company', $('#fCompany').value);
  if ($('#fCategory').value) p.set('category', $('#fCategory').value);
  if ($('#fKind').value) p.set('kind', $('#fKind').value);
  if ($('#fSearch').value.trim()) p.set('q', $('#fSearch').value.trim());
  $('#exportBtn').href = '/api/export.csv' + ($('#fMonth').value ? '?month=' + $('#fMonth').value : '');
  const r = await api('/api/transactions?' + p);
  const q = $('#fSearch').value.trim();
  $('#txSummary').innerHTML = r.total ? `
    <div class="totals">
      <span class="tot-label">${q ? `נמצאו <strong>${r.total}</strong> תנועות עבור "${esc(q)}"` : `<strong>${r.total}</strong> תנועות`}${r.rows.length < r.total ? ` · מוצגות ${r.rows.length} הראשונות` : ''}${r.excludedCount ? ` · ${r.excludedCount} לא נספרות` : ''}</span>
      ${r.expenses ? `<span class="tot"><span class="tot-k">סה"כ הוצאות</span><span class="tot-v">${fmt(r.expenses)}</span></span>` : ''}
      ${r.income ? `<span class="tot"><span class="tot-k">סה"כ הכנסות</span><span class="tot-v pos">${fmt(r.income)}</span></span>` : ''}
      ${r.expenses && r.income ? `<span class="tot"><span class="tot-k">נטו</span><span class="tot-v ${r.net >= 0 ? 'pos' : ''}" style="${r.net < 0 ? 'color:var(--bad)' : ''}">${r.net < 0 ? '-' : ''}${fmt(r.net)}</span></span>` : ''}
    </div>` : `<div class="totals"><span class="tot-label">${q ? `לא נמצאו תנועות עבור "${esc(q)}"` : 'לא נמצאו תנועות'}</span></div>`;
  $('#txBody').innerHTML = r.rows.map(t => `<tr data-id="${t.id}">
    <td class="num" style="text-align:right;direction:rtl;white-space:nowrap">${fmtDate(t.date)}${t.processed_date && t.processed_date !== t.date ? `<div class="src">חיוב ${fmtDate(t.processed_date)}</div>` : ''}</td>
    <td><div class="desc">${esc(t.description)}${t.status === 'pending' ? '<span class="badge pending">ממתין</span>' : ''}${t.installment_total ? `<span class="badge">תשלום ${t.installment_number}/${t.installment_total}</span>` : ''}${t.excluded ? '<span class="badge excl">לא נספר</span>' : ''}</div>${t.memo ? `<div class="memo">${esc(t.memo)}</div>` : ''}${t.original_currency && t.original_currency !== 'ILS' && t.original_currency !== '₪' ? `<div class="memo">${t.original_amount} ${esc(t.original_currency)}</div>` : ''}</td>
    <td class="src">${esc(companyName(t.company))}<div>${esc(t.account_number)}</div></td>
    <td><button class="catbtn" data-id="${t.id}">${icon(t.category)} ${esc(t.category)}</button>${t.category_source === 'user' ? '<div class="src">סיווג ידני</div>' : t.category_source === 'ai' ? '<div class="src">סיווג Gemini</div>' : ''}</td>
    <td class="num ${t.amount > 0 ? 'pos' : ''}" style="font-weight:600">${t.amount > 0 ? '+' : '-'}${fmt2(Math.abs(t.amount)).replace('‏', '')}</td>
  </tr>`).join('');
  $('#txBody').querySelectorAll('.catbtn').forEach(b => b.onclick = () => openCatDialog(r.rows.find(x => x.id === b.dataset.id)));
}
['fCompany', 'fCategory', 'fKind'].forEach(id => $('#' + id).onchange = loadTransactions);
let searchT; $('#fSearch').oninput = () => { clearTimeout(searchT); searchT = setTimeout(loadTransactions, 300); };
$('#fSearch').onkeydown = e => { if (e.key === 'Enter') { clearTimeout(searchT); loadTransactions(); } };
$('#fSearchBtn').onclick = () => { clearTimeout(searchT); loadTransactions(); };
$('#fClear').onclick = () => { ['fCompany', 'fCategory', 'fKind', 'fSearch'].forEach(id => $('#' + id).value = ''); setTxMonth(state.data.month); };

// Month navigation on the transactions tab ('' = whole period)
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function setTxMonth(ym, { reload = true } = {}) {
  $('#fMonth').value = ym || '';
  $('#txMonthTitle').textContent = ym ? monthName(ym) : 'כל התקופה';
  $('#txPrev').disabled = !ym;
  $('#txNext').disabled = !ym || ym >= state.data.month;
  $('#txToday').hidden = ym === state.data.month;
  $('#txAll').hidden = !ym;
  if (reload && state.tab === 'transactions') loadTransactions();
}
$('#txPrev').onclick = () => setTxMonth(shiftMonth($('#fMonth').value, -1));
$('#txNext').onclick = () => setTxMonth(shiftMonth($('#fMonth').value, 1));
$('#txAll').onclick = () => setTxMonth('');
$('#txToday').onclick = () => setTxMonth(state.data.month);

function openCatDialog(tx) {
  const dlg = $('#catDialog');
  $('#dlgDesc').textContent = `${tx.description} · ${fmtDate(tx.date)} · ${fmt2(tx.amount)}`;
  $('#dlgApplyAll').checked = true;
  $('#dlgExcluded').checked = !!tx.excluded;
  $('#dlgRecurring').checked = false;
  $('#dlgRecurring').onchange = async () => {
    await api('/api/recurring/override', { method: 'POST', body: JSON.stringify({ merchant: tx.merchant, direction: tx.amount > 0 ? 'in' : 'out', state: $('#dlgRecurring').checked ? 'yes' : null }) });
    toast($('#dlgRecurring').checked ? 'נוסף לרשימת הקבועים' : 'הוסר מרשימת הקבועים');
  };
  $('#dlgCats').innerHTML = state.data.categories.map(c => `<button type="button" class="${c.name === tx.category ? 'sel' : ''}" data-cat="${esc(c.name)}">${c.icon} ${esc(c.name)}</button>`).join('');
  $('#dlgCats').querySelectorAll('button').forEach(b => b.onclick = async () => {
    const cat = b.dataset.cat;
    const catDef = state.data.categories.find(c => c.name === cat);
    const excluded = $('#dlgExcluded').checked || (catDef?.excluded && cat !== tx.category ? true : $('#dlgExcluded').checked);
    try {
      const r = await api('/api/transactions/' + tx.id, { method: 'PATCH', body: JSON.stringify({ category: cat, applyToMerchant: $('#dlgApplyAll').checked, excluded }) });
      dlg.close();
      toast(r.updated > 1 ? `עודכנו ${r.updated} תנועות` : 'עודכן');
      loadTransactions(); loadOverview();
    } catch (e) { alert(e.message); }
  });
  dlg.showModal();
}

/* ---------- recurring ---------- */
async function loadRecurring() {
  const r = await api('/api/recurring');
  const overdueN = r.expenses.filter(x => x.overdue).length;
  $('#recKpis').innerHTML = `
    <div class="card"><div class="label">הוצאות קבועות בחודש</div><div class="value">${fmt(r.monthlyExpenses)}</div><div class="sub">${r.expenses.length} חיובים קבועים${r.installments.length ? ` + ${r.installments.length} תשלומים` : ''}</div></div>
    <div class="card"><div class="label">הכנסות קבועות בחודש</div><div class="value pos">${fmt(r.monthlyIncome)}</div><div class="sub">${r.income.length} מקורות</div></div>
    <div class="card"><div class="label">נשאר אחרי הקבועים</div><div class="value ${r.monthlyIncome - r.monthlyExpenses >= 0 ? 'pos' : ''}" style="${r.monthlyIncome - r.monthlyExpenses < 0 ? 'color:var(--bad)' : ''}">${r.monthlyIncome - r.monthlyExpenses < 0 ? '-' : ''}${fmt(r.monthlyIncome - r.monthlyExpenses)}</div><div class="sub">לפני הוצאות משתנות</div></div>
    <div class="card"><div class="label">לא הופיעו בזמן</div><div class="value" style="${overdueN ? 'color:var(--warn)' : ''}">${overdueN}</div><div class="sub">${overdueN ? 'חיובים שהיו אמורים לרדת כבר' : 'הכל ירד כרגיל'}</div></div>`;
  const removeBtn = x => `<button class="btn small ghost" title="להסיר מהרשימה" data-rm="${esc(x.merchant)}" data-dir="${x.direction}">✕</button>`;
  $('#recExpenses').innerHTML = r.expenses.length ? r.expenses.map(x => `<tr class="click" data-q="${esc(x.description)}">
      <td><div class="desc">${esc(x.description)}${x.forced ? '<span class="badge">סומן ידנית</span>' : ''}</div><div class="src">${esc(x.companyName)} · ${x.count} פעמים מאז ${fmtDate(x.firstDate)}</div></td>
      <td>${icon(x.category)} ${esc(x.category)}</td>
      <td>${esc(x.cadence)}${x.cadenceKey !== 'monthly' && x.cadenceKey !== 'other' ? `<div class="src">≈ ${fmt(x.monthlyEquivalent)} לחודש</div>` : ''}</td>
      <td class="num" style="font-weight:600">${fmt(x.typicalAmount)}${Math.abs(x.lastAmount - x.typicalAmount) > Math.max(3, x.typicalAmount * 0.15) ? `<div class="src">אחרון: ${fmt(x.lastAmount)}</div>` : ''}</td>
      <td style="white-space:nowrap">${fmtDate(x.lastDate)}</td>
      <td style="white-space:nowrap">${x.nextDate ? (x.overdue ? `<span class="badge pending">היה צפוי ${fmtDate(x.nextDate)}</span>` : fmtDate(x.nextDate)) : '—'}</td>
      <td>${removeBtn(x)}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">עדיין לא זוהו חיובים קבועים. צריך לפחות שני חודשים של נתונים.</td></tr>';
  $('#recInstallments').innerHTML = r.installments.length ? r.installments.map(p => `<li class="click" data-q="${esc(p.description)}"><div><div>${esc(p.description)}</div><div class="meta">${icon(p.category)} ${esc(p.category)} · שולמו ${p.lastNumber} מתוך ${p.total} · מסתיים ${fmtDate(p.endDate)}</div></div><div style="text-align:left"><div class="amt">${fmt(p.amount)} לחודש</div><div class="meta">נשאר ${fmt(p.remainingAmount)}</div></div></li>`).join('') : '<li class="empty">אין עסקאות בתשלומים פתוחות</li>';
  $('#recIncome').innerHTML = r.income.length ? r.income.map(x => `<li class="click" data-q="${esc(x.description)}"><div><div>${esc(x.description)} ${removeBtn(x)}</div><div class="meta">${esc(x.cadence)} · אחרון ${fmtDate(x.lastDate)}${x.nextDate ? ' · הבא ' + fmtDate(x.nextDate) : ''}</div></div><div class="amt pos">${fmt(x.typicalAmount)}</div></li>`).join('') : '<li class="empty">לא זוהו הכנסות קבועות</li>';
  document.querySelectorAll('#tab-recurring [data-q]').forEach(el => el.onclick = e => { if (e.target.closest('[data-rm]')) return; goTx({ q: el.dataset.q }); });
  document.querySelectorAll('#tab-recurring [data-rm]').forEach(b => b.onclick = async e => { e.stopPropagation(); if (!confirm('להסיר מרשימת הקבועים? אפשר להחזיר דרך שינוי הקטגוריה של התנועה.')) return; await api('/api/recurring/override', { method: 'POST', body: JSON.stringify({ merchant: b.dataset.rm, direction: b.dataset.dir, state: 'no' }) }); loadRecurring(); });
}

/* ---------- categories ---------- */
async function renderCategories() {
  const rules = await api('/api/merchant-rules');
  const counts = await api('/api/transactions?limit=1');
  $('#catList').innerHTML = state.data.categories.map(c => `<li><span>${c.icon}</span><span class="grow">${esc(c.name)}${c.excluded ? ' <span class="badge excl">לא נספר כהוצאה</span>' : ''}</span>${c.custom ? `<button class="btn small" data-del="${esc(c.name)}">מחק</button>` : ''}</li>`).join('');
  $('#catList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm(`למחוק את הקטגוריה "${b.dataset.del}"? התנועות שלה יעברו ל"אחר".`)) return; await api('/api/categories/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await loadState(); renderCategories(); });
  $('#ruleList').innerHTML = rules.length ? rules.map(r => `<li><span class="grow"><strong>${esc(r.example || r.merchant)}</strong> ${r.direction === 'in' ? '<span class="badge">הכנסות</span>' : r.direction === 'out' ? '<span class="badge">הוצאות</span>' : ''} ← ${icon(r.category)} ${esc(r.category)} <span class="muted small">· ${r.count} תנועות</span></span><button class="btn small" data-rule="${esc(r.merchant)}">הסר כלל</button></li>`).join('') : '<li class="muted">עדיין אין כללים</li>';
  $('#ruleList').querySelectorAll('[data-rule]').forEach(b => b.onclick = async () => { await api('/api/merchant-rules', { method: 'DELETE', body: JSON.stringify({ merchant: b.dataset.rule }) }); renderCategories(); });
  void counts;
}
$('#addCatBtn').onclick = async () => {
  const name = $('#newCatName').value.trim(); if (!name) return;
  try { await api('/api/categories', { method: 'POST', body: JSON.stringify({ name, icon: $('#newCatIcon').value.trim() || '🏷️' }) }); $('#newCatName').value = ''; $('#newCatIcon').value = ''; await loadState(); renderCategories(); } catch (e) { alert(e.message); }
};

/* ---------- settings ---------- */
async function renderSettings() {
  const d = state.data;
  $('#credCards').innerHTML = d.companies.map(c => `<div class="panel cred" data-company="${c.id}">
    <div class="panel-h"><h3>${esc(c.name)}</h3><span class="status"><span class="dot ${c.configured ? (c.last && c.last.ok === 0 ? 'bad' : 'ok') : ''}"></span>${c.configured ? (c.lastOk ? 'מחובר · עודכן ' + relTime(c.lastOk.t) : 'הפרטים נשמרו, עדיין לא סונכרן') : 'לא הוגדר'}</span></div>
    ${c.configured ? `<p class="muted small">הפרטים שמורים בצרור המפתחות. כדי להחליף, פשוט להזין מחדש ולשמור.</p>` : `<p class="muted small">אותם פרטים שאיתם נכנסים לאתר ${esc(c.name)} בדפדפן.</p>`}
    ${c.fields.map(f => `<input name="${f.key}" type="${f.type}" placeholder="${esc(f.label)}" autocomplete="off">`).join('')}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-save>${c.configured ? 'עדכן פרטים' : 'שמור והתחבר'}</button>${c.configured ? `<button class="btn" data-approve>אישור המחשב הזה (קוד SMS)</button><button class="btn" data-test>בדוק חיבור</button><button class="btn danger" data-remove>הסר</button>` : ''}</div>
    ${c.configured ? `<p class="muted small">בפעם הראשונה האתר מבקש קוד אימות ב-SMS. "אישור המחשב הזה" פותח חלון של האתר, מתחברים שם פעם אחת עם הקוד, ומאז הסנכרון עובד לבד.</p>` : ''}
    ${c.last && c.last.ok === 0 ? `<div class="banner error" style="margin:0;padding:8px 10px;font-size:13px">${esc(c.last.message)}</div>` : ''}
  </div>`).join('');
  $('#credCards').querySelectorAll('.cred').forEach(card => {
    const id = card.dataset.company;
    card.querySelector('[data-save]').onclick = async () => {
      const body = {}; card.querySelectorAll('input').forEach(i => body[i.name] = i.value);
      try {
        await api('/api/credentials/' + id, { method: 'POST', body: JSON.stringify(body) });
        toast('נשמר בצרור המפתחות');
        await loadState(); renderSettings();
        if (confirm('הפרטים נשמרו. עכשיו ייפתח חלון של האתר כדי לאשר את המחשב הזה פעם אחת (קוד SMS). להמשיך?')) startApproval(id);
      } catch (e) { alert(e.message); }
    };
    card.querySelector('[data-test]')?.addEventListener('click', () => startSync([id]));
    card.querySelector('[data-approve]')?.addEventListener('click', () => startApproval(id));
    card.querySelector('[data-remove]')?.addEventListener('click', async () => { if (!confirm('להסיר את פרטי ההתחברות מצרור המפתחות? התנועות שכבר נשמרו יישארו.')) return; await api('/api/credentials/' + id, { method: 'DELETE' }); await loadState(); renderSettings(); });
  });
  const ai = d.ai || {};
  $('#aiCard').innerHTML = `
    <div class="panel-h"><h3>סיווג חכם עם Gemini (חינמי)</h3><span class="status"><span class="dot ${ai.configured ? 'ok' : ''}"></span>${ai.configured ? (ai.lastRun ? 'מחובר · רץ לאחרונה ' + relTime(ai.lastRun) : 'מחובר') : 'לא הוגדר'}</span></div>
    <p class="muted small">בתי עסק שהכללים לא מזהים נשארים ב"אחר". Gemini מקבל את שמות בתי העסק (רק את השמות, בלי סכומים או פרטי חשבון) ומציע קטגוריה. כל שם נשאל פעם אחת בלבד. בגרסה החינמית יש מכסה יומית, ולכן זה רץ בקבוצות אחרי כל סנכרון.</p>
    <p class="small">${ai.unknown ? `כרגע <strong>${ai.unknown}</strong> בתי עסק ב"אחר".` : 'כל בתי העסק מסווגים.'} ${ai.lastResult ? `בריצה האחרונה: נשאלו ${ai.lastResult.asked}, עודכנו ${ai.lastResult.applied} תנועות${ai.lastResult.error ? ' · ' + esc(ai.lastResult.error) : ''}` : ''}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="aiKey" type="password" placeholder="${ai.configured ? 'מפתח שמור · להזין רק כדי להחליף' : 'מפתח API של Gemini'}" autocomplete="off" style="flex:1;min-width:220px">
      <button class="btn" id="aiSaveKey">${ai.configured ? 'החלף מפתח' : 'שמור מפתח'}</button>
      ${ai.configured ? `<button class="btn primary" id="aiRun" ${ai.running ? 'disabled' : ''}>${ai.running ? 'מסווג…' : 'סווג עכשיו'}</button><button class="btn danger" id="aiRemove">הסר מפתח</button>` : ''}
    </div>
    <p class="muted small" style="margin-bottom:0">מפתח חינמי מקבלים ב-<a href="https://aistudio.google.com/apikey" target="_blank"><u>Google AI Studio</u></a>. המפתח נשמר בצרור המפתחות.</p>`;
  $('#aiSaveKey').onclick = async () => { const k = $('#aiKey').value.trim(); if (!k) return alert('יש להדביק מפתח'); try { await api('/api/ai/key', { method: 'POST', body: JSON.stringify({ apiKey: k }) }); toast('המפתח נשמר'); await loadState(); renderSettings(); } catch (e) { alert(e.message); } };
  $('#aiRun')?.addEventListener('click', async () => { const r = await api('/api/ai/run', { method: 'POST' }); if (r.started === false) return alert(r.reason === 'no-key' ? 'קודם לשמור מפתח.' : 'הסיווג כבר רץ.'); toast('Gemini מסווג ברקע…'); pollSync(); });
  $('#aiRemove')?.addEventListener('click', async () => { if (!confirm('להסיר את מפתח Gemini?')) return; await api('/api/ai/key', { method: 'DELETE' }); await loadState(); renderSettings(); });
  const logs = await api('/api/sync-log');
  $('#syncLog').innerHTML = logs.length ? logs.map(l => `<li><span class="dot ${l.ok == null ? '' : l.ok ? 'ok' : 'bad'}"></span><span class="grow">${esc(l.companyName)} · ${new Date(l.started_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span><span class="muted">${esc(l.message || (l.ok == null ? 'רץ…' : ''))}</span></li>`).join('') : '<li class="muted">עדיין לא היה סנכרון</li>';
}
$('#saveSettings').onclick = async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ syncHour: $('#syncHour').value, monthsBack: $('#monthsBack').value }) }); toast('נשמר'); };
$('#quitBtn').onclick = async () => { if (!confirm('לסגור את התוכנה? הסנכרון האוטומטי יפסיק עד שתיפתח שוב.')) return; await api('/api/quit', { method: 'POST' }); document.body.innerHTML = '<div class="empty" style="padding:80px;font-size:18px">התוכנה נסגרה. אפשר לסגור את החלון.</div>'; };

/* ---------- sync ---------- */
async function startSync(companies) {
  try {
    const r = await api('/api/sync', { method: 'POST', body: JSON.stringify({ companies }) });
    if (r.started === false) { alert(r.reason === 'no-credentials' ? 'קודם יש להזין פרטי התחברות בהגדרות.' : 'סנכרון כבר רץ.'); return; }
    location.hash = state.tab === 'settings' ? 'settings' : 'overview';
    pollSync();
  } catch (e) { alert(e.message); }
}
$('#syncBtn').onclick = () => startSync();
async function startApproval(company) {
  try {
    const r = await api('/api/approve-device/' + company, { method: 'POST' });
    if (r.started === false) { alert('סנכרון או אישור כבר רץ. לחכות שיסתיים.'); return; }
    toast('נפתח חלון של האתר. להתחבר שם ולהקליד את קוד ה-SMS.');
    pollSync();
  } catch (e) { alert(e.message); }
}
let pollT;
async function pollSync() {
  clearTimeout(pollT);
  await loadState();
  if (state.data.sync.running || state.data.approval?.running || state.data.ai?.running) { pollT = setTimeout(pollSync, 2000); return; }
  if (state.data.ai?.lastResult && Date.now() - new Date(state.data.ai.lastResult.at) < 5000) { const r = state.data.ai.lastResult; toast(r.error ? r.error : `Gemini סיווג ${r.applied} תנועות (${r.asked} בתי עסק)`, r.error ? 'bad' : 'ok'); }
  if (state.data.approval?.lastResult && !state.data.approval.lastResult.ok && Date.now() - new Date(state.data.approval.lastResult.at) < 10000) toast('החלון נסגר לפני שההתחברות הושלמה. אפשר לנסות שוב מההגדרות.', 'bad');
  const res = state.data.sync.results || [];
  if (res.length) toast(res.map(r => `${companyName(r.company)}: ${r.message}`).join(' · '), res.every(r => r.ok) ? 'ok' : 'bad');
  refreshCurrent();
}

/* ---------- misc ---------- */
function toast(msg, kind = 'ok') {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); Object.assign(t.style, { position: 'fixed', bottom: '22px', right: '50%', transform: 'translateX(50%)', background: '#1f2328', color: '#fff', padding: '10px 16px', borderRadius: '10px', fontSize: '14px', zIndex: 20, maxWidth: '90%', transition: 'opacity .3s' }); }
  t.textContent = msg; t.style.background = kind === 'bad' ? '#8a1f1f' : '#1f2328'; t.style.opacity = 1; clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = 0, 4000);
}
function refreshCurrent() {
  loadOverview();
  if (state.tab === 'transactions') loadTransactions();
  if (state.tab === 'settings') renderSettings();
  if (state.tab === 'categories') renderCategories();
}
$('#prevMonth').onclick = () => { const [y, m] = state.month.split('-').map(Number); const d = new Date(y, m - 2, 1); state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; loadOverview(); };
$('#nextMonth').onclick = () => { const [y, m] = state.month.split('-').map(Number); const d = new Date(y, m, 1); state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; loadOverview(); };

(async function init() {
  await loadState();
  setTxMonth(state.data.month, { reload: false });
  showTab(location.hash.slice(1) || 'overview');
  await loadOverview();
  if (state.data.sync.running || state.data.approval?.running) pollSync();
  setInterval(async () => { const was = state.data.sync.running; await loadState(); if (was && !state.data.sync.running) refreshCurrent(); }, 15000);
})();
