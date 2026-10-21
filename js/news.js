'use strict';

// Economic calendar for Calendar → News. A GitHub Action in the app repo
// (.github/workflows/news.yml) saves this week's Forex Factory events to
// news.json on the `news` branch every hour. The app reads it from there
// (no token needed) and keeps the last copy on this device for offline.

const NEWS_URLS = [
  'https://raw.githubusercontent.com/Vathgod/daily-tracking/news/news.json',
  'news.json', // a copy next to the app, for running it locally
];
const NEWS_LS = 'dt.news';
const NEWS_STALE = 30 * 60 * 1000; // fetch again after 30 min
const NEWS_RETRY = 2 * 60 * 1000; // wait 2 min after a failed fetch
const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY'];
// Markets whose news comes from a currency that isn't in their name.
const MARKET_CURS = {
  XAU: 'USD', XAG: 'USD', NAS: 'USD', US30: 'USD', US100: 'USD', US500: 'USD', SPX: 'USD', DXY: 'USD', BTC: 'USD',
  GER: 'EUR', DE40: 'EUR', DAX: 'EUR', UK100: 'GBP', JP225: 'JPY',
};

const News = (() => {
  let data = read(); // { fetchedAt, updated, events: [raw feed events] }
  let loading = null;
  let lastTry = 0;
  let error = '';
  let parsed = [];
  let parsedFrom = null;

  function read() {
    try {
      const d = JSON.parse(localStorage.getItem(NEWS_LS));
      return d && Array.isArray(d.events) ? d : null;
    } catch (e) { return null; }
  }

  async function fetchFile(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.events)) throw new Error('Not a news file');
    return j;
  }

  // Resolves true when there is something new to show (news or an error).
  function load(force = false) {
    if (loading) return loading;
    const now = Date.now();
    if (!force && data && now - data.fetchedAt < NEWS_STALE) return Promise.resolve(false);
    if (!force && now - lastTry < NEWS_RETRY) return Promise.resolve(false);
    lastTry = now;
    loading = (async () => {
      for (const url of NEWS_URLS) {
        try {
          const j = await fetchFile(url);
          data = { fetchedAt: Date.now(), updated: j.updated || '', events: j.events };
          try { localStorage.setItem(NEWS_LS, JSON.stringify(data)); } catch (e) { /* keep it in memory */ }
          error = '';
          return true;
        } catch (e) { /* try the next one */ }
      }
      error = navigator.onLine === false ? "You're offline." : "Couldn't load the news.";
      return true;
    })().finally(() => { loading = null; });
    return loading;
  }

  // Events in Cambodia time, oldest first.
  function events() {
    if (!data) return [];
    if (parsedFrom !== data) {
      parsed = data.events.map((e, i) => {
        const d = new Date(e.date);
        if (isNaN(d)) return null;
        const p = U.parts(d, TZ);
        return {
          id: i,
          at: +d,
          date: `${p.year}-${p.month}-${p.day}`,
          time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`,
          title: e.title || '',
          cur: e.country || '',
          impact: IMPACTS.includes(e.impact) ? e.impact : 'Low',
          forecast: e.forecast || '',
          previous: e.previous || '',
        };
      }).filter(Boolean).sort((a, b) => a.at - b.at);
      parsedFrom = data;
    }
    return parsed;
  }

  // Currencies whose news moves the pairs you trade (NAS100 and XAUUSD → USD).
  function myCurs() {
    const s = new Set();
    for (const p of Pairs.active()) {
      const n = p.name.toUpperCase();
      for (const c of CURRENCIES) if (n.includes(c)) s.add(c);
      for (const [k, c] of Object.entries(MARKET_CURS)) if (n.startsWith(k)) s.add(c);
    }
    return CURRENCIES.filter(c => s.has(c));
  }

  function filtered({ high, mine }) {
    const curs = mine && myCurs().length ? new Set(myCurs()) : null;
    return events().filter(e => (!high || e.impact === 'High') && (!curs || curs.has(e.cur) || e.cur === 'All'));
  }

  // First and last day the news file covers.
  function range() {
    const ev = events();
    return ev.length ? [ev[0].date, ev[ev.length - 1].date] : [null, null];
  }

  return {
    load, events, filtered, myCurs, range,
    has: () => !!data,
    updated: () => (data && data.updated) || '',
    loading: () => !!loading,
    error: () => error,
  };
})();
