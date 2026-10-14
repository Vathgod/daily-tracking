'use strict';

// Pairs you trade. The three built-ins keep their ids so every device agrees;
// a stored item (or delete marker) with the same id wins, like categories.
// Trades store the pair's name, so renaming a pair renames it on its trades.

const DEFAULT_PAIRS = [
  { id: 'NAS100', name: 'NAS100', unit: 'pts', value: '1', color: 'var(--c-nas)' },
  { id: 'XAUUSD', name: 'XAUUSD', unit: 'pts', value: '100', color: 'var(--c-xau)' },
  { id: 'EURUSD', name: 'EURUSD', unit: 'pips', value: '10', color: 'var(--c-eur)' },
];

// Colors for pairs you add, picked in order, skipping ones in use.
const PAIR_COLORS = ['#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0d9488', '#dc2626', '#2563eb', '#ca8a04'];

const Pairs = {
  all() {
    // $ per point used to live in Settings; keep what was set there.
    const pv = Store.settings().pointValue || {};
    const out = [];
    DEFAULT_PAIRS.forEach((d, i) => {
      if (Store.get('pairs', d.id)) return;
      const v = U.num(pv[d.id]);
      out.push({ ...d, value: v > 0 ? String(v) : d.value, createdAt: i });
    });
    out.push(...Store.list('pairs'));
    return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  active() { return Pairs.all().filter(p => !p.hidden); },

  get(name) { return Pairs.all().find(p => p.name === name) || null; },

  unit(name) { const p = Pairs.get(name); return p ? p.unit : (PAIRS[name] || PAIRS.NAS100).unit; },

  // $ value of 1 point (or pip) for 1.00 lot.
  value(name) { const p = Pairs.get(name); const v = p ? U.num(p.value) : NaN; return v > 0 ? v : NaN; },

  color(name) { const p = Pairs.get(name); return p ? p.color : 'var(--c-off)'; },

  // Inline style that gives an element the pair's color as --pc.
  style(name) { return `--pc:${Pairs.color(name)}`; },

  trades(name) { return Store.list('trades').filter(t => t.pair === name); },

  nextColor() {
    const used = new Set(Pairs.active().map(p => p.color));
    return PAIR_COLORS.find(c => !used.has(c)) || PAIR_COLORS[Pairs.all().length % PAIR_COLORS.length];
  },
};
