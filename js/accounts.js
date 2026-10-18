'use strict';

// Trading accounts: Live (balance + deposits/withdrawals) and Funded (prop firm rules).
// Funded rules use the MT5 server day, which ends at 17:00 New York
// (about 04:00 Cambodia in summer, 05:00 in winter), so one NY session
// isn't split across two days.

const Acct = {
  // A rule value the user typed as $ or % of the starting balance.
  amount(field, base) {
    if (!field) return NaN;
    const v = U.num(field.v);
    if (!(v > 0)) return NaN;
    return field.unit === '%' ? base * v / 100 : v;
  },

  fmtRule(field) {
    if (!field || !(U.num(field.v) > 0)) return '';
    return field.unit === '%' ? `${U.num(field.v)}%` : U.money(U.num(field.v), false);
  },

  serverDayAt(date) {
    const p = U.parts(new Date(date.getTime() + 7 * 3600e3), 'America/New_York');
    return `${p.year}-${p.month}-${p.day}`;
  },

  serverDay(dateStr, timeStr) {
    const d = new Date(`${dateStr}T${(timeStr || '12:00').padStart(5, '0')}:00+07:00`);
    return isNaN(d) ? dateStr : Acct.serverDayAt(d);
  },

  all() {
    return Store.list('accounts').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  label(a) {
    return a ? a.name || (a.type === 'funded' ? 'Funded account' : 'Live account') : 'No account';
  },

  trades(a) {
    return Store.list('trades')
      .filter(t => t.accountId === a.id)
      .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  },

  // onStep(trade, balance, failLine) is called after each trade of a funded account.
  stats(a, onStep) {
    const start = U.num(a.startBalance) || 0;
    const trades = Acct.trades(a);
    const pnl = trades.reduce((s, t) => s + (U.num(t.pnl) || 0), 0);
    const today = U.today();
    const r = { start, pnl, trades: trades.length, status: a.status || 'active' };

    if (a.type !== 'funded') {
      const flows = (a.cashflows || []).map(f => U.num(f.amount) || 0);
      r.deposits = flows.filter(v => v > 0).reduce((s, v) => s + v, 0);
      r.withdrawals = -flows.filter(v => v < 0).reduce((s, v) => s + v, 0);
      r.balance = start + r.deposits - r.withdrawals + pnl;
      r.todayPnl = trades.filter(t => t.date === today).reduce((s, t) => s + (U.num(t.pnl) || 0), 0);
      const invested = start + r.deposits;
      r.returnPct = invested > 0 ? pnl / invested * 100 : NaN;
      return r;
    }

    const dd = a.ddType || 'static';
    const dailyLimit = Acct.amount(a.dailyLoss, start);
    const maxLoss = Acct.amount(a.maxLoss, start);
    const target = Acct.amount(a.target, start);
    let bal = start, peak = start, eodPeak = start;
    let curDay = null, dayStart = start, breach = null;
    const dayPnl = {};

    const failLine = () => {
      if (!isFinite(maxLoss)) return NaN;
      const base = dd === 'static' ? start : dd === 'trailing' ? peak : eodPeak;
      let line = base - maxLoss;
      if (a.lockAtStart && dd !== 'static') line = Math.min(line, start);
      return line;
    };

    for (const t of trades) {
      const d = Acct.serverDay(t.date, t.time);
      if (d !== curDay) {
        // A new server day: the previous day's closing balance can raise the EOD high.
        if (curDay !== null) eodPeak = Math.max(eodPeak, bal);
        curDay = d;
        dayStart = bal;
      }
      bal += U.num(t.pnl) || 0;
      peak = Math.max(peak, bal);
      dayPnl[d] = bal - dayStart;
      const line = failLine();
      if (onStep) onStep(t, bal, line);
      if (!breach && isFinite(line) && bal <= line) breach = { rule: 'max', date: t.date, line };
      if (!breach && isFinite(dailyLimit) && dayPnl[d] <= -dailyLimit) breach = { rule: 'daily', date: t.date };
    }

    const nowDay = Acct.serverDayAt(new Date());
    if (curDay !== null && curDay !== nowDay) eodPeak = Math.max(eodPeak, bal);
    const todayPnl = dayPnl[nowDay] || 0;

    Object.assign(r, {
      balance: bal,
      todayPnl,
      dailyLimit,
      dailyLeft: isFinite(dailyLimit) ? dailyLimit + todayPnl : NaN,
      maxLoss,
      failLine: failLine(),
      target,
      breach,
    });
    r.distance = isFinite(r.failLine) ? bal - r.failLine : NaN;
    r.progress = target > 0 ? (bal - start) / target * 100 : NaN;
    r.targetHit = target > 0 && bal - start >= target;
    if (r.status !== 'passed' && breach) r.status = 'failed';
    return r;
  },

  // Balance after each step, oldest first: [{ date, time, bal, line, trade | flow | start }].
  // Live accounts include deposits and withdrawals; funded ones carry the fail line.
  curve(a) {
    const start = U.num(a.startBalance) || 0;
    const pts = [];
    if (a.type === 'funded') {
      const maxLoss = Acct.amount(a.maxLoss, start);
      pts.push({ start: true, bal: start, line: start - maxLoss });
      Acct.stats(a, (t, bal, line) => pts.push({ date: t.date, time: t.time, bal, line, trade: t }));
    } else {
      pts.push({ start: true, bal: start, line: NaN });
      const steps = [
        ...Acct.trades(a).map(t => ({ date: t.date, time: t.time, v: U.num(t.pnl) || 0, trade: t })),
        ...(a.cashflows || []).map(f => ({ date: f.date, time: '00:00', v: U.num(f.amount) || 0, flow: f })),
      ].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
      let bal = start;
      for (const s of steps) {
        bal += s.v;
        pts.push({ date: s.date, time: s.time, bal, line: NaN, trade: s.trade, flow: s.flow });
      }
    }
    pts[0].date = pts[1] ? pts[1].date : '';
    return pts;
  },
};
