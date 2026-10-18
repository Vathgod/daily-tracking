'use strict';

// Trade tags: one setup per trade, any number of mistakes. The built-ins keep
// their ids so every device agrees; a stored item (or delete marker) with the
// same id wins, like pairs. Trades store tag ids, so renaming just works.

const DEFAULT_TAGS = [
  { id: 's-breakout', kind: 'setup', name: 'Breakout' },
  { id: 's-pullback', kind: 'setup', name: 'Pullback' },
  { id: 's-reversal', kind: 'setup', name: 'Reversal' },
  { id: 'm-fomo', kind: 'mistake', name: 'FOMO' },
  { id: 'm-movedsl', kind: 'mistake', name: 'Moved SL' },
  { id: 'm-noplan', kind: 'mistake', name: 'No plan' },
  { id: 'm-revenge', kind: 'mistake', name: 'Revenge' },
  { id: 'm-overtrade', kind: 'mistake', name: 'Overtrading' },
];

const Tags = {
  all(kind) {
    const out = [];
    DEFAULT_TAGS.forEach((d, i) => {
      if (!Store.get('tags', d.id)) out.push({ ...d, createdAt: i });
    });
    out.push(...Store.list('tags'));
    return out.filter(t => !kind || t.kind === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  active(kind) { return Tags.all(kind).filter(t => !t.hidden); },

  get(id) { return Tags.all().find(t => t.id === id) || null; },

  name(id) { const t = Tags.get(id); return t ? t.name : ''; },

  // The trade's mistakes that still exist.
  mistakes(trade) { return (trade.mistakes || []).filter(id => Tags.get(id)); },

  setup(trade) { return trade.setup && Tags.get(trade.setup) ? trade.setup : ''; },

  trades(id) { return Store.list('trades').filter(t => t.setup === id || (t.mistakes || []).includes(id)); },
};
