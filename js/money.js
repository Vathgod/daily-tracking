'use strict';

// Spending tracker. Each expense keeps the amount and currency as typed.
// Totals are in US dollars (riel converted at a fixed rate), or in NZ dollars
// when this device's money currency is set to NZ$.

const KHR_PER_USD = 4100;

// Built in so every device starts with the same ids. The user can rename or
// delete them; a stored item (or delete marker) with the same id wins.
const DEFAULT_CATS = [
  { id: 'food', emoji: '🍜', name: 'Food' },
  { id: 'coffee', emoji: '☕', name: 'Coffee & drinks' },
  { id: 'transport', emoji: '🛵', name: 'Transport' },
  { id: 'shopping', emoji: '🛒', name: 'Shopping' },
  { id: 'phone', emoji: '📱', name: 'Phone & internet' },
  { id: 'bills', emoji: '🏠', name: 'Bills & rent' },
  { id: 'fun', emoji: '🎉', name: 'Fun' },
  { id: 'other', emoji: '➕', name: 'Other' },
];

const SPEND_DAYS = 5;

const METHODS = { cash: '💵 Cash', aba: '🏦 Bank', card: '💳 Card' };
const methodOf = m => (METHODS[m] ? m : 'cash');

const Money = {
  // Money currency for this device: 'usd' (US$ + riel) or 'nzd'.
  nz() {
    try { return localStorage.getItem('dt.moneyCur') === 'nzd'; } catch (e) { return false; }
  },

  // Like U.money, with NZ$ in place of $ in NZ$ mode.
  fmt(n, signed = true) {
    const s = U.money(n, signed);
    return Money.nz() ? s.replace('$', 'NZ$') : s;
  },

  // Amount in the home currency (US$, or NZ$ in NZ$ mode).
  usd(e) {
    const v = U.num(e.amount);
    if (!isFinite(v)) return 0;
    return e.cur === 'KHR' ? v / KHR_PER_USD : v;
  },

  // Commas are thousands separators ("10,000"), except a dollar amount
  // like "2,50" where the comma is the decimal point.
  parse(str, cur) {
    let s = String(str || '').trim().replace(/\s/g, '');
    if (cur !== 'KHR' && /^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  },

  fmtKHR(n) {
    return `${Math.round(n).toLocaleString('en-US')}៛`;
  },

  // How the amount was typed: "$2.50", "NZ$2.50" or "10,000៛".
  fmtOrig(e) {
    const v = U.num(e.amount);
    return e.cur === 'KHR' ? Money.fmtKHR(v) : Money.fmt(v, false);
  },

  // Short dollar amount for calendar cells: $8, $12.5, $1.2k (NZ$8 in NZ$ mode)
  short(n) {
    if (!(n > 0)) return '';
    const sign = Money.nz() ? 'NZ$' : '$';
    if (n >= 1000) return sign + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    // Whole NZ dollars, so "NZ$" still fits in a small day cell.
    return sign + (n >= 100 || Money.nz() ? Math.round(n) : Math.round(n * 10) / 10);
  },

  cats() {
    const out = [];
    DEFAULT_CATS.forEach((d, i) => {
      if (!Store.get('categories', d.id)) out.push({ ...d, createdAt: i });
    });
    out.push(...Store.list('categories'));
    // "Other" always exists and stays last.
    const other = out.find(c => c.id === 'other') || { ...DEFAULT_CATS.find(c => c.id === 'other'), createdAt: DEFAULT_CATS.length - 1 };
    return [...out.filter(c => c.id !== 'other').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), other];
  },

  cat(id) {
    return Money.cats().find(c => c.id === id) || Money.cats().find(c => c.id === 'other');
  },

  catLabel(id) {
    const c = Money.cat(id);
    return `${c.emoji || '•'} ${c.name}`;
  },

  list(from, to) {
    return Store.list('expenses')
      .filter(e => e.date >= from && e.date <= to)
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt || 0) - (a.createdAt || 0));
  },

  total(list) { return list.reduce((s, e) => s + Money.usd(e), 0); },

  // Extra spending (a laptop, rent...) still counts in the week, but not
  // against the daily limit. Budget spending counts in neither.
  dayTotal(list) { return Money.total(list.filter(e => !e.extra && !Money.inBudget(e))); },

  // [{ id, usd, n }] biggest first
  byCat(list) {
    const g = {};
    for (const e of list) {
      const id = Money.cat(e.cat).id;
      const x = (g[id] ||= { id, usd: 0, n: 0 });
      x.usd += Money.usd(e); x.n++;
    }
    return Object.values(g).sort((a, b) => b.usd - a.usd);
  },

  byMethod(list) {
    const m = { cash: 0, aba: 0, card: 0 };
    for (const e of list) m[methodOf(e.method)] += Money.usd(e);
    return m;
  },

  // "💵 Cash $5 · 💳 Card $12", leaving out methods with nothing spent.
  methodLine(m) {
    return Object.keys(METHODS).filter(k => m[k] > 0).map(k => `${METHODS[k]} ${Money.fmt(m[k], false)}`).join(' · ');
  },

  // date -> $ spent (leaving out extra and budget spending when `daily` is set)
  byDay(from, to, daily = false) {
    const m = {};
    for (const e of Money.list(from, to)) if (!daily || (!e.extra && !Money.inBudget(e))) m[e.date] = (m[e.date] || 0) + Money.usd(e);
    return m;
  },

  // Average per day from `from` (or the first expense ever, if later) to `to`,
  // so a new user isn't averaged over days before they started tracking.
  perDay(total, from, to) {
    const first = Store.list('expenses').reduce((m, e) => (e.date < m ? e.date : m), '9999-12-31');
    const start = first > from ? first : from;
    if (start > to) return NaN;
    const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
    const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5) + 1;
    return total / days;
  },

  // Spending weeks run Sunday to Saturday (the week's money comes on Sunday),
  // but the money is only for Monday to Friday: weekend spending is kept, just
  // not taken from it. Each week stands alone: what's left stays with that week.
  isWeekend(d) { return U.weekdayMon(d) >= 5; },

  weekStart(d) { return U.addDays(d, -((U.weekdayMon(d) + 1) % 7)); },

  weekLabel(ws) {
    const o = { weekday: 'short', day: 'numeric', month: 'short' };
    return `${U.fmtDate(ws, o)} – ${U.fmtDate(U.addDays(ws, 6), o)}`;
  },

  // The week's money is stored with the week's Sunday as its id, so each week has one.
  allowance(ws) {
    const a = Store.get('allowances', ws);
    return a && !a.deleted ? a : null;
  },

  lastAllowance(before) {
    return Store.list('allowances').filter(a => a.id < before).sort((a, b) => b.id.localeCompare(a.id))[0] || null;
  },

  week(ws) {
    const a = Money.allowance(ws);
    const all = Money.weekOnly(Money.list(ws, U.addDays(ws, 6)));
    const list = all.filter(e => !Money.isWeekend(e.date));
    const weekend = all.filter(e => Money.isWeekend(e.date));
    const spent = Money.total(list);
    const got = a ? Money.usd(a) : NaN;
    return { ws, a, all, list, weekend, spent, offWeek: Money.total(weekend), got, left: got - spent };
  },

  // Sundays of every week with money set or spending, newest first.
  weeks() {
    const s = new Set(Store.list('allowances').map(a => a.id));
    for (const e of Store.list('expenses')) if (!Money.inBudget(e)) s.add(Money.weekStart(e.date));
    return [...s].sort().reverse();
  },

  // Money stats look at the last `n` spending weeks, this week included.
  // "Done" weeks are the finished ones that have money set or spending.
  trend(n = 8) {
    const cur = Money.weekStart(U.today());
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) weeks.push(Money.week(U.addDays(cur, -7 * i)));
    const now = weeks[weeks.length - 1];
    const done = weeks.slice(0, -1).filter(w => w.a || w.list.length);
    const budgeted = done.filter(w => w.a);
    const avg = done.length ? done.reduce((a, w) => a + w.spent, 0) / done.length : NaN;
    const byLeft = [...budgeted].sort((a, b) => b.left - a.left);
    const bySpent = [...done].sort((a, b) => a.spent - b.spent);
    return {
      weeks, now, done, avg,
      last: weeks[weeks.length - 2],
      best: byLeft[0] || bySpent[0] || null,
      worst: byLeft[byLeft.length - 1] || bySpent[bySpent.length - 1] || null,
      saved: budgeted.reduce((a, w) => a + w.left, 0),
      over: budgeted.filter(w => w.left < 0).length,
      budgeted: budgeted.length,
    };
  },

  // Spent from Monday up to the same weekday as today (Friday at most), in the week starting `ws`.
  soFar(ws) {
    const days = Math.min(5, (U.weekdayMon(U.today()) + 1) % 7);
    return Money.total(Money.list(U.addDays(ws, 1), U.addDays(ws, days)).filter(e => !Money.inBudget(e)));
  },

  // Average spent on each weekday (Sun..Sat) over the given weeks.
  byWeekday(weeks) {
    const t = [0, 0, 0, 0, 0, 0, 0];
    for (const w of weeks) for (const e of w.all) t[(U.weekdayMon(e.date) + 1) % 7] += Money.usd(e);
    return t.map(v => (weeks.length ? v / weeks.length : 0));
  },

  // The week's money is meant for Monday to Friday, so the daily limit is a fifth
  // of it, and there's no limit on the weekend.
  dailyBudget(date) {
    if (Money.isWeekend(date)) return 0;
    const a = Money.allowance(Money.weekStart(date));
    return a ? Money.usd(a) / SPEND_DAYS : 0;
  },

  // A budget is money for a trip or event over any dates (3 days, 2 weeks...),
  // kept apart from the week's money: what's spent from it doesn't count in
  // the week or against the daily limit.
  budgets() {
    return Store.list('budgets').sort((a, b) => b.start.localeCompare(a.start) || (b.createdAt || 0) - (a.createdAt || 0));
  },

  budget(id) {
    const b = id && Store.get('budgets', id);
    return b && !b.deleted ? b : null;
  },

  // Paid from a budget that still exists.
  inBudget(e) { return !!Money.budget(e.budget); },

  weekOnly(list) { return list.filter(e => !Money.inBudget(e)); },
  budgetOnly(list) { return list.filter(Money.inBudget); },

  // Budgets whose dates include `date`.
  budgetsOn(date) { return Money.budgets().filter(b => b.start <= date && date <= b.end); },

  budgetLabel(b) {
    const o = { weekday: 'short', day: 'numeric', month: 'short' };
    return b.start === b.end ? U.fmtDate(b.start, o) : `${U.fmtDate(b.start, o)} – ${U.fmtDate(b.end, o)}`;
  },

  budgetStats(b) {
    const today = U.today();
    const list = Store.list('expenses').filter(e => e.budget === b.id)
      .sort((x, y) => (y.date + (y.time || '')).localeCompare(x.date + (x.time || '')) || (y.createdAt || 0) - (x.createdAt || 0));
    const spent = Money.total(list);
    const got = Money.usd(b);
    const days = U.daysBetween(b.start, b.end) + 1;
    const status = today < b.start ? 'soon' : today > b.end ? 'done' : 'on';
    const day = status === 'on' ? U.daysBetween(b.start, today) + 1 : 0;
    const daysLeft = status === 'on' ? days - day + 1 : status === 'soon' ? days : 0; // today included
    const spentToday = status === 'on' ? Money.total(list.filter(e => e.date === today)) : 0;
    // What's left (today's spending put back) shared over the days left, so today gets its fair part.
    const daily = daysLeft ? (got - spent + spentToday) / daysLeft : NaN;
    return { b, list, spent, got, left: got - spent, days, status, day, daysLeft, spentToday, daily };
  },
};
