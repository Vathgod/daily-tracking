'use strict';

// Planner performance: daily completion score, streaks and week/month summaries.
// Today is "in progress" until it ends, so summaries only count finished days.

const GOOD = 70; // a day counts for the streak at 70% or more

const Perf = {
  band(pct) {
    if (!isFinite(pct)) return 'none';
    if (pct >= 100) return 'perfect';
    if (pct >= GOOD) return 'good';
    if (pct >= 40) return 'ok';
    return 'bad';
  },

  bandLabel(b) {
    return { perfect: 'Perfect', good: 'Good', ok: 'Okay', bad: 'Bad', none: '–' }[b];
  },

  // date -> { total, done, pct }
  days(from, to) {
    const m = {};
    for (const t of Store.list('tasks')) {
      if (t.date < from || t.date > to) continue;
      const d = (m[t.date] ||= { total: 0, done: 0 });
      d.total++;
      if (t.done) d.done++;
    }
    for (const d of Object.values(m)) d.pct = d.done / d.total * 100;
    return m;
  },

  day(date) {
    return Perf.days(date, date)[date] || null;
  },

  summary(from, to) {
    const today = U.today();
    const end = to >= today ? U.addDays(today, -1) : to;
    const days = Perf.days(from, end);
    const list = Object.entries(days);
    const s = {
      tracked: list.length,
      avg: list.length ? list.reduce((a, [, d]) => a + d.pct, 0) / list.length : NaN,
      done: list.reduce((a, [, d]) => a + d.done, 0),
      planned: list.reduce((a, [, d]) => a + d.total, 0),
      perfect: list.filter(([, d]) => d.pct >= 100).length,
      good: list.filter(([, d]) => d.pct >= GOOD).length,
    };
    s.missed = s.planned - s.done;

    // Average score per weekday (Mon..Sun)
    const wd = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (const [date, d] of list) { const w = wd[U.weekdayMon(date)]; w.sum += d.pct; w.n++; }
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const ranked = wd.map((w, i) => ({ name: names[i], avg: w.n ? w.sum / w.n : NaN, n: w.n })).filter(w => w.n);
    if (ranked.length >= 2) {
      s.bestWeekday = ranked.reduce((a, b) => (b.avg > a.avg ? b : a));
      s.worstWeekday = ranked.reduce((a, b) => (b.avg < a.avg ? b : a));
      if (s.bestWeekday.avg === s.worstWeekday.avg) s.bestWeekday = s.worstWeekday = null;
    }

    // Activities skipped most often (same text, any capitalisation)
    const missed = {};
    for (const t of Store.list('tasks')) {
      if (t.date < from || t.date > end || t.done) continue;
      const k = t.text.trim().toLowerCase();
      (missed[k] ||= { text: t.text.trim(), n: 0 }).n++;
    }
    s.mostMissed = Object.values(missed).filter(m => m.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3);
    return s;
  },

  // Days in a row at 70%+, counting back from today. Days with nothing
  // planned are skipped (a rest day doesn't break the streak).
  streak() {
    const today = U.today();
    const all = Perf.days('0000-00-00', today);
    let n = 0;
    if (all[today] && all[today].pct >= GOOD) n++;
    const dates = Object.keys(all).filter(d => d < today).sort().reverse();
    for (const d of dates) {
      if (all[d].pct >= GOOD) n++; else break;
    }
    let best = 0, run = 0;
    for (const d of Object.keys(all).filter(x => x < today).sort()) {
      run = all[d].pct >= GOOD ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return { current: n, best: Math.max(best, n) };
  },

  weekStart(date) { return U.addDays(date, -U.weekdayMon(date)); },
};
