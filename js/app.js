'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

const ui = {
  tab: lsGet('dt.tab', 'plan'),
  planDate: U.today(),
  tradeRange: 'month',
  tradePair: 'all',
  calMonth: U.today().slice(0, 7),
  calDay: U.today(),
  statsRange: 'month',
  statsFrom: U.addDays(U.today(), -29),
  statsTo: U.today(),
  statsSection: lsGet('dt.statsSec', 'trading'),
  calMode: 'pnl',
  acct: lsGet('dt.acct', 'all'),
};

// ---------- Helpers ----------

function rangeDates(key, from, to) {
  const t = U.today();
  if (key === 'today') return [t, t];
  if (key === 'week') return [U.addDays(t, -U.weekdayMon(t)), t];
  if (key === 'month') return [t.slice(0, 8) + '01', t];
  if (key === 'custom') return [from || '0000-00-00', to || '9999-12-31'];
  return ['0000-00-00', '9999-12-31'];
}

function tradesIn(from, to, pair = 'all', acct = ui.acct) {
  return Store.list('trades')
    .filter(t => t.date >= from && t.date <= to && (pair === 'all' || t.pair === pair) && (acct === 'all' || t.accountId === acct))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

function tasksOn(date) {
  return Store.list('tasks').filter(t => t.date === date).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function sumPnl(trades) { return trades.reduce((s, t) => s + (U.num(t.pnl) || 0), 0); }

function isMissed(task, today = U.today()) { return !task.done && task.date < today; }

function chips(act, current, items) {
  return `<div class="chips">${items.map(([v, label]) =>
    `<button type="button" class="chip${v === current ? ' on' : ''}" data-act="${act}" data-v="${v}">${label}</button>`).join('')}</div>`;
}

function toast(msg) {
  const el = $('#toast');
  // Open modal dialogs sit above the page, so show the toast inside them.
  const host = $('dialog[open]') || document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Plan ----------

function taskRow(t, today, { showDate = false } = {}) {
  const missed = isMissed(t, today);
  let tail = '';
  if (missed && t.movedTo) {
    tail = `<span class="badge muted">Moved → ${U.esc(U.fmtDate(t.movedTo, { day: 'numeric', month: 'short' }))}</span>`;
  } else if (missed) {
    tail = `<span class="badge red">Missed</span><button type="button" class="mini" data-act="moveToday" data-id="${t.id}">→ Today</button>`;
  }
  return `<li class="task${t.done ? ' done' : ''}${missed ? ' missed' : ''}">
    <label class="check"><input type="checkbox" data-act="toggleTask" data-id="${t.id}"${t.done ? ' checked' : ''}><span class="box" aria-hidden="true"></span>
      <span class="text">${U.esc(t.text)}${showDate ? `<small>${U.esc(U.fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</small>` : ''}</span></label>
    ${tail}
    <button type="button" class="icon del" data-act="delTask" data-id="${t.id}" aria-label="Delete">×</button>
  </li>`;
}

function viewPlan() {
  const today = U.today();
  const d = ui.planDate;
  const tasks = tasksOn(d);
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  const missedEarlier = d === today
    ? Store.list('tasks').filter(t => isMissed(t, today) && !t.movedTo).sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const hint = d === U.addDays(today, 1) ? 'Planning tomorrow. Write what you will do.'
    : d < today ? 'Looking back. Unticked activities are marked missed.' : '';

  return `<section class="view">
    <div class="datebar">
      <button type="button" class="icon nav" data-act="planShift" data-v="-1" aria-label="Previous day">‹</button>
      <label class="datepick"><span>${U.esc(U.dayLabel(d))}</span><input type="date" id="planDate" value="${d}" aria-label="Pick a date"></label>
      <button type="button" class="icon nav" data-act="planShift" data-v="1" aria-label="Next day">›</button>
    </div>
    ${chips('planJump', d === today ? 'today' : d === U.addDays(today, 1) ? 'tomorrow' : '', [['today', 'Today'], ['tomorrow', 'Tomorrow']])}
    ${hint ? `<p class="hint">${hint}</p>` : ''}

    <div class="card progress">
      <div class="row"><strong>${done}/${tasks.length} done</strong>
        <span class="muted">${tasks.length ? `${d < today ? `<span class="band b-${Perf.band(pct)}">${Perf.bandLabel(Perf.band(pct))}</span> ` : ''}${pct}%` : 'No activities yet'}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${d === today ? weekLine() : ''}
    </div>

    <form id="taskForm" class="addrow" autocomplete="off">
      <input id="taskInput" placeholder="Add an activity…" maxlength="200" enterkeyhint="done">
      <button class="btn primary" type="submit">Add</button>
    </form>

    ${tasks.length ? `<ul class="tasks">${tasks.map(t => taskRow(t, today)).join('')}</ul>`
      : `<p class="empty">Nothing planned for this day.</p>`}

    ${missedEarlier.length ? `<details class="card missedbox"${missedEarlier.length <= 3 ? ' open' : ''}>
      <summary><span class="badge red">${missedEarlier.length}</span> Missed from earlier days</summary>
      <ul class="tasks">${missedEarlier.map(t => taskRow(t, today, { showDate: true })).join('')}</ul>
    </details>` : ''}
  </section>`;
}

function weekLine() {
  const today = U.today();
  const w = Perf.summary(Perf.weekStart(today), today);
  const st = Perf.streak();
  return `<button type="button" class="weekline" data-act="goActivities">
    <span>This week: <b>${isFinite(w.avg) ? Math.round(w.avg) + '%' : '–'}</b></span>
    <span>🔥 <b>${st.current}</b>-day streak</span></button>`;
}

// ---------- Accounts ----------

const STATUS_LABEL = { active: 'Active', passed: 'Passed', failed: 'Failed' };

function acctChips() {
  const accts = Acct.all();
  if (!accts.length) return '';
  const mark = a => ({ passed: ' ✅', failed: ' ❌' }[Acct.stats(a).status] || '');
  return chips('acct', ui.acct, [['all', 'All accounts'], ...accts.map(a => [a.id, U.esc(Acct.label(a)) + mark(a)])]);
}

function meter(label, value, pct, level = '') {
  const w = Math.max(0, Math.min(100, isFinite(pct) ? pct : 0));
  return `<div class="meter ${level}">
    <div class="row small"><span>${label}</span><span>${value}</span></div>
    <div class="bar"><i style="width:${w}%"></i></div>
  </div>`;
}

function riskLevel(pct) { return pct >= 100 ? 'hit' : pct >= 75 ? 'warn' : ''; }

function acctCard(a, full) {
  const s = Acct.stats(a);
  const funded = a.type === 'funded';
  const head = `<div class="ac-head">
      <span class="ac-type ${funded ? 'funded' : 'live'}">${funded ? 'Funded' : 'Live'}</span>
      <b class="ac-name">${U.esc(Acct.label(a))}</b>
      <span class="st st-${s.status}">${STATUS_LABEL[s.status]}</span>
    </div>
    ${a.firm ? `<div class="muted small">${U.esc(a.firm)}</div>` : ''}`;
  const pctTxt = s.start > 0 ? ` (${s.pnl >= 0 ? '+' : '−'}${Math.abs(s.pnl / s.start * 100).toFixed(2)}%)` : '';
  const bal = `<div class="ac-bal"><span class="ac-money">${U.money(s.balance, false)}</span>
    <span class="small ${U.cls(s.pnl)}">${U.money(s.pnl)}${pctTxt}</span></div>`;

  if (!full) {
    let line;
    if (funded) {
      line = [`Trading day <b class="${U.cls(s.todayPnl)}">${U.money(s.todayPnl)}</b>`,
        isFinite(s.dailyLeft) ? `Daily left <b>${U.money(Math.max(0, s.dailyLeft), false)}</b>` : '',
        isFinite(s.distance) ? `Fail line <b>${U.money(Math.max(0, s.distance), false)}</b> away` : ''].filter(Boolean).join(' · ');
    } else {
      line = `Today <b class="${U.cls(s.todayPnl)}">${U.money(s.todayPnl)}</b> · ${s.trades} trade${s.trades === 1 ? '' : 's'}`;
    }
    return `<button type="button" class="card acct ${funded ? 'funded' : 'live'} s-${s.status}" data-act="acct" data-v="${a.id}">
      ${head}${bal}<div class="small muted ac-line">${line}</div></button>`;
  }

  let body = '';
  if (funded) {
    if (s.breach) {
      body += `<div class="banner red">❌ ${s.breach.rule === 'daily' ? 'Max daily loss' : 'Fail line'} hit on ${U.esc(U.fmtDate(s.breach.date, { day: 'numeric', month: 'short' }))}.</div>`;
    } else if (s.targetHit && s.status === 'active') {
      body += `<div class="banner green">🎯 Profit target reached! Mark this account as Passed in Edit.</div>`;
    }
    if (isFinite(s.dailyLimit)) {
      const used = Math.max(0, -s.todayPnl);
      body += meter('Daily loss (this trading day)', `${U.money(-used)} / ${U.money(-s.dailyLimit)} · ${U.money(Math.max(0, s.dailyLeft), false)} left`,
        used / s.dailyLimit * 100, riskLevel(used / s.dailyLimit * 100));
    }
    if (isFinite(s.failLine)) {
      const used = s.maxLoss - s.distance;
      body += meter('Max loss', `Fail line ${U.money(s.failLine, false)} · ${U.money(Math.max(0, s.distance), false)} away`,
        used / s.maxLoss * 100, riskLevel(used / s.maxLoss * 100));
    }
    if (s.target > 0) {
      body += meter('Profit target', `${U.money(s.balance - s.start)} / ${U.money(s.target)} · ${Math.max(0, Math.round(s.progress))}%`, s.progress, 'goal');
    }
    const dd = { static: 'Static', trailing: 'Trailing', eod: 'EOD trailing' }[a.ddType || 'static'];
    body += `<p class="muted small ac-rules">${dd} drawdown${a.lockAtStart && a.ddType !== 'static' ? ', stops at starting balance' : ''}
      · daily ${Acct.fmtRule(a.dailyLoss) || '–'} · max ${Acct.fmtRule(a.maxLoss) || '–'} · start ${U.money(s.start, false)}</p>`;
  } else {
    body += `<div class="statrow ac-live">
      <div><span>Deposits</span><b>${U.money(s.deposits, false)}</b></div>
      <div><span>Withdrawals</span><b>${U.money(s.withdrawals, false)}</b></div>
      <div><span>Return</span><b class="${U.cls(s.returnPct)}">${isFinite(s.returnPct) ? (s.returnPct >= 0 ? '+' : '−') + Math.abs(s.returnPct).toFixed(2) + '%' : '–'}</b></div>
    </div>`;
  }
  return `<div class="card acct full ${funded ? 'funded' : 'live'} s-${s.status}">
    ${head}${bal}${body}
    <button type="button" class="btn ghost block" data-act="editAcct" data-id="${a.id}">Edit account</button>
  </div>`;
}

function acctSection() {
  const accts = Acct.all();
  if (!accts.length) {
    return `<div class="card empty-acct">
      <b>Add your trading accounts</b>
      <p class="muted small">Live or Funded. Each trade goes to an account, and the app tracks balance, daily loss and fail line for you.</p>
      <button type="button" class="btn primary block" data-act="newAcct">+ Add account</button>
    </div>`;
  }
  if (ui.acct !== 'all') {
    const a = Store.get('accounts', ui.acct);
    return a ? acctCard(a, true) : '';
  }
  const active = accts.filter(a => Acct.stats(a).status === 'active');
  return `<div class="acctlist">${active.map(a => acctCard(a, false)).join('')}</div>
    <button type="button" class="btn ghost block" data-act="newAcct">+ Add account</button>`;
}

// ---------- Trades ----------

function tradeCard(t) {
  const c = U.calc(t);
  const pnl = U.num(t.pnl);
  const meta = [U.fmtMove(c.move, c.unit), U.fmtRR(c.rr)].filter(Boolean).join(' · ');
  return `<button type="button" class="trade p-${U.esc(t.pair)}" data-act="openTrade" data-id="${t.id}">
    <div class="r1">
      <span class="pair">${U.esc(t.pair)}</span>
      <span class="side ${t.side === 'Sell' ? 'sell' : 'buy'}">${t.side === 'Sell' ? 'SELL' : 'BUY'}</span>
      ${t.lot ? `<span class="muted small">${U.esc(t.lot)} lot</span>` : ''}
      <span class="pnl ${U.cls(pnl)}">${U.money(pnl)}</span>
    </div>
    <div class="r2">
      <span>${U.esc(t.time || '')} ${sessTag(c.session)}</span>
      <span>${meta}${t.shot ? ' · 📷' : ''}</span>
    </div>
    ${t.note ? `<div class="note">${U.esc(t.note)}</div>` : ''}
  </button>`;
}

function sessSlug(s) {
  return { Asia: 'asia', London: 'london', 'London/NY overlap': 'overlap', 'New York': 'ny' }[s] || 'off';
}

function sessTag(s) {
  return s ? `<span class="sess s-${sessSlug(s)}">${U.esc(s)}</span>` : '';
}

function tradeGroups(trades) {
  const groups = new Map();
  for (const t of trades) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  return [...groups].map(([date, list]) => {
    const p = sumPnl(list);
    return `<h3 class="dayhead"><span>${U.esc(U.dayLabel(date))}</span><span class="${U.cls(p)}">${U.money(p)}</span></h3>
      <div class="tradelist">${list.map(tradeCard).join('')}</div>`;
  }).join('');
}

function lossLimitBlock(todayPnl) {
  const limit = U.num(Store.settings().lossLimit);
  if (!(limit > 0)) return '';
  const loss = Math.max(0, -todayPnl);
  const pct = Math.min(100, loss / limit * 100);
  const level = pct >= 100 ? 'hit' : pct >= 75 ? 'warn' : '';
  return `<div class="limit ${level}">
      <div class="row small"><span>Daily loss limit</span><span>${U.money(-loss)} / ${U.money(-limit)}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
}

function limitBanner(todayPnl) {
  const limit = U.num(Store.settings().lossLimit);
  if (!(limit > 0)) return '';
  if (-todayPnl >= limit) return `<div class="banner red">🛑 Daily loss limit hit (${U.money(-limit)}). Stop trading for today.</div>`;
  if (-todayPnl >= limit * 0.75) return `<div class="banner amber">⚠️ You're close to your daily loss limit. Trade carefully.</div>`;
  return '';
}

function viewTrades() {
  const today = U.today();
  const todays = tradesIn(today, today);
  const tp = sumPnl(todays);
  const allToday = sumPnl(tradesIn(today, today, 'all', 'all'));
  const wins = todays.filter(t => U.num(t.pnl) > 0).length;
  const losses = todays.filter(t => U.num(t.pnl) < 0).length;
  const [from, to] = rangeDates(ui.tradeRange);
  const list = tradesIn(from, to, ui.tradePair);
  const total = sumPnl(list);

  return `<section class="view">
    ${acctChips()}
    ${limitBanner(allToday)}
    ${acctSection()}
    <div class="card hero ${U.cls(tp)}">
      <div class="muted small">Today's PnL${ui.acct === 'all' ? '' : ' · ' + U.esc(Acct.label(Store.get('accounts', ui.acct)))}</div>
      <div class="big ${U.cls(tp)}">${U.money(tp)}</div>
      <div class="muted small">${todays.length} trade${todays.length === 1 ? '' : 's'} · ${wins}W ${losses}L</div>
      ${lossLimitBlock(allToday)}
    </div>
    <button type="button" class="btn primary block" data-act="addTrade">+ Add trade</button>

    ${chips('tradeRange', ui.tradeRange, [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All']])}
    ${chips('tradePair', ui.tradePair, [['all', 'All pairs'], ['NAS100', 'NAS100'], ['XAUUSD', 'XAUUSD'], ['EURUSD', 'EURUSD']])}
    <p class="muted small sumline">${list.length} trade${list.length === 1 ? '' : 's'} · <span class="${U.cls(total)}">${U.money(total)}</span></p>
    ${list.length ? tradeGroups(list) : '<p class="empty">No trades in this range.</p>'}
  </section>`;
}

// ---------- Trade form ----------

const form = { id: null, shot: null, pnlTouched: false };

function pointValue(pair) {
  const v = U.num((Store.settings().pointValue || {})[pair]);
  return v > 0 ? v : (PAIRS[pair] || PAIRS.NAS100).value;
}

// PnL = points × lot × $ per point for 1.00 lot.
function autoPnl(f) {
  const pts = Math.abs(U.num(f.points.value));
  const lot = U.num(f.lot.value);
  if (!isFinite(pts) || !isFinite(lot)) return NaN;
  return Math.round(pts * lot * pointValue(f.pair.value) * 100) / 100;
}

function openTradeForm(id) {
  const t = id ? Store.get('trades', id) : null;
  const f = $('#tradeForm');
  form.id = id || null;
  form.shot = t ? t.shot || null : null;
  f.reset();
  $('#tradeTitle').textContent = t ? 'Edit trade' : 'New trade';
  const accts = Acct.all().filter(a => Acct.stats(a).status === 'active' || (t && t.accountId === a.id));
  f.account.innerHTML = accts.length
    ? accts.map(a => `<option value="${a.id}">${U.esc(Acct.label(a))}${a.type === 'funded' ? ' · Funded' : ' · Live'}</option>`).join('')
    : '<option value="">No accounts yet</option>';
  f.account.value = t ? t.accountId || '' : ui.acct !== 'all' ? ui.acct : lsGet('dt.lastAcct', '');
  if (!f.account.value && accts[0]) f.account.value = accts[0].id;
  $('#noAcctHint').hidden = accts.length > 0;
  f.pair.value = t ? t.pair : lsGet('dt.lastPair', 'NAS100');
  f.side.value = t ? t.side : 'Buy';
  f.lot.value = t ? t.lot || '' : lsGet('dt.lastLot', '');
  f.date.value = t ? t.date : U.today();
  f.time.value = t ? t.time : U.nowTime();
  const c = t ? U.calc(t) : null;
  const abs = v => (isFinite(v) ? String(Math.round(Math.abs(v) * 100) / 100) : '');
  f.result.value = c ? c.result || 'Win' : 'Win';
  f.points.value = c ? abs(c.move) : '';
  f.slPts.value = c ? abs(c.risk) : '';
  f.pnl.value = t ? abs(U.num(t.pnl)) : '';
  f.note.value = t ? t.note || '' : '';
  // Keep a typed-over PnL; otherwise let it follow points × lot.
  const auto = autoPnl(f);
  form.pnlTouched = !!t && f.pnl.value !== '' && !(isFinite(auto) && Math.abs(auto - U.num(f.pnl.value)) < 0.005);
  $('#delTrade').hidden = !t;
  renderShotPreview();
  updatePreview();
  $('#tradeDlg').showModal();
}

function readForm() {
  const f = $('#tradeForm');
  const sign = f.result.value === 'Loss' ? -1 : 1;
  const signed = v => {
    const n = U.num(v);
    return isFinite(n) ? String(sign * Math.abs(n)) : '';
  };
  const sl = U.num(f.slPts.value);
  return {
    accountId: f.account.value,
    pair: f.pair.value,
    side: f.side.value,
    lot: f.lot.value.trim(),
    date: f.date.value,
    time: f.time.value,
    result: f.result.value,
    points: signed(f.points.value),
    slPts: isFinite(sl) && sl > 0 ? String(Math.abs(sl)) : '',
    pnl: signed(f.pnl.value),
    note: f.note.value.trim(),
  };
}

function updatePreview() {
  const f = $('#tradeForm');
  // Typing a minus sign means it was a loss.
  if (/^\s*-/.test(f.points.value) || /^\s*-/.test(f.pnl.value)) f.result.value = 'Loss';
  const auto = autoPnl(f);
  if (!form.pnlTouched) f.pnl.value = isFinite(auto) ? auto : '';
  const unitName = f.pair.value === 'EURUSD' ? 'pip' : 'point';
  $('#pnlHint').innerHTML = form.pnlTouched
    ? `PnL typed by you. <button type="button" class="linkbtn" data-act="autoPnl">Use auto</button>`
    : isFinite(auto)
      ? `Auto: ${Math.abs(U.num(f.points.value))} × ${U.num(f.lot.value)} lot × $${pointValue(f.pair.value)} per ${unitName}`
      : 'Enter points and lot to calculate PnL.';
  const t = readForm();
  const c = U.calc(t);
  const unitLabel = c.unit === 'pips' ? 'Pips' : 'Points';
  $('#pointsLabel').textContent = unitLabel;
  $('#slLabel').textContent = `SL (${c.unit})`;
  const cell = (label, val, cls = '') => `<div><span>${label}</span><b class="${cls}">${val || '–'}</b></div>`;
  $('#preview').innerHTML =
    cell(unitLabel, U.fmtMove(c.move, c.unit), U.cls(c.move)) +
    cell('RR', U.fmtRR(c.rr), U.cls(c.rr)) +
    cell('PnL', isFinite(U.num(t.pnl)) ? U.money(U.num(t.pnl)) : '', U.cls(U.num(t.pnl))) +
    cell('Session', c.session);
}

async function renderShotPreview() {
  const box = $('#shotBox');
  if (!form.shot) {
    box.innerHTML = '<label class="btn ghost block filebtn">📷 Add chart screenshot<input type="file" accept="image/*" id="shotInput" hidden></label>';
    return;
  }
  box.innerHTML = '<div class="shot loading">Loading screenshot…</div>';
  try {
    const url = await Store.shotUrl(form.shot);
    box.innerHTML = url
      ? `<div class="shot"><img src="${url}" alt="Chart screenshot" data-act="viewShot"><button type="button" class="mini" data-act="removeShot">Remove</button></div>`
      : '<div class="shot loading">Screenshot not available on this device yet.</div>';
  } catch (e) {
    box.innerHTML = `<div class="shot loading">Could not load screenshot: ${U.esc(e.message)}</div>`;
  }
}

function saveTrade() {
  const f = $('#tradeForm');
  const t = readForm();
  if (!t.accountId) return toast('Add an account first: Trades → + Add account.');
  if (!t.date || !t.time) return toast('Set the date and time.');
  if (!isFinite(U.num(t.points))) return toast('Enter the points.');
  if (!isFinite(U.num(t.pnl))) return toast('Enter the PnL in $.');
  const old = form.id ? Store.get('trades', form.id) : null;
  const item = { ...(old || { id: U.uid(), createdAt: Date.now() }), ...t, shot: form.shot || null };
  if (!item.shot) delete item.shot;
  // Older trades stored prices; points replace them.
  delete item.entry; delete item.sl; delete item.exit;
  Store.upsert('trades', item);
  if (old && old.shot && (!form.shot || old.shot.id !== form.shot.id)) Store.deleteShot(old.shot);
  lsSet('dt.lastPair', t.pair);
  lsSet('dt.lastAcct', t.accountId);
  if (t.lot) lsSet('dt.lastLot', t.lot);
  $('#tradeDlg').close();
  toast(old ? 'Trade updated' : 'Trade saved');
  const tp = sumPnl(tradesIn(U.today(), U.today(), 'all', 'all'));
  const limit = U.num(Store.settings().lossLimit);
  if (limit > 0 && -tp >= limit && t.date === U.today()) setTimeout(() => toast('🛑 Daily loss limit hit. Stop for today.'), 2700);
  const acc = Store.get('accounts', t.accountId);
  if (acc && acc.type === 'funded') {
    const st = Acct.stats(acc);
    if (st.breach) setTimeout(() => toast(`❌ ${Acct.label(acc)}: ${st.breach.rule === 'daily' ? 'max daily loss' : 'fail line'} hit.`), 2700);
    else if (isFinite(st.dailyLeft) && st.dailyLeft <= st.dailyLimit * 0.25) setTimeout(() => toast(`⚠️ ${Acct.label(acc)}: only ${U.money(st.dailyLeft, false)} daily loss left.`), 2700);
  }
  f.reset();
}

// ---------- Account form ----------

const aform = { id: null, flows: [] };

function setRule(f, name, field) {
  f[name + 'V'].value = field && U.num(field.v) > 0 ? field.v : '';
  f[name + 'U'].value = field && field.unit === '$' ? '$' : '%';
}

function readRule(f, name) {
  const v = U.num(f[name + 'V'].value);
  return v > 0 ? { v: String(v), unit: f[name + 'U'].value } : null;
}

function openAcctForm(id) {
  const a = id ? Store.get('accounts', id) : null;
  const f = $('#acctForm');
  f.reset();
  aform.id = id || null;
  aform.flows = a && a.cashflows ? a.cashflows.map(x => ({ ...x })) : [];
  $('#acctTitle').textContent = a ? 'Edit account' : 'New account';
  f.atype.value = a ? a.type : 'funded';
  f.aname.value = a ? a.name || '' : '';
  f.firm.value = a ? a.firm || '' : '';
  f.start.value = a ? a.startBalance || '' : '';
  setRule(f, 'dl', a && a.dailyLoss);
  setRule(f, 'ml', a && a.maxLoss);
  setRule(f, 'tg', a && a.target);
  f.dd.value = a ? a.ddType || 'static' : 'eod';
  f.lock.checked = !!(a && a.lockAtStart);
  f.status.value = a ? a.status || 'active' : 'active';
  f.flowDate.value = U.today();
  $('#delAcct').hidden = !a;
  acctFormType();
  renderFlows();
  $('#acctDlg').showModal();
}

function acctFormType() {
  const f = $('#acctForm');
  const funded = f.atype.value === 'funded';
  $('#fundedBox').hidden = !funded;
  $('#liveBox').hidden = funded;
  $('#firmLabel').textContent = funded ? 'Prop firm' : 'Broker';
  f.firm.placeholder = funded ? 'e.g. FTMO' : 'e.g. Exness';
  $('#lockRow').hidden = f.dd.value === 'static';
  const start = U.num(f.start.value);
  for (const n of ['dl', 'ml', 'tg']) {
    const r = readRule(f, n);
    $('#' + n + 'Hint').textContent = r && r.unit === '%' && start > 0 ? '= ' + U.money(Acct.amount(r, start), false) : '';
  }
}

function renderFlows() {
  const list = aform.flows.slice().sort((a, b) => b.date.localeCompare(a.date));
  $('#flowList').innerHTML = list.length ? list.map(x => {
    const v = U.num(x.amount);
    return `<li><span>${U.esc(U.fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
      <span>${v >= 0 ? 'Deposit' : 'Withdrawal'}</span>
      <b class="${U.cls(v)}">${U.money(v)}</b>
      <button type="button" class="icon del" data-act="delFlow" data-id="${x.id}" aria-label="Remove">×</button></li>`;
  }).join('') : '<li class="muted small">No deposits or withdrawals yet.</li>';
}

function saveAcct() {
  const f = $('#acctForm');
  const name = f.aname.value.trim();
  const start = U.num(f.start.value);
  if (!name) return toast('Give the account a name.');
  if (!(start > 0)) return toast('Enter the starting balance.');
  const funded = f.atype.value === 'funded';
  const old = aform.id ? Store.get('accounts', aform.id) : null;
  const a = {
    ...(old || { id: U.uid(), createdAt: Date.now() }),
    type: funded ? 'funded' : 'live',
    name,
    firm: f.firm.value.trim(),
    startBalance: String(start),
    status: f.status.value,
  };
  if (funded) {
    Object.assign(a, {
      dailyLoss: readRule(f, 'dl'), maxLoss: readRule(f, 'ml'), target: readRule(f, 'tg'),
      ddType: f.dd.value, lockAtStart: f.lock.checked,
    });
    delete a.cashflows;
  } else {
    a.cashflows = aform.flows;
    for (const k of ['dailyLoss', 'maxLoss', 'target', 'ddType', 'lockAtStart']) delete a[k];
  }
  Store.upsert('accounts', a);
  $('#acctDlg').close();
  if (!old) { ui.acct = a.id; lsSet('dt.acct', a.id); render(); }
  toast(old ? 'Account updated' : 'Account added');
}

// ---------- Calendar ----------

function viewCalendar() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = `${ui.calMonth}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${ui.calMonth}-${String(days).padStart(2, '0')}`;
  const today = U.today();
  const trades = tradesIn(first, last);
  const allTasks = Store.list('tasks').filter(t => t.date >= first && t.date <= last);
  const byDay = {};
  for (const t of trades) (byDay[t.date] ||= { pnl: 0, n: 0, tasks: 0, done: 0 }).pnl += U.num(t.pnl) || 0, byDay[t.date].n++;
  for (const t of allTasks) { const b = (byDay[t.date] ||= { pnl: 0, n: 0, tasks: 0, done: 0 }); b.tasks++; if (t.done) b.done++; }
  const dayVals = Object.values(byDay).filter(b => b.n);
  const greenDays = dayVals.filter(b => b.pnl > 0).length;
  const redDays = dayVals.filter(b => b.pnl < 0).length;
  const total = sumPnl(trades);

  const tasksMode = ui.calMode === 'tasks';
  let cells = '';
  for (let i = 0; i < U.weekdayMon(first); i++) cells += '<span class="day blank"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${ui.calMonth}-${String(d).padStart(2, '0')}`;
    const b = byDay[ds];
    const pct = b && b.tasks ? b.done / b.tasks * 100 : NaN;
    const cls = tasksMode ? (b && b.tasks && (ds < today || pct >= 100) ? 'b-' + Perf.band(pct) : '') : b && b.n ? U.cls(b.pnl) : '';
    const main = tasksMode
      ? b && b.tasks ? `<span class="dp">${Math.round(pct)}%</span><span class="dt">${b.done}/${b.tasks}</span>` : ''
      : `${b && b.n ? `<span class="dp">${U.moneyShort(b.pnl)}</span>` : ''}${b && b.tasks ? `<span class="dt${b.done === b.tasks ? ' all' : ''}">${b.done}/${b.tasks}</span>` : ''}`;
    cells += `<button type="button" class="day ${cls}${ds === today ? ' today' : ''}${ds === ui.calDay ? ' sel' : ''}" data-act="calDay" data-v="${ds}">
      <span class="dn">${d}</span>${main}
    </button>`;
  }
  const ms = Perf.summary(first, last);

  const sel = ui.calDay && ui.calDay.startsWith(ui.calMonth) ? ui.calDay : null;
  let detail = '';
  if (sel) {
    const st = tradesIn(sel, sel);
    const tk = tasksOn(sel);
    const p = sumPnl(st);
    detail = `<div class="card">
      <h3 class="dayhead"><span>${U.esc(U.dayLabel(sel))}</span>${st.length ? `<span class="${U.cls(p)}">${U.money(p)}</span>` : ''}</h3>
      ${st.length ? `<div class="tradelist">${st.map(tradeCard).join('')}</div>` : '<p class="muted small">No trades.</p>'}
      <h4 class="sub">Activities ${tk.length ? `<span class="muted">${tk.filter(t => t.done).length}/${tk.length}</span>` : ''}</h4>
      ${tk.length ? `<ul class="tasks">${tk.map(t => taskRow(t, today)).join('')}</ul>` : '<p class="muted small">No activities.</p>'}
    </div>`;
  }

  return `<section class="view">
    <div class="datebar">
      <button type="button" class="icon nav" data-act="calShift" data-v="-1" aria-label="Previous month">‹</button>
      <span class="datepick"><span>${U.fmtDate(first, { month: 'long', year: 'numeric' })}</span></span>
      <button type="button" class="icon nav" data-act="calShift" data-v="1" aria-label="Next month">›</button>
    </div>
    ${chips('calMode', ui.calMode, [['pnl', '💵 PnL'], ['tasks', '☑ Activities']])}
    ${tasksMode ? '' : acctChips()}
    ${tasksMode ? `<div class="card statrow">
      <div><span>Avg completion</span><b>${isFinite(ms.avg) ? Math.round(ms.avg) + '%' : '–'}</b></div>
      <div><span>Perfect days</span><b class="pos">${ms.perfect}</b></div>
      <div><span>Days 70%+</span><b>${ms.good}/${ms.tracked}</b></div>
    </div>${bandLegend()}` : `<div class="card statrow">
      <div><span>Month PnL</span><b class="${U.cls(total)}">${U.money(total)}</b></div>
      <div><span>Green days</span><b class="pos">${greenDays}</b></div>
      <div><span>Red days</span><b class="neg">${redDays}</b></div>
    </div>`}
    <div class="cal">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => `<span class="wd">${w}</span>`).join('')}
      ${cells}
    </div>
    ${detail}
  </section>`;
}

// ---------- Stats ----------

function groupStats(trades, keyFn, order) {
  const g = {};
  for (const t of trades) {
    const k = keyFn(t);
    const s = (g[k] ||= { n: 0, w: 0, l: 0, pnl: 0 });
    const p = U.num(t.pnl) || 0;
    s.n++; s.pnl += p;
    if (p > 0) s.w++; else if (p < 0) s.l++;
  }
  const keys = order ? order.filter(k => g[k]) : Object.keys(g);
  return keys.map(k => ({ k, ...g[k] }));
}

function statTable(title, rows) {
  if (!rows.length) return '';
  const best = rows.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  return `<div class="card">
    <h4 class="sub">${title}</h4>
    <table class="tbl">
      <thead><tr><th></th><th>Trades</th><th>Win %</th><th>PnL</th></tr></thead>
      <tbody>${rows.map(r => `<tr${rows.length > 1 && r === best && r.pnl > 0 ? ' class="best"' : ''}>
        <td><span class="dot k-${U.esc(String(r.k).replace(/[^A-Za-z0-9]/g, ''))}"></span>${U.esc(r.k)}${rows.length > 1 && r === best && r.pnl > 0 ? ' ★' : ''}</td><td>${r.n}</td>
        <td>${r.w + r.l ? Math.round(r.w / (r.w + r.l) * 100) + '%' : '–'}</td>
        <td class="${U.cls(r.pnl)}">${U.money(r.pnl)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function bandLegend() {
  return `<div class="legend">${['perfect', 'good', 'ok', 'bad'].map(b =>
    `<span><i class="b-${b}"></i>${Perf.bandLabel(b)}${{ perfect: ' 100%', good: ' 70%+', ok: ' 40%+', bad: ' <40%' }[b]}</span>`).join('')}</div>`;
}

function barChart(from, to) {
  const today = U.today();
  let start = from < '1000' ? U.addDays(today, -29) : from;
  let end = to > today ? today : to;
  if (ui.statsRange === 'week') end = U.addDays(start, 6);
  const dates = [];
  for (let d = start; d <= end && dates.length < 62; d = U.addDays(d, 1)) dates.push(d);
  if (dates.length === 62) start = dates[0];
  const m = Perf.days(dates[0] || start, dates[dates.length - 1] || end);
  const few = dates.length <= 10;
  return `<div class="card">
    <h4 class="sub">Daily completion</h4>
    <div class="bars${few ? ' few' : ''}" role="img" aria-label="Daily completion chart">
      ${dates.map((d, i) => {
        const x = m[d];
        const future = d > today;
        const pct = x ? x.pct : 0;
        const band = x ? (d < today || pct >= 100 ? Perf.band(pct) : 'live') : 'none';
        const tip = `${U.fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}: ${x ? `${x.done}/${x.total} done (${Math.round(pct)}%)${d === today ? ' · today, in progress' : ' · ' + Perf.bandLabel(band)}` : future ? 'not yet' : 'nothing planned'}`;
        const axis = few ? U.fmtDate(d, { weekday: 'short' }).slice(0, 2) : (i === 0 || +d.slice(8) % 5 === 0 ? String(+d.slice(8)) : '');
        return `<button type="button" class="bcol" data-act="barTip" data-tip="${U.esc(tip)}" title="${U.esc(tip)}">
          <span class="bl">${few && x ? Math.round(pct) + '%' : ''}</span>
          <span class="btrack"><i class="b-${band}${d === today ? ' today' : ''}" style="height:${x ? Math.max(3, pct) : 0}%"></i></span>
          <span class="bx${d === today ? ' now' : ''}">${axis}</span></button>`;
      }).join('')}
    </div>
    ${bandLegend()}
  </div>`;
}

function viewActivities(from, to) {
  const s = Perf.summary(from, to);
  const st = Perf.streak();
  const todayScore = Perf.day(U.today());
  const tile = (label, val, cls = '', sub = '') =>
    `<div class="tile"><span>${label}</span><b class="${cls}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `
    <div class="tiles">
      ${tile('Avg completion', isFinite(s.avg) ? Math.round(s.avg) + '%' : '–', '', isFinite(s.avg) ? Perf.bandLabel(Perf.band(s.avg)) : 'no finished days yet')}
      ${tile('Streak 🔥', `${st.current} day${st.current === 1 ? '' : 's'}`, '', `best ${st.best} · days at 70%+`)}
      ${tile('Done', s.done, 'pos', `of ${s.planned} planned`)}
      ${tile('Missed', s.missed, s.missed ? 'neg' : '', 'incl. moved')}
      ${tile('Perfect days', s.perfect, '', `of ${s.tracked} day${s.tracked === 1 ? '' : 's'}`)}
      ${tile('Today so far', todayScore ? Math.round(todayScore.pct) + '%' : '–', '', todayScore ? `${todayScore.done}/${todayScore.total}` : 'nothing planned')}
    </div>
    ${barChart(from, to)}
    ${s.bestWeekday || s.mostMissed.length ? `<div class="card insights">
      ${s.bestWeekday ? `<p>💪 Best day: <b>${s.bestWeekday.name}</b> (${Math.round(s.bestWeekday.avg)}%)</p>
        <p>😴 Weakest day: <b>${s.worstWeekday.name}</b> (${Math.round(s.worstWeekday.avg)}%)</p>` : ''}
      ${s.mostMissed.length ? `<h4 class="sub">Most missed</h4><ul class="missedlist">${s.mostMissed.map(m =>
        `<li><span>${U.esc(m.text)}</span><b class="neg">${m.n}×</b></li>`).join('')}</ul>` : ''}
    </div>` : ''}
    <button type="button" class="btn ghost block" data-act="lastWeek">📋 Last week's review</button>`;
}

function viewStats() {
  const [from, to] = rangeDates(ui.statsRange, ui.statsFrom, ui.statsTo);
  const head = `${chips('statsSection', ui.statsSection, [['trading', '📈 Trading'], ['activities', '☑ Activities']])}
    ${chips('statsRange', ui.statsRange, [['week', 'Week'], ['month', 'Month'], ['all', 'All'], ['custom', 'Custom']])}
    ${ui.statsRange === 'custom' ? `<div class="grid2">
        <label class="field"><span>From</span><input type="date" id="statsFrom" value="${ui.statsFrom}"></label>
        <label class="field"><span>To</span><input type="date" id="statsTo" value="${ui.statsTo}"></label>
      </div>` : ''}`;
  if (ui.statsSection === 'activities') return `<section class="view">${head}${viewActivities(from, to)}</section>`;
  return viewTrading(from, to, head);
}

function viewTrading(from, to, head) {
  const trades = tradesIn(from, to);
  const pnls = trades.map(t => U.num(t.pnl) || 0);
  const wins = pnls.filter(p => p > 0), losses = pnls.filter(p => p < 0);
  const total = pnls.reduce((a, b) => a + b, 0);
  const rrs = trades.map(t => U.calc(t).rr).filter(isFinite);
  const avgRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : NaN;
  const grossW = wins.reduce((a, b) => a + b, 0), grossL = -losses.reduce((a, b) => a + b, 0);
  const days = groupStats(trades, t => t.date);
  const bestDay = days.length ? days.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worstDay = days.length ? days.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;

  const tile = (label, val, cls = '', sub = '') =>
    `<div class="tile"><span>${label}</span><b class="${cls}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  return `<section class="view">
    ${head}
    ${acctChips()}
    <div class="tiles">
      ${tile('Total PnL', U.money(total), U.cls(total))}
      ${tile('Win rate', wins.length + losses.length ? Math.round(wins.length / (wins.length + losses.length) * 100) + '%' : '–', '', `${wins.length}W · ${losses.length}L · ${pnls.length - wins.length - losses.length}BE`)}
      ${tile('Trades', trades.length)}
      ${tile('Avg RR', U.fmtRR(avgRR) || '–', U.cls(avgRR))}
      ${tile('Avg win', wins.length ? U.money(grossW / wins.length) : '–', 'pos')}
      ${tile('Avg loss', losses.length ? U.money(-grossL / losses.length) : '–', 'neg')}
      ${tile('Profit factor', grossL > 0 ? (grossW / grossL).toFixed(2) : grossW > 0 ? '∞' : '–')}
      ${bestDay ? tile('Best day', U.money(bestDay.pnl), U.cls(bestDay.pnl), U.fmtDate(bestDay.k, { day: 'numeric', month: 'short' })) : ''}
      ${worstDay ? tile('Worst day', U.money(worstDay.pnl), U.cls(worstDay.pnl), U.fmtDate(worstDay.k, { day: 'numeric', month: 'short' })) : ''}
    </div>
    ${trades.length ? '' : '<p class="empty">No trades in this range yet.</p>'}
    ${statTable('By pair', groupStats(trades, t => t.pair, Object.keys(PAIRS)))}
    ${statTable('By session', groupStats(trades, t => U.calc(t).session || '–', ['Asia', 'London', 'London/NY overlap', 'New York', 'Off-session']))}
    ${statTable('Buy vs Sell', groupStats(trades, t => t.side, ['Buy', 'Sell']))}
    ${ui.acct === 'all' && Acct.all().length > 1 ? statTable('By account', groupStats(trades, t => Acct.label(Store.get('accounts', t.accountId)))) : ''}
  </section>`;
}

// ---------- Weekly review ----------

function reviewHTML(from, to) {
  const s = Perf.summary(from, to);
  const trades = tradesIn(from, to, 'all', 'all');
  const pnl = sumPnl(trades);
  const w = trades.filter(t => U.num(t.pnl) > 0).length, l = trades.filter(t => U.num(t.pnl) < 0).length;
  const days = groupStats(trades, t => t.date);
  const best = days.length ? days.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const st = Perf.streak();
  const accts = Acct.all().filter(a => Acct.stats(a).status === 'active');
  const range = `${U.fmtDate(from, { day: 'numeric', month: 'short' })} – ${U.fmtDate(to, { day: 'numeric', month: 'short' })}`;
  return `<p class="muted small">${range}</p>
    <h3 class="sub">☑ Activities</h3>
    <div class="tiles">
      <div class="tile"><span>Avg completion</span><b>${isFinite(s.avg) ? Math.round(s.avg) + '%' : '–'}</b><small>${isFinite(s.avg) ? Perf.bandLabel(Perf.band(s.avg)) : 'nothing planned'}</small></div>
      <div class="tile"><span>Done</span><b class="pos">${s.done}</b><small>of ${s.planned} planned</small></div>
      <div class="tile"><span>Missed</span><b class="${s.missed ? 'neg' : ''}">${s.missed}</b></div>
      <div class="tile"><span>Perfect days</span><b>${s.perfect}/${s.tracked}</b></div>
      <div class="tile"><span>Streak now 🔥</span><b>${st.current}</b><small>best ${st.best}</small></div>
    </div>
    ${s.mostMissed.length ? `<p class="small">Most missed: <b>${U.esc(s.mostMissed[0].text)}</b> (${s.mostMissed[0].n}×)</p>` : ''}
    <h3 class="sub">📈 Trading</h3>
    <div class="tiles">
      <div class="tile"><span>PnL</span><b class="${U.cls(pnl)}">${U.money(pnl)}</b></div>
      <div class="tile"><span>Trades · Win rate</span><b>${trades.length} · ${w + l ? Math.round(w / (w + l) * 100) + '%' : '–'}</b></div>
      ${best ? `<div class="tile"><span>Best day</span><b class="${U.cls(best.pnl)}">${U.money(best.pnl)}</b><small>${U.fmtDate(best.k, { weekday: 'short', day: 'numeric' })}</small></div>` : ''}
    </div>
    ${accts.length ? `<h3 class="sub">🏦 Accounts now</h3><ul class="missedlist">${accts.map(a => {
      const x = Acct.stats(a);
      return `<li><span>${U.esc(Acct.label(a))}</span><b>${U.money(x.balance, false)}</b></li>`;
    }).join('')}</ul>` : ''}`;
}

function openReview(from, to) {
  $('#reviewBody').innerHTML = reviewHTML(from, to);
  $('#reviewDlg').showModal();
}

let reviewChecked = false;
function maybeShowReview() {
  if (reviewChecked || $('dialog[open]')) return;
  const ws = Perf.weekStart(U.today());
  const from = U.addDays(ws, -7), to = U.addDays(ws, -1);
  if (lsGet('dt.reviewSeen', '') === from) { reviewChecked = true; return; }
  const any = Store.list('tasks').some(t => t.date >= from && t.date <= to) ||
    Store.list('trades').some(t => t.date >= from && t.date <= to);
  if (!any) return;
  reviewChecked = true;
  lsSet('dt.reviewSeen', from);
  openReview(from, to);
}

// ---------- Settings ----------

function openSettings() {
  const c = Store.config();
  const f = $('#settingsForm');
  f.owner.value = c.owner;
  f.repo.value = c.repo;
  f.token.value = c.token;
  f.lossLimit.value = U.num(Store.settings().lossLimit) > 0 ? Store.settings().lossLimit : '';
  f.theme.value = lsGet('dt.theme', 'dark');
  for (const p of Object.keys(PAIRS)) f['pv_' + p].value = pointValue(p);
  renderSyncInfo();
  $('#settingsDlg').showModal();
}

function renderSyncInfo(msg) {
  const c = Store.config();
  const s = Store.status();
  const el = $('#syncInfo');
  if (!el) return;
  $('#disconnectBtn').hidden = !c.token;
  let text = msg || '';
  if (!text) {
    if (!c.token) text = 'Not connected. Data is saved on this device only.';
    else if (s === 'synced') text = `✅ Connected to ${c.owner}/${c.repo}.`;
    else if (s === 'syncing') text = 'Syncing…';
    else if (s === 'error' || s === 'offline') text = '⚠️ ' + (Store.lastError() || 'Sync problem.');
    else text = `Connected to ${c.owner}/${c.repo}.`;
  }
  el.textContent = text;
}

// ---------- Header / render ----------

const STATUS = {
  local: ['Local only', 'muted'],
  idle: ['Ready', 'muted'],
  syncing: ['Syncing…', 'amber'],
  synced: ['Synced', 'pos'],
  offline: ['Offline', 'amber'],
  error: ['Sync error', 'neg'],
};

function renderHeader() {
  const [label, cls] = STATUS[Store.status()] || STATUS.local;
  const pill = $('#syncPill');
  pill.innerHTML = `<i class="${cls}"></i>${label}`;
  pill.title = Store.lastError() || label;
}

const VIEWS = { plan: viewPlan, trades: viewTrades, calendar: viewCalendar, stats: viewStats };

function render() {
  if (!VIEWS[ui.tab]) ui.tab = 'plan';
  if (ui.acct !== 'all' && !Store.get('accounts', ui.acct)) ui.acct = 'all';
  if (ui.acct !== 'all' && Store.get('accounts', ui.acct).deleted) ui.acct = 'all';
  const draft = $('#taskInput') ? $('#taskInput').value : '';
  const hadFocus = document.activeElement && document.activeElement.id === 'taskInput';
  $('#view').innerHTML = VIEWS[ui.tab]();
  document.body.dataset.tab = ui.tab;
  for (const b of $$('.tabbar button')) b.classList.toggle('on', b.dataset.v === ui.tab);
  renderHeader();
  const ti = $('#taskInput');
  if (ti && draft) { ti.value = draft; if (hadFocus) ti.focus(); }
}

// ---------- Theme ----------

function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0c0a1d' : '#f6f7f9');
}

// ---------- Events ----------

const actions = {
  tab(el) { ui.tab = el.dataset.v; lsSet('dt.tab', ui.tab); render(); window.scrollTo(0, 0); },
  planShift(el) { ui.planDate = U.addDays(ui.planDate, +el.dataset.v); render(); },
  planJump(el) { ui.planDate = el.dataset.v === 'tomorrow' ? U.addDays(U.today(), 1) : U.today(); render(); },
  delTask(el) {
    const t = Store.get('tasks', el.dataset.id);
    if (t && confirm(`Delete "${t.text}"?`)) Store.remove('tasks', t.id);
  },
  moveToday(el) {
    const t = Store.get('tasks', el.dataset.id);
    if (!t) return;
    const today = U.today();
    Store.upsert('tasks', { ...t, movedTo: today });
    Store.upsert('tasks', { id: U.uid(), text: t.text, date: today, done: false, createdAt: Date.now(), movedFrom: t.date });
    toast('Moved to today');
  },
  tradeRange(el) { ui.tradeRange = el.dataset.v; render(); },
  acct(el) { ui.acct = el.dataset.v; lsSet('dt.acct', ui.acct); render(); },
  newAcct() { openAcctForm(null); },
  editAcct(el) { openAcctForm(el.dataset.id); },
  addFlow() {
    const f = $('#acctForm');
    const amt = U.num(f.flowAmt.value);
    if (!(Math.abs(amt) > 0) || !f.flowDate.value) return toast('Enter the date and amount.');
    aform.flows.push({ id: U.uid(), date: f.flowDate.value, amount: String((f.flowKind.value === 'out' ? -1 : 1) * Math.abs(amt)) });
    f.flowAmt.value = '';
    renderFlows();
  },
  delFlow(el) { aform.flows = aform.flows.filter(x => x.id !== el.dataset.id); renderFlows(); },
  delAcct() {
    const a = Store.get('accounts', aform.id);
    if (!a) return;
    const trades = Acct.trades(a);
    const msg = trades.length
      ? `Delete "${Acct.label(a)}" and its ${trades.length} trade${trades.length === 1 ? '' : 's'}? This can't be undone.`
      : `Delete "${Acct.label(a)}"?`;
    if (!confirm(msg)) return;
    for (const t of trades) Store.remove('trades', t.id);
    Store.remove('accounts', a.id);
    $('#acctDlg').close();
    ui.acct = 'all'; lsSet('dt.acct', 'all');
    render();
    toast('Account deleted');
  },
  calMode(el) { ui.calMode = el.dataset.v; render(); },
  statsSection(el) { ui.statsSection = el.dataset.v; lsSet('dt.statsSec', ui.statsSection); render(); },
  goActivities() { ui.tab = 'stats'; ui.statsSection = 'activities'; ui.statsRange = 'week'; lsSet('dt.tab', 'stats'); render(); window.scrollTo(0, 0); },
  barTip(el) { toast(el.dataset.tip); },
  lastWeek() {
    const ws = Perf.weekStart(U.today());
    openReview(U.addDays(ws, -7), U.addDays(ws, -1));
  },
  tradePair(el) { ui.tradePair = el.dataset.v; render(); },
  addTrade() { openTradeForm(null); },
  openTrade(el) { openTradeForm(el.dataset.id); },
  calShift(el) {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + +el.dataset.v, 1));
    ui.calMonth = d.toISOString().slice(0, 7);
    render();
  },
  calDay(el) { ui.calDay = el.dataset.v; render(); },
  statsRange(el) { ui.statsRange = el.dataset.v; render(); },
  settings() { openSettings(); },
  sync() { if (Store.config().token) Store.syncNow(); else openSettings(); },
  closeDlg(el) { el.closest('dialog').close(); },
  autoPnl() { form.pnlTouched = false; updatePreview(); },
  removeShot() { form.shot = null; renderShotPreview(); },
  viewShot(el) { $('#shotFull').src = el.src; $('#shotDlg').showModal(); },
  delTrade() {
    if (form.id && confirm('Delete this trade?')) {
      Store.remove('trades', form.id);
      $('#tradeDlg').close();
      toast('Trade deleted');
    }
  },
  async testSync() {
    const f = $('#settingsForm');
    const owner = f.owner.value.trim(), repo = f.repo.value.trim(), token = f.token.value.trim();
    if (!owner || !repo || !token) return renderSyncInfo('Fill in username, repo and token.');
    renderSyncInfo('Checking…');
    try {
      const r = await Store.testConnection(owner, repo, token);
      if (!r.private) return renderSyncInfo(`⚠️ ${r.fullName} is PUBLIC. Use a private repo so nobody can see your data.`);
      Store.setConfig({ owner, repo, token });
      renderSyncInfo('Connected. Syncing…');
      await Store.syncNow();
      renderSyncInfo();
    } catch (e) {
      renderSyncInfo('❌ ' + e.message);
    }
  },
  disconnect() {
    if (!confirm('Disconnect GitHub on this device? Your data stays on GitHub and on this device.')) return;
    Store.setConfig({ token: '' });
    $('#settingsForm').token.value = '';
    renderSyncInfo();
  },
  exportData() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-tracking-backup-${U.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  importData() { $('#importInput').click(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.act === 'toggleTask') {
    const t = Store.get('tasks', el.dataset.id);
    if (t) Store.upsert('tasks', { ...t, done: el.checked, doneAt: el.checked ? Date.now() : null });
  } else if (el.id === 'planDate' && el.value) {
    ui.planDate = el.value; render();
  } else if (el.id === 'statsFrom' || el.id === 'statsTo') {
    ui[el.id] = el.value; render();
  } else if (el.id === 'shotInput' && el.files[0]) {
    $('#shotBox').innerHTML = '<div class="shot loading">Preparing screenshot…</div>';
    try {
      form.shot = await Store.saveShot(el.files[0]);
    } catch (err) {
      toast(err.message);
    }
    renderShotPreview();
  } else if (el.id === 'importInput' && el.files[0]) {
    try {
      const n = Store.importJSON(await el.files[0].text());
      toast(`Imported ${n} items`);
    } catch (err) {
      toast('That file is not a valid backup.');
    }
    el.value = '';
  } else if (el.name === 'theme') {
    lsSet('dt.theme', el.value); applyTheme(el.value);
  } else if (el.name && el.name.startsWith('pv_')) {
    const pv = { ...(Store.settings().pointValue || {}) };
    const v = U.num(el.value);
    pv[el.name.slice(3)] = v > 0 ? v : PAIRS[el.name.slice(3)].value;
    Store.setSettings({ pointValue: pv });
  } else if (el.name === 'lossLimit') {
    const v = U.num(el.value);
    Store.setSettings({ lossLimit: v > 0 ? v : 0 });
  } else if (el.closest('#tradeForm')) {
    updatePreview();
  } else if (el.closest('#acctForm')) {
    acctFormType();
  }
});

document.addEventListener('input', e => {
  if (e.target.name === 'pnl') form.pnlTouched = e.target.value.trim() !== '';
  if (e.target.closest('#tradeForm')) updatePreview();
  else if (e.target.closest('#acctForm')) acctFormType();
});

document.addEventListener('submit', e => {
  if (e.target.id === 'taskForm') {
    e.preventDefault();
    const input = $('#taskInput');
    const text = input.value.trim();
    if (!text) return;
    Store.upsert('tasks', { id: U.uid(), text, date: ui.planDate, done: false, createdAt: Date.now() });
    input.value = '';
    $('#taskInput').focus();
  } else if (e.target.id === 'tradeForm') {
    e.preventDefault();
    saveTrade();
  } else if (e.target.id === 'acctForm') {
    e.preventDefault();
    saveAcct();
  } else if (e.target.id === 'settingsForm') {
    e.preventDefault();
  }
});

// Tap outside a dialog closes it.
for (const d of $$('dialog')) {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}

Store.on(() => {
  // Don't rebuild the page under an open trade form; just refresh the header.
  if ($('#tradeDlg').open) renderHeader(); else render();
  if ($('#settingsDlg').open) renderSyncInfo();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    Store.syncNow();
  }
});

// ---------- Start ----------

applyTheme(lsGet('dt.theme', 'dark'));
Store.load();
render();
maybeShowReview();
Store.syncNow().then(maybeShowReview);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
