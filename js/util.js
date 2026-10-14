'use strict';

// All dates and times in the app are Cambodia time (UTC+7, no daylight saving).
const TZ = 'Asia/Phnom_Penh';

// Built-in pairs. Your own list (names, units, $ per point) lives in Pairs;
// mult is still needed to read old trades that stored prices.
const PAIRS = {
  NAS100: { unit: 'pts', mult: 1, dp: 1, value: 1 },
  XAUUSD: { unit: 'pts', mult: 1, dp: 2, value: 100 },
  EURUSD: { unit: 'pips', mult: 10000, dp: 1, value: 10 },
};

// Session windows in each market's own local time, so London/New York
// daylight-saving changes are handled automatically.
const SESSIONS = [
  { name: 'Asia', tz: 'Asia/Tokyo', from: 9, to: 17 },
  { name: 'London', tz: 'Europe/London', from: 8, to: 17 },
  { name: 'New York', tz: 'America/New_York', from: 8, to: 17 },
];

const U = {
  uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  },

  parts(date, tz) {
    const o = {};
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    for (const p of f.formatToParts(date)) o[p.type] = p.value;
    return o;
  },

  today() {
    const p = U.parts(new Date(), TZ);
    return `${p.year}-${p.month}-${p.day}`;
  },

  nowTime() {
    const p = U.parts(new Date(), TZ);
    return `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
  },

  addDays(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  },

  // 0 = Monday ... 6 = Sunday
  weekdayMon(s) {
    const [y, m, d] = s.split('-').map(Number);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  },

  fmtDate(s, opts) {
    const [y, m, d] = s.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
  },

  dayLabel(s) {
    const t = U.today();
    const base = U.fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
    if (s === t) return `Today · ${base}`;
    if (s === U.addDays(t, 1)) return `Tomorrow · ${base}`;
    if (s === U.addDays(t, -1)) return `Yesterday · ${base}`;
    return U.fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

  minutesIn(date, tz) {
    const p = U.parts(date, tz);
    return (+p.hour % 24) * 60 + +p.minute;
  },

  session(dateStr, timeStr) {
    if (!dateStr || !/^\d{1,2}:\d{2}$/.test(timeStr || '')) return '';
    const d = new Date(`${dateStr}T${timeStr.padStart(5, '0')}:00+07:00`);
    if (isNaN(d)) return '';
    const open = {};
    for (const s of SESSIONS) {
      const m = U.minutesIn(d, s.tz);
      open[s.name] = m >= s.from * 60 && m < s.to * 60;
    }
    if (open.London && open['New York']) return 'London/NY overlap';
    if (open['New York']) return 'New York';
    if (open.London) return 'London';
    if (open.Asia) return 'Asia';
    return 'Off-session';
  },

  num(v) {
    if (v === null || v === undefined || v === '') return NaN;
    return parseFloat(String(v).replace(',', '.'));
  },

  calc(t) {
    const P = PAIRS[t.pair] || { unit: 'pts', mult: 1 };
    const pnl = U.num(t.pnl);
    let move = U.num(t.points);
    let risk = U.num(t.slPts);
    // Trades saved before the points-only form stored prices instead.
    if (!isFinite(move) || (!isFinite(risk) && t.entry !== undefined)) {
      const dir = t.side === 'Sell' ? -1 : 1;
      const e = U.num(t.entry), x = U.num(t.exit), sl = U.num(t.sl);
      if (!isFinite(move) && isFinite(e) && isFinite(x)) move = (x - e) * dir * P.mult;
      if (!isFinite(risk) && isFinite(e) && isFinite(sl)) risk = Math.abs(e - sl) * P.mult;
    }
    const rr = isFinite(move) && risk > 0 ? move / risk : NaN;
    const result = t.result || (!isFinite(pnl) ? '' : pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'BE');
    return { move, risk, unit: Pairs.unit(t.pair), rr, result, session: U.session(t.date, t.time) };
  },

  money(n, signed = true) {
    if (!isFinite(n)) return '–';
    const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!signed) return `$${s}`;
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}$${s}`;
  },

  moneyShort(n) {
    if (!isFinite(n) || n === 0) return '0';
    const a = Math.abs(n);
    const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : Math.round(a).toString();
    return (n > 0 ? '+' : '−') + s;
  },

  fmtMove(move, unit) {
    if (!isFinite(move)) return '';
    const v = Math.round(move * 10) / 10;
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} ${unit}`;
  },

  fmtRR(rr) {
    if (!isFinite(rr)) return '';
    return `${rr < 0 ? '−' : ''}${Math.abs(rr).toFixed(2)}R`;
  },

  cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat'; },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};
