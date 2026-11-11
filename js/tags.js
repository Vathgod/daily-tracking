'use strict';

// Trade tags: one setup per trade, any number of mistakes, and any number of
// emotions, each with a strength 1-5 ({ id, lv }) and marked good or bad
// (mood). Day tags go on a
// day's recap ("No displacement", "Missed news"...). The built-ins keep
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
  { id: 'e-calm', kind: 'emotion', name: 'Calm', mood: 'good' },
  { id: 'e-confident', kind: 'emotion', name: 'Confident', mood: 'good' },
  { id: 'e-fear', kind: 'emotion', name: 'Fear', mood: 'bad' },
  { id: 'e-greed', kind: 'emotion', name: 'Greed', mood: 'bad' },
  { id: 'e-fomo', kind: 'emotion', name: 'FOMO', mood: 'bad' },
  { id: 'e-revenge', kind: 'emotion', name: 'Revenge', mood: 'bad' },
  { id: 'd-nodisp', kind: 'day', name: 'No displacement' },
  { id: 'd-news', kind: 'day', name: 'Missed news' },
  { id: 'd-choppy', kind: 'day', name: 'Choppy market' },
  { id: 'd-overtrade', kind: 'day', name: 'Overtraded' },
  { id: 'd-plan', kind: 'day', name: 'Followed plan' },
  { id: 'd-patient', kind: 'day', name: 'Patient' },
];

const Tags = {
  all(kind) {
    const out = [];
    DEFAULT_TAGS.forEach((d, i) => {
      if (!Store.get('tags', d.id)) out.push({ ...d, createdAt: i });
    });
    // An emotion saved without a mood keeps its built-in one (or counts as bad).
    out.push(...Store.list('tags').map(t => t.kind === 'emotion' && !t.mood
      ? { ...t, mood: (DEFAULT_TAGS.find(d => d.id === t.id) || {}).mood || 'bad' } : t));
    return out.filter(t => !kind || t.kind === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  active(kind) { return Tags.all(kind).filter(t => !t.hidden); },

  get(id) { return Tags.all().find(t => t.id === id) || null; },

  name(id) { const t = Tags.get(id); return t ? t.name : ''; },

  // The trade's mistakes that still exist.
  mistakes(trade) { return (trade.mistakes || []).filter(id => Tags.get(id)); },

  // The trade's emotions that still exist, as [{ id, lv }].
  emotions(trade) {
    return (trade.emotions || []).filter(e => e && Tags.get(e.id))
      .map(e => ({ id: e.id, lv: Math.min(5, Math.max(1, Math.round(+e.lv) || 3)) }));
  },

  good(id) { const t = Tags.get(id); return !!t && t.mood === 'good'; },

  setup(trade) { return trade.setup && Tags.get(trade.setup) ? trade.setup : ''; },

  trades(id) { return Store.list('trades').filter(t => t.setup === id || (t.mistakes || []).includes(id)
    || (t.emotions || []).some(e => e && e.id === id)); },

  // Trades or day recaps that carry the tag.
  uses(id) { return Tags.trades(id).length + Store.list('recaps').filter(r => (r.tags || []).includes(id)).length; },
};
