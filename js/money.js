'use strict';

// Spending tracker. Each expense keeps the amount and currency as typed;
// totals are always in dollars, with riel converted at a fixed rate.

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

const METHODS = { cash: '💵 Cash', aba: '🏦 ABA' };

const Money = {
  usd(e) {
    const v = U.num(e.amount);
    if (!isFinite(v)) return 0;
    return e.cur === 'KHR' ? v / KHR_PER_USD : v;
  },

  // Commas are thousands separators ("10,000"), except a dollar amount
  // like "2,50" where the comma is the decimal point.
  parse(str, cur) {
    let s = String(str || '').trim().replace(/\s/g, '');
    if (cur === 'USD' && /^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  },

  fmtKHR(n) {
    return `${Math.round(n).toLocaleString('en-US')}៛`;
  },

  // How the amount was typed: "$2.50" or "10,000៛".
  fmtOrig(e) {
    const v = U.num(e.amount);
    return e.cur === 'KHR' ? Money.fmtKHR(v) : U.money(v, false);
  },

  // Short dollar amount for calendar cells: $8, $12.5, $1.2k
  short(n) {
    if (!(n > 0)) return '';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return '$' + (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
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
    const m = { cash: 0, aba: 0 };
    for (const e of list) m[e.method === 'aba' ? 'aba' : 'cash'] += Money.usd(e);
    return m;
  },

  // date -> $ spent
  byDay(from, to) {
    const m = {};
    for (const e of Money.list(from, to)) m[e.date] = (m[e.date] || 0) + Money.usd(e);
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

  // Spending weeks run Sunday to Saturday (the week's money comes on Sunday).
  // Each week stands alone: what's left stays with that week.
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
    const list = Money.list(ws, U.addDays(ws, 6));
    const spent = Money.total(list);
    const got = a ? Money.usd(a) : NaN;
    return { ws, a, list, spent, got, left: got - spent };
  },

  // Sundays of every week with money set or spending, newest first.
  weeks() {
    const s = new Set(Store.list('allowances').map(a => a.id));
    for (const e of Store.list('expenses')) s.add(Money.weekStart(e.date));
    return [...s].sort().reverse();
  },

  // The week's money is meant for 5 spending days, so the daily limit is a fifth of it.
  dailyBudget(date) {
    const a = Money.allowance(Money.weekStart(date));
    return a ? Money.usd(a) / SPEND_DAYS : 0;
  },
};
