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
  moneyRange: 'week',
  histAll: false,
  weekOpen: null,
  walletWs: null, // Sunday of the week shown on the wallet card (null = this week)
  acct: lsGet('dt.acct', 'all'),
  dailyOn: false,
  doneOpen: false,
  missedOpen: false,
  manageOpen: false,
  editing: null, // id of the activity being renamed
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

// Daily activities: each one puts a task on today (and on the plan day being
// looked at, if it's later). The task id is fixed per routine and day, so two
// devices never make two copies, and deleting one day's task doesn't bring it back.
function routineTaskId(rid, date) { return `r-${rid}-${date}`; }

function routines() {
  return Store.list('routines').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// A routine runs every day, or Mon–Fri only when days is 'weekdays'.
function isWeekend(date) { return U.weekdayMon(date) >= 5; }
function routineOn(r, date) { return date >= r.start && !(r.days === 'weekdays' && isWeekend(date)); }

function fillRoutines() {
  const today = U.today();
  const dates = [today];
  if (ui.planDate > today) dates.push(ui.planDate);
  const add = [];
  for (const r of routines()) {
    for (const d of dates) {
      const id = routineTaskId(r.id, d);
      if (!routineOn(r, d) || Store.get('tasks', id)) continue;
      add.push({ id, text: r.text, date: d, done: false, routine: r.id, createdAt: r.createdAt, updatedAt: 1 });
    }
  }
  if (add.length) Store.addQuiet('tasks', add);
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

function taskRow(t, today, { showDate = false, tag = false } = {}) {
  if (ui.editing === t.id) {
    return `<li class="task editing"><form class="editrow" data-id="${t.id}" autocomplete="off">
      <input id="editInput" value="${U.esc(t.text)}" maxlength="200" enterkeyhint="done" aria-label="Activity">
      <button type="submit" class="mini save">Save</button>
      <button type="button" class="mini" data-act="cancelEdit">Cancel</button>
    </form></li>`;
  }
  const missed = isMissed(t, today);
  let tail = '';
  if (missed && t.movedTo) {
    tail = `<span class="badge muted">Moved → ${U.esc(U.fmtDate(t.movedTo, { day: 'numeric', month: 'short' }))}</span>`;
  } else if (missed && t.routine) {
    tail = `<span class="badge red">Missed</span>`;
  } else if (missed) {
    tail = `<span class="badge red">Missed</span><button type="button" class="mini" data-act="moveToday" data-id="${t.id}">→ Today</button>`;
  }
  return `<li class="task${t.done ? ' done' : ''}${missed ? ' missed' : ''}">
    <label class="check"><input type="checkbox" data-act="toggleTask" data-id="${t.id}"${t.done ? ' checked' : ''}><span class="box" aria-hidden="true"></span>
      <span class="text">${U.esc(t.text)}${tag && t.routine ? ' <span class="badge daily">🔁</span>' : ''}${showDate ? `<small>${U.esc(U.fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</small>` : ''}</span></label>
    ${tail}
    <button type="button" class="icon edit" data-act="editTask" data-id="${t.id}" aria-label="Edit">✏️</button>
    <button type="button" class="icon del" data-act="delTask" data-id="${t.id}" aria-label="Delete">×</button>
  </li>`;
}

function taskList(list, today, opt) {
  return `<ul class="tasks">${list.map(t => taskRow(t, today, opt)).join('')}</ul>`;
}

function viewPlan() {
  const today = U.today();
  const tomorrow = U.addDays(today, 1);
  const d = ui.planDate;
  const tasks = tasksOn(d);
  const done = tasks.filter(t => t.done);
  const pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0;
  const daily = tasks.filter(t => t.routine && !t.done);
  const other = tasks.filter(t => !t.routine && !t.done);
  const missedEarlier = d === today
    ? Store.list('tasks').filter(t => isMissed(t, today) && !t.movedTo && !t.routine).sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const hint = d === tomorrow ? 'Planning tomorrow. Write what you will do.'
    : d < today ? 'Looking back. Unticked activities are marked missed.' : '';
  const band = d < today && tasks.length ? ` · <span class="band b-${Perf.band(pct)}">${Perf.bandLabel(Perf.band(pct))}</span>`
    : tasks.length && pct === 100 ? ' · <span class="band b-perfect">🎉 Perfect</span>' : '';
  const showDaily = daily.length || routines().length;
  const otherLabel = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : 'This day';

  return `<section class="view">
    <div class="card planhead">
      <div class="ring${tasks.length && pct === 100 ? ' full' : ''}" style="--p:${pct}"><b>${tasks.length ? pct + '%' : '–'}</b></div>
      <div class="ph-main">
        <div class="datebar">
          <button type="button" class="icon nav" data-act="planShift" data-v="-1" aria-label="Previous day">‹</button>
          <label class="datepick"><span>${U.esc(U.fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }) }))}</span><input type="date" id="planDate" value="${d}" aria-label="Pick a date"></label>
          <button type="button" class="icon nav" data-act="planShift" data-v="1" aria-label="Next day">›</button>
        </div>
        <div class="ph-count">${tasks.length ? `<b>${done.length}/${tasks.length}</b> done${band}` : '<span class="muted">No activities yet</span>'}</div>
      </div>
      ${d === today ? weekLine() : ''}
    </div>
    ${d !== today ? '<button type="button" class="linkbtn backtoday" data-act="planJump" data-v="today">↩ Back to today</button>' : ''}
    ${hint ? `<p class="hint">${hint}</p>` : ''}

    ${missedEarlier.length ? `<div class="missedwrap">
      <button type="button" class="missedline" data-act="toggleMissed" aria-expanded="${ui.missedOpen}">
        <span>⚠ <b>${missedEarlier.length}</b> missed from earlier days</span><span>${ui.missedOpen ? 'Hide ▴' : 'Review ▾'}</span></button>
      ${ui.missedOpen ? taskList(missedEarlier, today, { showDate: true, tag: true }) : ''}
    </div>` : ''}

    ${showDaily ? `<div class="plansec daily">
      <div class="sechead"><h3 class="sectitle">🔁 Daily</h3>
        <button type="button" class="mini" data-act="toggleManage" aria-expanded="${ui.manageOpen}">${ui.manageOpen ? 'Close' : '⚙ Manage'}</button></div>
      ${ui.manageOpen ? manageDaily() : ''}
      ${daily.length ? taskList(daily, today) : `<p class="muted small secnote">${tasks.some(t => t.routine) ? 'All daily activities done ✓' : 'None on this day.'}</p>`}
    </div>` : ''}

    ${other.length || !showDaily ? `<div class="plansec">
      <div class="sechead"><h3 class="sectitle">📝 ${otherLabel}</h3></div>
      ${other.length ? taskList(other, today) : tasks.length ? '<p class="empty">Everything here is done ✓</p>' : emptyDay(d, today)}
    </div>` : ''}

    ${done.length ? `<div class="plansec donesec">
      <button type="button" class="sechead donehead" data-act="toggleDone" aria-expanded="${ui.doneOpen}">
        <span class="sectitle">✓ Done <span class="badge muted">${done.length}</span></span><span class="muted small">${ui.doneOpen ? 'Hide ▴' : 'Show ▾'}</span></button>
      ${ui.doneOpen ? taskList(done, today, { tag: true }) : ''}
    </div>` : ''}

    <form id="taskForm" class="addrow dock" autocomplete="off">
      <div class="addfield">
        <input id="taskInput" placeholder="${ui.dailyOn ? 'Add a daily activity…' : 'Add an activity…'}" maxlength="200" enterkeyhint="done">
        <button type="button" class="addclear" data-act="clearTask" aria-label="Clear">×</button>
        <label class="dailytog" title="Repeat Mon–Fri"><input type="checkbox" id="taskDaily" aria-label="Repeat Mon–Fri"${ui.dailyOn ? ' checked' : ''}><span>🔁</span></label>
      </div>
      <button class="btn primary addbtn" type="submit" aria-label="Add">+</button>
    </form>
  </section>`;
}

// Renaming a daily activity renames it from today on; past days keep the old name.
function saveEdit(id, text) {
  const t = Store.get('tasks', id);
  if (!text) return toast('Type a name, or tap Cancel.');
  ui.editing = null;
  if (!t || t.deleted || text === t.text) return render();
  const today = U.today();
  const r = t.routine && Store.get('routines', t.routine);
  if (r && !r.deleted && t.date >= today) {
    Store.upsert('routines', { ...r, text });
    for (const x of Store.list('tasks')) {
      if (x.routine === r.id && x.date >= today) Store.upsert('tasks', { ...x, text });
    }
    toast('Renamed for today and every day after');
  } else {
    Store.upsert('tasks', { ...t, text });
  }
}

function emptyDay(d, today) {
  if (d < today) return '<p class="empty">Nothing was planned for this day.</p>';
  return `<div class="emptyday">
    <div class="ed-emo" aria-hidden="true">✨</div>
    <b>${d === today ? 'A fresh day' : 'Plan ahead'}</b>
    <p class="muted small">Type what you want to get done in the box below.<br>Tap 🔁 first to make it repeat Mon–Fri.</p>
  </div>`;
}

// A short burst of confetti from the progress ring when the day hits 100%.
function celebrate() {
  toast('🎉 Perfect day! Everything is done.');
  const ring = $('.planhead .ring');
  if (!ring || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = ring.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'confetti';
  box.style.left = r.left + r.width / 2 + 'px';
  box.style.top = r.top + r.height / 2 + 'px';
  const colors = ['#a78bfa', '#22c55e', '#f472b6', '#60a5fa', '#fbbf24', '#fb923c'];
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 90;
    const p = document.createElement('i');
    p.style.cssText = `--x:${Math.cos(a) * dist}px;--y:${Math.sin(a) * dist - 40}px;--r:${Math.random() * 540 - 270}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 80}ms`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1400);
}

function manageDaily() {
  const rs = routines();
  return `<div class="managebox">
    <p class="muted small">These are added to your plan every day, or Mon–Fri only. Tap the days to switch. Stop one to end it. Past days stay as they are.</p>
    ${rs.length ? `<ul class="dailylist">${rs.map(r => `<li><span class="text">${U.esc(r.text)}</span>
      <span class="dailyacts"><button type="button" class="mini" data-act="dailyDays" data-id="${r.id}">${r.days === 'weekdays' ? 'Mon–Fri' : 'Every day'}</button>
      <button type="button" class="mini" data-act="stopDaily" data-id="${r.id}">Stop</button></span></li>`).join('')}</ul>`
      : '<p class="muted small">No daily activities. Turn on 🔁 Daily when adding one.</p>'}
  </div>`;
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

// ---------- Pairs ----------

function pairRow(p) {
  const n = Pairs.trades(p.name).length;
  const act = p.hidden
    ? `<button type="button" class="mini" data-act="showPair" data-id="${U.esc(p.id)}">Show again</button>`
    : n
      ? `<button type="button" class="icon pact" data-act="hidePair" data-id="${U.esc(p.id)}" aria-label="Hide ${U.esc(p.name)}" title="Stopped trading it: hide (keeps ${n} trade${n === 1 ? '' : 's'})">🙈</button>`
      : `<button type="button" class="icon del pact" data-act="delPair" data-id="${U.esc(p.id)}" aria-label="Delete ${U.esc(p.name)}">×</button>`;
  return `<li class="pairrow${p.hidden ? ' hid' : ''}">
    <span class="pdot" style="${Pairs.style(p.name)}" aria-hidden="true"></span>
    <input data-pair="${U.esc(p.id)}" data-f="name" value="${U.esc(p.name)}" maxlength="12" autocapitalize="characters" aria-label="Name">
    <select data-pair="${U.esc(p.id)}" data-f="unit" aria-label="Unit for ${U.esc(p.name)}">
      <option value="pts"${p.unit === 'pips' ? '' : ' selected'}>Points</option><option value="pips"${p.unit === 'pips' ? ' selected' : ''}>Pips</option></select>
    <input data-pair="${U.esc(p.id)}" data-f="value" value="${U.esc(p.value || '')}" inputmode="decimal" placeholder="$" aria-label="$ per ${p.unit === 'pips' ? 'pip' : 'point'} for ${U.esc(p.name)}">
    ${act}
  </li>`;
}

function renderPairs() {
  const all = Pairs.all();
  const hidden = all.filter(p => p.hidden);
  $('#pairList').innerHTML = all.filter(p => !p.hidden).map(pairRow).join('') ||
    '<li class="muted small">No pairs yet. Add one below.</li>';
  $('#hiddenPairs').innerHTML = hidden.length
    ? `<h3 class="sub">Stopped trading</h3><ul class="pairlist">${hidden.map(pairRow).join('')}</ul>` : '';
}

function openPairs() {
  const f = $('#pairForm');
  f.newName.value = '';
  f.newUnit.value = 'pts';
  f.newValue.value = '';
  renderPairs();
  $('#pairDlg').showModal();
}

function cleanPairName(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }

function savePair(p, patch) {
  const { id, name, unit, value, color, hidden, createdAt } = { ...p, ...patch };
  Store.upsert('pairs', { id, name, unit, value: String(value || ''), color, hidden: !!hidden, createdAt: createdAt || 0 });
}

function editPair(el) {
  const p = Pairs.all().find(x => x.id === el.dataset.pair);
  if (!p) return;
  const f = el.dataset.f;
  if (f === 'name') {
    const name = cleanPairName(el.value);
    if (!name) { el.value = p.name; return toast('A pair needs a name.'); }
    if (name === p.name) { el.value = name; return; }
    if (Pairs.get(name)) { el.value = p.name; return toast(`${name} already exists.`); }
    // Trades keep the pair's name, so move them to the new one.
    for (const t of Pairs.trades(p.name)) Store.upsert('trades', { ...t, pair: name });
    if (lsGet('dt.lastPair', '') === p.name) lsSet('dt.lastPair', name);
    if (ui.tradePair === p.name) ui.tradePair = name;
    const picked = formPair() === p.name;
    savePair(p, { name });
    if (picked && $('#tradeDlg').open) renderPairPick(name);
    el.value = name;
  } else if (f === 'unit') {
    savePair(p, { unit: el.value === 'pips' ? 'pips' : 'pts' });
  } else if (f === 'value') {
    const v = U.num(el.value);
    if (!(v > 0)) { el.value = p.value || ''; return toast('Enter the $ value per point for 1.00 lot.'); }
    savePair(p, { value: String(v) });
  }
}

function addPair() {
  const f = $('#pairForm');
  const name = cleanPairName(f.newName.value);
  const v = U.num(f.newValue.value);
  if (!name) return toast('Type the pair name, e.g. GBPUSD.');
  if (Pairs.get(name)) return toast(`${name} already exists.`);
  if (!(v > 0)) return toast('Enter the $ value per point for 1.00 lot.');
  savePair({ id: U.uid(), color: Pairs.nextColor(), createdAt: Date.now() },
    { name, unit: f.newUnit.value === 'pips' ? 'pips' : 'pts', value: String(v) });
  f.newName.value = '';
  f.newValue.value = '';
  renderPairs();
  toast(`Added ${name}`);
}

function setPairHidden(id, hidden) {
  const p = Pairs.all().find(x => x.id === id);
  if (!p) return;
  savePair(p, { hidden });
  if (hidden && ui.tradePair === p.name) ui.tradePair = 'all';
  renderPairs();
  toast(hidden ? `${p.name} hidden. Its trades are kept.` : `${p.name} is back`);
}

function delPair(id) {
  const p = Pairs.all().find(x => x.id === id);
  if (!p) return;
  if (Pairs.trades(p.name).length) return setPairHidden(id, true);
  if (!confirm(`Delete ${p.name}?`)) return;
  // Built-in pairs have no stored item yet, so save a delete marker.
  Store.upsert('pairs', { id, deleted: true });
  if (ui.tradePair === p.name) ui.tradePair = 'all';
  renderPairs();
}

// ---------- Trade tags ----------

function tagRow(t) {
  const n = Tags.trades(t.id).length;
  const act = t.hidden
    ? `<button type="button" class="mini" data-act="showTag" data-id="${U.esc(t.id)}">Show again</button>`
    : n
      ? `<button type="button" class="icon" data-act="hideTag" data-id="${U.esc(t.id)}" aria-label="Hide ${U.esc(t.name)}" title="Hide (keeps it on ${n} trade${n === 1 ? '' : 's'})">🙈</button>`
      : `<button type="button" class="icon del" data-act="delTag" data-id="${U.esc(t.id)}" aria-label="Delete ${U.esc(t.name)}">×</button>`;
  return `<li class="catrow tagrow${t.hidden ? ' hid' : ''}">
    <input data-tag="${U.esc(t.id)}" value="${U.esc(t.name)}" maxlength="24" aria-label="Name">
    ${act}
  </li>`;
}

function renderTags() {
  const empty = '<li class="muted small">None yet. Add one below.</li>';
  $('#setupList').innerHTML = Tags.active('setup').map(tagRow).join('') || empty;
  $('#mistakeList').innerHTML = Tags.active('mistake').map(tagRow).join('') || empty;
  const hidden = Tags.all().filter(t => t.hidden);
  $('#hiddenTags').innerHTML = hidden.length
    ? `<h3 class="sub">Hidden</h3><ul class="catlist">${hidden.map(tagRow).join('')}</ul>` : '';
}

function openTags() {
  const f = $('#tagForm');
  f.newSetup.value = '';
  f.newMistake.value = '';
  renderTags();
  $('#tagDlg').showModal();
}

function saveTag(t, patch) {
  const { id, kind, name, hidden, createdAt } = { ...t, ...patch };
  Store.upsert('tags', { id, kind, name, hidden: !!hidden, createdAt: createdAt || 0 });
}

function tagTaken(kind, name, id) {
  return Tags.all(kind).some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase());
}

function renameTag(el) {
  const t = Tags.get(el.dataset.tag);
  if (!t) return;
  const name = el.value.trim();
  if (!name) { el.value = t.name; return toast('A tag needs a name.'); }
  if (name === t.name) return;
  if (tagTaken(t.kind, name, t.id)) { el.value = t.name; return toast(`"${name}" already exists.`); }
  saveTag(t, { name });
}

function addTag(kind) {
  const input = $('#tagForm')[kind === 'setup' ? 'newSetup' : 'newMistake'];
  const name = input.value.trim();
  if (!name) return toast(`Type a name for the ${kind}.`);
  if (tagTaken(kind, name)) return toast(`"${name}" already exists.`);
  saveTag({ id: U.uid(), kind, createdAt: Date.now() }, { name });
  input.value = '';
  renderTags();
  toast(`Added ${name}`);
}

function setTagHidden(id, hidden) {
  const t = Tags.get(id);
  if (!t) return;
  saveTag(t, { hidden });
  renderTags();
  toast(hidden ? `${t.name} hidden. Its trades keep it.` : `${t.name} is back`);
}

function delTag(id) {
  const t = Tags.get(id);
  if (!t) return;
  if (Tags.trades(id).length) return setTagHidden(id, true);
  if (!confirm(`Delete "${t.name}"?`)) return;
  // Built-in tags have no stored item yet, so save a delete marker.
  Store.upsert('tags', { id, deleted: true });
  renderTags();
}

// Pair buttons in the trade form: pairs you trade, plus the edited trade's
// own pair if it's hidden now.
function renderPairPick(sel) {
  const list = Pairs.active();
  const own = form.id && Store.get('trades', form.id) ? Store.get('trades', form.id).pair : '';
  if (own && !list.some(p => p.name === own) && Pairs.get(own)) list.push(Pairs.get(own));
  if (!list.some(p => p.name === sel)) sel = list[0] ? list[0].name : '';
  $('#pairPick').innerHTML = list.length
    ? list.map(p => `<label style="${Pairs.style(p.name)}"><input type="radio" name="pair" value="${U.esc(p.name)}"${p.name === sel ? ' checked' : ''}><span>${U.esc(p.name)}</span></label>`).join('')
    : '<p class="muted small nopair">No pairs yet. Tap “Add or edit pairs”.</p>';
}

function formPair() { return ($('#pairPick input:checked') || {}).value || ''; }

// Setup and mistake chips in the trade form: tags in use, plus the edited
// trade's own tags if they're hidden now.
function renderTagPick(setup, mistakes) {
  const own = form.id && Store.get('trades', form.id) ? Store.get('trades', form.id) : null;
  const pick = (kind, sel) => {
    const list = Tags.active(kind);
    const mine = own ? (kind === 'setup' ? [own.setup] : own.mistakes || []) : [];
    for (const id of mine) if (!list.some(t => t.id === id) && Tags.get(id)) list.push(Tags.get(id));
    return list.map(t => `<label><input type="checkbox" name="${kind}" value="${U.esc(t.id)}"${sel.includes(t.id) ? ' checked' : ''}><span>${U.esc(t.name)}</span></label>`).join('') +
      '<button type="button" class="catedit" data-act="manageTags">✏️ Edit</button>';
  };
  $('#setupPick').innerHTML = pick('setup', setup ? [setup] : []);
  $('#mistakePick').innerHTML = pick('mistake', mistakes || []);
}

function formTags() {
  return {
    setup: ($('#setupPick input:checked') || {}).value || '',
    mistakes: $$('#mistakePick input:checked').map(i => i.value),
  };
}

// ---------- Trades ----------

function tradeCard(t) {
  const c = U.calc(t);
  const pnl = U.num(t.pnl);
  const meta = [U.fmtMove(c.move, c.unit), U.fmtRR(c.rr)].filter(Boolean).join(' · ');
  return `<button type="button" class="trade p-${U.esc(t.pair)}" style="${Pairs.style(t.pair)}" data-act="openTrade" data-id="${t.id}">
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
    ${tradeTags(t)}
    ${t.note ? `<div class="note">${U.esc(t.note)}</div>` : ''}
  </button>`;
}

function tradeTags(t) {
  const setup = Tags.setup(t), mis = Tags.mistakes(t);
  if (!setup && !mis.length) return '';
  return `<div class="ttags">${setup ? `<span class="badge tset">${U.esc(Tags.name(setup))}</span>` : ''}${mis.map(id => `<span class="badge red">${U.esc(Tags.name(id))}</span>`).join('')}</div>`;
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
    ${chips('tradePair', ui.tradePair, [['all', 'All pairs'], ...Pairs.all().filter(p => !p.hidden || p.name === ui.tradePair).map(p => [U.esc(p.name), U.esc(p.name)])])}
    <p class="muted small sumline">${list.length} trade${list.length === 1 ? '' : 's'} · <span class="${U.cls(total)}">${U.money(total)}</span></p>
    ${list.length ? tradeGroups(list) : '<p class="empty">No trades in this range.</p>'}
  </section>`;
}

// ---------- Trade form ----------

const form = { id: null, shot: null, pnlTouched: false };

function pointValue(pair) { return Pairs.value(pair); }

// PnL = points × lot × $ per point for 1.00 lot.
function autoPnl(f) {
  const pts = Math.abs(U.num(f.points.value));
  const lot = U.num(f.lot.value);
  if (!isFinite(pts) || !isFinite(lot)) return NaN;
  const pv = pointValue(formPair());
  if (!isFinite(pv)) return NaN;
  return Math.round(pts * lot * pv * 100) / 100;
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
  renderPairPick(t ? t.pair : lsGet('dt.lastPair', ''));
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
  renderTagPick(t ? t.setup : lsGet('dt.lastSetup', ''), t ? t.mistakes : []);
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
    pair: formPair(),
    side: f.side.value,
    lot: f.lot.value.trim(),
    date: f.date.value,
    time: f.time.value,
    result: f.result.value,
    points: signed(f.points.value),
    slPts: isFinite(sl) && sl > 0 ? String(Math.abs(sl)) : '',
    pnl: signed(f.pnl.value),
    note: f.note.value.trim(),
    ...formTags(),
  };
}

function updatePreview() {
  const f = $('#tradeForm');
  // Typing a minus sign means it was a loss.
  if (/^\s*-/.test(f.points.value) || /^\s*-/.test(f.pnl.value)) f.result.value = 'Loss';
  const auto = autoPnl(f);
  if (!form.pnlTouched) f.pnl.value = isFinite(auto) ? auto : '';
  const unitName = Pairs.unit(formPair()) === 'pips' ? 'pip' : 'point';
  $('#pnlHint').innerHTML = form.pnlTouched
    ? `PnL typed by you. <button type="button" class="linkbtn" data-act="autoPnl">Use auto</button>`
    : isFinite(auto)
      ? `Auto: ${Math.abs(U.num(f.points.value))} × ${U.num(f.lot.value)} lot × $${pointValue(formPair())} per ${unitName}`
      : formPair() && !isFinite(pointValue(formPair()))
        ? `Set the $ per ${unitName} for ${U.esc(formPair())} in “Add or edit pairs” to calculate PnL.`
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
  if (!t.pair) return toast('Pick a pair, or add one with “Add or edit pairs”.');
  if (!t.date || !t.time) return toast('Set the date and time.');
  if (!isFinite(U.num(t.points))) return toast('Enter the points.');
  if (!isFinite(U.num(t.pnl))) return toast('Enter the PnL in $.');
  const old = form.id ? Store.get('trades', form.id) : null;
  const item = { ...(old || { id: U.uid(), createdAt: Date.now() }), ...t, shot: form.shot || null };
  if (!item.shot) delete item.shot;
  if (!item.setup) delete item.setup;
  if (!item.mistakes.length) delete item.mistakes;
  // Older trades stored prices; points replace them.
  delete item.entry; delete item.sl; delete item.exit;
  Store.upsert('trades', item);
  if (old && old.shot && (!form.shot || old.shot.id !== form.shot.id)) Store.deleteShot(old.shot);
  lsSet('dt.lastPair', t.pair);
  lsSet('dt.lastAcct', t.accountId);
  if (t.lot) lsSet('dt.lastLot', t.lot);
  if (!old) lsSet('dt.lastSetup', t.setup);
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

// ---------- Money ----------

function expRow(e) {
  const c = Money.cat(e.cat);
  const meta = [e.time, METHODS[methodOf(e.method)], e.extra && '🧾 Extra'].filter(Boolean).map(U.esc).join(' · ');
  return `<button type="button" class="exp" data-act="openExp" data-id="${e.id}">
    <span class="ex-emo" aria-hidden="true">${U.esc(c.emoji || '•')}</span>
    <span class="ex-main"><b>${U.esc(c.name)}</b><small>${meta}</small>${e.note ? `<small class="note">${U.esc(e.note)}</small>` : ''}</span>
    <span class="ex-amt"><b>${Money.fmt(Money.usd(e), false)}</b>${e.cur === 'KHR' ? `<small>${Money.fmtKHR(U.num(e.amount))}</small>` : ''}</span>
  </button>`;
}

function expGroups(list) {
  const groups = new Map();
  for (const e of list) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return [...groups].map(([date, items]) => {
    const t = Money.total(items);
    const limit = Money.dailyBudget(date);
    return `<h3 class="dayhead"><span>${U.esc(U.dayLabel(date))}</span><span class="${limit && Money.dayTotal(items) > limit ? 'neg' : ''}">${Money.fmt(t, false)}</span></h3>
      <div class="explist">${items.map(expRow).join('')}</div>`;
  }).join('');
}

function catBreakdown(list) {
  const rows = Money.byCat(list);
  if (!rows.length) return '';
  const total = Money.total(list);
  const top = rows[0].usd;
  return `<div class="card catbreak">
    <h4 class="sub">Where it went</h4>
    ${rows.map(r => {
      const c = Money.cat(r.id);
      return `<div class="cb-row">
        <div class="row small"><span>${U.esc(c.emoji || '•')} ${U.esc(c.name)} <span class="muted">· ${r.n}×</span></span>
          <span><b>${Money.fmt(r.usd, false)}</b> <span class="muted">${Math.round(r.usd / total * 100)}%</span></span></div>
        <div class="bar"><i style="width:${top > 0 ? Math.max(2, r.usd / top * 100) : 0}%"></i></div>
      </div>`;
    }).join('')}
  </div>`;
}

function spendBanner(spent) {
  const limit = Money.dailyBudget(U.today());
  if (!limit) return '';
  if (spent > limit) return `<div class="banner red">🛑 You're ${Money.fmt(spent - limit, false)} over today's limit.</div>`;
  if (spent >= limit * 0.75) return `<div class="banner amber">⚠️ Only ${Money.fmt(limit - spent, false)} left to spend today.</div>`;
  return '';
}

// Today against the daily limit (the week's money ÷ 5).
function todayBlock(spent, limit) {
  const pct = spent / limit * 100;
  return `<div class="limit ${riskLevel(pct)}">
      <div class="row small"><span>Today</span><span><b>${Money.fmt(spent, false)}</b> / ${Money.fmt(limit, false)} · ${spent > limit ? `<b class="neg">${Money.fmt(spent - limit, false)} over</b>` : `${Money.fmt(limit - spent, false)} left`}</span></div>
      <div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
}

// Wallet for one spending week (Sunday to Saturday). The arrows step back
// through past weeks so their money can be set and their spending checked.
function walletCard(ws) {
  const w = Money.week(ws);
  const today = U.today();
  const current = ws === Money.weekStart(today);
  const head = `<div class="row w-head">
      <button type="button" class="icon nav" data-act="walletShift" data-v="-1" aria-label="Previous week">‹</button>
      <span class="w-title"><b>👛 ${current ? 'This week' : ws === U.addDays(Money.weekStart(today), -7) ? 'Last week' : 'Past week'}</b><span class="muted small">${U.esc(Money.weekLabel(ws))}</span></span>
      <button type="button" class="icon nav" data-act="walletShift" data-v="1" aria-label="Next week"${current ? ' disabled' : ''}>›</button>
    </div>`;
  const foot = current ? '' : `<div class="w-links">
      <button type="button" class="linkbtn" data-act="openWeek" data-v="${ws}">See this week's spending</button>
      <button type="button" class="linkbtn" data-act="walletNow">Back to this week</button>
    </div>`;
  if (!w.a) {
    return `<div class="card wallet">
      ${head}
      <p class="muted small">How much money ${current ? 'do you have to spend this week' : 'did you have for this week'}?</p>
      ${w.spent ? `<p class="small">${current ? 'Spent so far' : 'Spent'}: <b>${Money.fmt(w.spent, false)}</b> · ${w.list.length} item${w.list.length === 1 ? '' : 's'}</p>` : ''}
      <button type="button" class="btn primary block" data-act="setAllow" data-v="${ws}">+ Add week's money</button>
      ${foot}
    </div>`;
  }
  // Extra spending only comes off the week's money once the week is over.
  const extra = current ? w.spent - Money.dayTotal(w.list) : 0;
  const spent = w.spent - extra;
  const left = w.got - spent;
  const pctLeft = w.got > 0 ? Math.max(0, Math.min(100, left / w.got * 100)) : 0;
  const level = left < 0 ? 'hit' : pctLeft <= 25 ? 'warn' : '';
  const daysLeft = 7 - (U.weekdayMon(today) + 1) % 7; // including today
  const daily = w.got / SPEND_DAYS;
  const spentToday = current ? Money.dayTotal(Money.list(today, today)) : 0;
  return `<div class="card wallet ${level}">
    ${head}
    <div class="w-left">
      <span class="muted small">${left < 0 ? 'Over budget by' : current ? 'Left in wallet' : 'Left over'}</span>
      <span class="big ${left < 0 ? 'neg' : ''}">${Money.fmt(Math.abs(left), false)}</span>
      ${w.a.cur === 'KHR' ? `<span class="muted small">≈ ${Money.fmtKHR(Math.abs(left) * KHR_PER_USD)}</span>` : ''}
    </div>
    <div class="bar"><i style="width:${pctLeft}%"></i></div>
    <div class="w-stats">
      <div><span>Week's money</span><b>${Money.fmtOrig(w.a)}</b></div>
      <div><span>Spent</span><b>${Money.fmt(spent, false)}</b></div>
      <div><span>Daily limit</span><b>${Money.fmt(daily, false)}</b></div>
    </div>
    ${current ? todayBlock(spentToday, daily) : ''}
    ${extra > 0 ? `<p class="small w-note">🧾 Extra this week <b>${Money.fmt(extra, false)}</b> · taken off when the week ends</p>` : ''}
    ${current ? `<p class="muted small w-note">${daysLeft} day${daysLeft === 1 ? '' : 's'} left until Saturday · daily limit = money ÷ ${SPEND_DAYS}</p>` : ''}
    <button type="button" class="linkbtn" data-act="setAllow" data-v="${ws}">Edit week's money</button>
    ${foot}
  </div>`;
}

// Last week's total, shown at the top for the first two days of a new week.
function lastWeekRecap() {
  const today = U.today();
  const cur = Money.weekStart(today);
  if (today > U.addDays(cur, 1)) return '';
  const w = Money.week(U.addDays(cur, -7));
  if (!w.a && !w.list.length) return '';
  const msg = !w.a ? `you spent <b>${Money.fmt(w.spent, false)}</b>`
    : w.left < 0 ? `you spent <b>${Money.fmt(w.spent, false)}</b> of ${Money.fmtOrig(w.a)}, <b>${Money.fmt(-w.left, false)} over</b> 😬`
    : `you spent <b>${Money.fmt(w.spent, false)}</b> of ${Money.fmtOrig(w.a)}, <b>${Money.fmt(w.left, false)} left over</b> 🎉`;
  return `<button type="button" class="banner recap ${!w.a ? '' : w.left < 0 ? 'red' : 'green'}" data-act="openWeek" data-v="${w.ws}">
    <span>📅 Last week ${msg}</span><span class="recap-go" aria-hidden="true">›</span>
  </button>`;
}

function weekHistory() {
  const cur = Money.weekStart(U.today());
  const weeks = Money.weeks().filter(ws => ws < cur);
  if (!weeks.length) return '';
  const shown = ui.histAll ? weeks : weeks.slice(0, 6);
  const saved = weeks.map(Money.week).filter(w => w.a).reduce((a, w) => a + w.left, 0);
  return `<div class="card history">
    <div class="row"><h4 class="sub">📅 Week history</h4>
      <span class="small muted">Left over in total <b class="${U.cls(saved)}">${Money.fmt(saved)}</b></span></div>
    <div class="histlist">${shown.map(ws => {
      const w = Money.week(ws);
      return `<button type="button" class="histrow" data-act="openWeek" data-v="${ws}">
        <span class="h-main"><span class="h-date">${U.esc(Money.weekLabel(ws))}</span>
          <span class="h-nums">Money <b>${w.a ? Money.fmtOrig(w.a) : '–'}</b> · Spent <b>${Money.fmt(w.spent, false)}</b></span></span>
        <span class="h-left ${w.a ? U.cls(w.left) : ''}">${w.a ? Money.fmt(w.left) : '–'}<small>${w.a ? (w.left < 0 ? 'over' : 'left') : 'no money set'}</small></span>
      </button>`;
    }).join('')}</div>
    ${weeks.length > 6 ? `<button type="button" class="btn ghost block" data-act="histAll">${ui.histAll ? 'Show less' : `Show all ${weeks.length} weeks`}</button>` : ''}
  </div>`;
}

// The wallet card's week; it never goes past this week.
function walletWeek() {
  const cur = Money.weekStart(U.today());
  return ui.walletWs && ui.walletWs < cur ? ui.walletWs : cur;
}

function viewMoney() {
  const today = U.today();
  const todays = Money.list(today, today);
  const spent = Money.total(todays);
  const monthFrom = today.slice(0, 8) + '01';
  const month = Money.total(Money.list(monthFrom, today));
  const [from, to] = ui.moneyRange === 'week' ? [Money.weekStart(today), today] : rangeDates(ui.moneyRange);
  const list = Money.list(from, to);
  const total = Money.total(list);
  const m = Money.byMethod(list);

  return `<section class="view">
    ${spendBanner(Money.dayTotal(todays))}
    ${lastWeekRecap()}
    ${walletCard(walletWeek())}
    <div class="card statrow">
      <div><span>Spent today</span><b>${Money.fmt(spent, false)}</b></div>
      <div><span>This month</span><b>${Money.fmt(month, false)}</b></div>
      <div><span>Avg / day</span><b>${Money.fmt(Money.perDay(month, monthFrom, today), false)}</b></div>
    </div>
    <button type="button" class="btn primary block" data-act="addExp">+ Add expense</button>

    ${chips('moneyRange', ui.moneyRange, [['today', 'Today'], ['week', 'This week'], ['month', 'Month'], ['all', 'All']])}
    <p class="muted small sumline">${list.length} item${list.length === 1 ? '' : 's'} · <b>${Money.fmt(total, false)}</b>
      ${list.length ? ` · ${U.esc(Money.methodLine(m))}` : ''}</p>
    ${catBreakdown(list)}
    ${list.length ? expGroups(list) : '<p class="empty">No spending in this range.</p>'}
    ${weekHistory()}
    <button type="button" class="btn ghost block" data-act="manageCats">✏️ Edit categories</button>
  </section>`;
}

// ---------- Week's money ----------

// In NZ$ mode every amount is NZ$, so the riel/dollar switch is hidden.
function curPick(f) {
  f.querySelector('.cur').hidden = Money.nz();
}

function formCur(f) {
  return Money.nz() ? 'NZD' : f.cur.value === 'KHR' ? 'KHR' : 'USD';
}

const aw = { ws: null };

function openAllow(ws) {
  const a = Money.allowance(ws);
  const last = a || Money.lastAllowance(ws);
  const f = $('#allowForm');
  f.reset();
  aw.ws = ws;
  $('#allowWeek').textContent = `${Money.weekLabel(ws)}${ws === Money.weekStart(U.today()) ? ' · this week' : ''}`;
  // A new week starts with last week's amount, ready to confirm.
  f.amount.value = last ? last.amount : '';
  f.cur.value = last ? last.cur : lsGet('dt.lastCur', 'USD');
  curPick(f);
  $('#delAllow').hidden = !a;
  allowHint();
  $('#allowDlg').showModal();
}

function allowHint() {
  const f = $('#allowForm');
  const v = Money.parse(f.amount.value, f.cur.value);
  let txt = !(v > 0) || Money.nz() ? '' : f.cur.value === 'KHR' ? `= ${Money.fmt(v / KHR_PER_USD, false)}` : `= ${Money.fmtKHR(v * KHR_PER_USD)}`;
  if (!Money.allowance(aw.ws) && v > 0 && Money.lastAllowance(aw.ws)) txt += `${txt ? ' · ' : ''}same as last week, change it if needed`;
  $('#allowHint').textContent = txt;
}

function saveAllow() {
  const f = $('#allowForm');
  const cur = formCur(f);
  const v = Money.parse(f.amount.value, cur);
  if (!(v > 0)) return toast('Enter the money you have for this week.');
  const old = Money.allowance(aw.ws);
  Store.upsert('allowances', {
    ...(old || { createdAt: Date.now() }),
    id: aw.ws,
    amount: String(cur === 'KHR' ? Math.round(v) : Math.round(v * 100) / 100),
    cur,
  });
  $('#allowDlg').close();
  toast(old ? "Week's money updated" : "Week's money saved 👛");
}

// ---------- Week detail ----------

function renderWeek(ws) {
  const w = Money.week(ws);
  $('#weekTitle').textContent = `👛 ${Money.weekLabel(ws)}`;
  $('#weekBody').innerHTML = `
    <div class="tiles">
      <div class="tile"><span>Week's money</span><b>${w.a ? Money.fmtOrig(w.a) : '–'}</b>${w.a && w.a.cur === 'KHR' ? `<small>= ${Money.fmt(w.got, false)}</small>` : ''}</div>
      <div class="tile"><span>Spent</span><b>${Money.fmt(w.spent, false)}</b><small>${w.list.length} item${w.list.length === 1 ? '' : 's'}</small></div>
      <div class="tile"><span>${w.left < 0 ? 'Over budget' : 'Left over'}</span><b class="${w.a ? U.cls(w.left) : ''}">${w.a ? Money.fmt(Math.abs(w.left), false) : '–'}</b></div>
      <div class="tile"><span>Avg / day</span><b>${Money.fmt(w.spent / 7, false)}</b></div>
    </div>
    <button type="button" class="btn ghost block" data-act="setAllow" data-v="${ws}">${w.a ? "Edit week's money" : "+ Add week's money"}</button>
    ${catBreakdown(w.list)}
    ${w.list.length ? expGroups(w.list) : '<p class="empty">No spending this week.</p>'}`;
}

function openWeek(ws) {
  ui.weekOpen = ws;
  renderWeek(ws);
  $('#weekDlg').showModal();
}

// ---------- Expense form ----------

const eform = { id: null };

function renderCatPick(sel) {
  $('#catPick').innerHTML = Money.cats().map(c =>
    `<label><input type="radio" name="cat" value="${U.esc(c.id)}"${c.id === sel ? ' checked' : ''}><span>${U.esc(c.emoji || '•')} ${U.esc(c.name)}</span></label>`).join('') +
    '<button type="button" class="catedit" data-act="manageCats">✏️ Edit</button>';
}

function openExpForm(id, date) {
  const e = id ? Store.get('expenses', id) : null;
  const f = $('#expForm');
  f.reset();
  eform.id = id || null;
  $('#expTitle').textContent = e ? 'Edit expense' : 'New expense';
  f.amount.value = e ? e.amount : '';
  f.cur.value = e ? e.cur : lsGet('dt.lastCur', 'KHR');
  curPick(f);
  renderCatPick(e ? Money.cat(e.cat).id : '');
  f.method.value = methodOf(e ? e.method : lsGet('dt.lastMethod', 'cash'));
  f.date.value = e ? e.date : date || U.today();
  f.time.value = e ? e.time || '' : U.nowTime();
  f.note.value = e ? e.note || '' : '';
  f.extra.checked = !!(e && e.extra);
  $('#delExp').hidden = !e;
  expHint();
  $('#expDlg').showModal();
}

function expHint() {
  const f = $('#expForm');
  const v = Money.parse(f.amount.value, f.cur.value);
  if (!(v > 0)) { $('#expHint').textContent = Money.nz() ? '' : 'Riel is counted at 4,100៛ = $1.'; return; }
  const cur = formCur(f);
  const usd = Money.usd({ amount: v, cur });
  let txt = Money.nz() ? '' : cur === 'KHR' ? `= ${Money.fmt(usd, false)}` : `= ${Money.fmtKHR(v * KHR_PER_USD)}`;
  const limit = f.date.value ? Money.dailyBudget(f.date.value) : 0;
  if (limit && f.extra.checked) {
    txt += `${txt ? ' · ' : ''}not counted in the daily limit`;
  } else if (limit) {
    const before = Money.dayTotal(Money.list(f.date.value, f.date.value).filter(e => e.id !== eform.id));
    txt += `${txt ? ' · ' : ''}${f.date.value === U.today() ? 'today' : 'that day'} will be ${Money.fmt(before + usd, false)} of the ${Money.fmt(limit, false)} daily limit`;
  }
  $('#expHint').textContent = txt;
}

function saveExp() {
  const f = $('#expForm');
  const cur = formCur(f);
  const amt = Money.parse(f.amount.value, cur);
  const cat = ($('#catPick input:checked') || {}).value;
  if (!(amt > 0)) return toast('Enter how much you spent.');
  if (!cat) return toast('Pick what it was for.');
  if (!f.date.value) return toast('Set the date.');
  const old = eform.id ? Store.get('expenses', eform.id) : null;
  const date = f.date.value;
  const before = Money.dayTotal(Money.list(date, date).filter(e => e.id !== eform.id));
  const item = {
    ...(old || { id: U.uid(), createdAt: Date.now() }),
    amount: String(cur === 'KHR' ? Math.round(amt) : Math.round(amt * 100) / 100),
    cur, cat,
    method: methodOf(f.method.value),
    date, time: f.time.value,
    note: f.note.value.trim(),
    extra: f.extra.checked,
  };
  Store.upsert('expenses', item);
  if (cur !== 'NZD') lsSet('dt.lastCur', cur);
  lsSet('dt.lastMethod', item.method);
  $('#expDlg').close();
  toast(old ? 'Expense updated' : `Saved ${Money.fmt(Money.usd(item), false)}`);
  const limit = Money.dailyBudget(date);
  const after = before + Money.usd(item);
  if (limit && !item.extra && date === U.today() && after > limit) {
    setTimeout(() => toast(`🛑 Over today's limit by ${Money.fmt(after - limit, false)}.`), 2700);
  }
}

// ---------- Categories ----------

function renderCats() {
  $('#catList').innerHTML = Money.cats().map(c => `<li class="catrow">
    <input data-cat="${U.esc(c.id)}" data-f="emoji" value="${U.esc(c.emoji || '')}" maxlength="4" aria-label="Emoji for ${U.esc(c.name)}">
    <input data-cat="${U.esc(c.id)}" data-f="name" value="${U.esc(c.name)}" maxlength="30" aria-label="Name">
    ${c.id === 'other'
      ? '<span class="catlock" title="Other is always kept">🔒</span>'
      : `<button type="button" class="icon del" data-act="delCat" data-id="${U.esc(c.id)}" aria-label="Delete ${U.esc(c.name)}">×</button>`}
  </li>`).join('');
}

function openCats() {
  const f = $('#catForm');
  f.newEmoji.value = '';
  f.newName.value = '';
  renderCats();
  $('#catDlg').showModal();
}

function renameCat(el) {
  const c = Money.cats().find(x => x.id === el.dataset.cat);
  if (!c) return;
  const v = el.value.trim();
  if (el.dataset.f === 'name' && !v) { el.value = c.name; return toast('A category needs a name.'); }
  Store.upsert('categories', { id: c.id, emoji: c.emoji, name: c.name, createdAt: c.createdAt || 0, [el.dataset.f]: v });
}

function addCat() {
  const f = $('#catForm');
  const name = f.newName.value.trim();
  if (!name) return toast('Type a name for the category.');
  if (Money.cats().some(c => c.name.toLowerCase() === name.toLowerCase())) return toast(`"${name}" already exists.`);
  Store.upsert('categories', { id: U.uid(), emoji: f.newEmoji.value.trim() || '🏷️', name, createdAt: Date.now() });
  f.newEmoji.value = '';
  f.newName.value = '';
  renderCats();
  toast(`Added ${name}`);
}

function delCat(id) {
  const c = Money.cats().find(x => x.id === id);
  if (!c || id === 'other') return;
  const used = Store.list('expenses').filter(e => e.cat === id);
  const msg = used.length
    ? `Delete "${c.name}"? Its ${used.length} expense${used.length === 1 ? '' : 's'} will move to Other.`
    : `Delete "${c.name}"?`;
  if (!confirm(msg)) return;
  for (const e of used) Store.upsert('expenses', { ...e, cat: 'other' });
  // Built-in categories have no stored item yet, so save a delete marker.
  Store.upsert('categories', { id, deleted: true });
  renderCats();
}

// ---------- Calendar ----------

function moneyMonthStats(first, last, spend) {
  const today = U.today();
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  // Average over the days of the month so far (all of it for past months).
  const avg = Money.perDay(total, first, last < today ? last : today);
  const limit = Money.dailyBudget(today) || Object.keys(spend).some(Money.dailyBudget);
  const over = Object.entries(Money.byDay(first, last, true)).filter(([d, v]) => Money.dailyBudget(d) && v > Money.dailyBudget(d)).length;
  const top = Money.byCat(Money.list(first, last))[0];
  return `<div class="card statrow">
      <div><span>Month spent</span><b>${Money.fmt(total, false)}</b></div>
      <div><span>Avg / day</span><b>${Money.fmt(avg, false)}</b></div>
      ${limit ? `<div><span>Days over limit</span><b class="${over ? 'neg' : 'pos'}">${over}</b></div>`
        : `<div><span>Top</span><b class="toptxt">${top ? U.esc(Money.catLabel(top.id)) : '–'}</b></div>`}
    </div>
    ${limit ? `<div class="legend"><span><i class="lg-pos"></i>Within daily limit</span><span><i class="lg-neg"></i>Over daily limit</span></div>` : ''}`;
}

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
  const moneyMode = ui.calMode === 'money';
  const spend = moneyMode ? Money.byDay(first, last) : {};
  const daySpend = moneyMode ? Money.byDay(first, last, true) : {};
  let cells = '';
  for (let i = 0; i < U.weekdayMon(first); i++) cells += '<span class="day blank"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${ui.calMonth}-${String(d).padStart(2, '0')}`;
    const b = byDay[ds];
    const pct = b && b.tasks ? b.done / b.tasks * 100 : NaN;
    const sp = spend[ds] || 0;
    const limit = moneyMode ? Money.dailyBudget(ds) : 0;
    const cls = moneyMode ? (sp > 0 ? (limit ? ((daySpend[ds] || 0) > limit ? 'neg' : 'pos') : 'spent') : '')
      : tasksMode ? (b && b.tasks && (ds < today || pct >= 100) ? 'b-' + Perf.band(pct) : '') : b && b.n ? U.cls(b.pnl) : '';
    const main = moneyMode ? (sp > 0 ? `<span class="dp">${Money.short(sp)}</span>` : '')
      : tasksMode
      ? b && b.tasks ? `<span class="dp">${Math.round(pct)}%</span><span class="dt">${b.done}/${b.tasks}</span>` : ''
      : `${b && b.n ? `<span class="dp">${U.moneyShort(b.pnl)}</span>` : ''}${b && b.tasks ? `<span class="dt${b.done === b.tasks ? ' all' : ''}">${b.done}/${b.tasks}</span>` : ''}`;
    cells += `<button type="button" class="day ${cls}${ds === today ? ' today' : ''}${ds === ui.calDay ? ' sel' : ''}" data-act="calDay" data-v="${ds}">
      <span class="dn">${d}</span>${main}
    </button>`;
  }
  const ms = Perf.summary(first, last);

  const sel = ui.calDay && ui.calDay.startsWith(ui.calMonth) ? ui.calDay : null;
  let detail = '';
  if (sel && moneyMode) {
    const ex = Money.list(sel, sel);
    const t = Money.total(ex);
    detail = `<div class="card">
      <h3 class="dayhead"><span>${U.esc(U.dayLabel(sel))}</span>${ex.length ? `<span class="${Money.dailyBudget(sel) && Money.dayTotal(ex) > Money.dailyBudget(sel) ? 'neg' : ''}">${Money.fmt(t, false)}</span>` : ''}</h3>
      ${ex.length ? `<div class="explist">${ex.map(expRow).join('')}</div>` : '<p class="muted small">No spending.</p>'}
      <button type="button" class="btn ghost block addday" data-act="addExp" data-v="${sel}">+ Add expense for this day</button>
    </div>`;
  } else if (sel) {
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
    ${chips('calMode', ui.calMode, [['pnl', '💵 PnL'], ['tasks', '☑ Activities'], ['money', '💰 Money']])}
    ${tasksMode || moneyMode ? '' : acctChips()}
    ${moneyMode ? moneyMonthStats(first, last, spend) : tasksMode ? `<div class="card statrow">
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
    const p = U.num(t.pnl) || 0;
    const rr = U.calc(t).rr;
    // A key list puts the trade in each group (a trade can have several mistakes).
    for (const k of [].concat(keyFn(t))) {
      const s = (g[k] ||= { n: 0, w: 0, l: 0, pnl: 0, rr: 0, rrn: 0 });
      s.n++; s.pnl += p;
      if (p > 0) s.w++; else if (p < 0) s.l++;
      if (isFinite(rr)) { s.rr += rr; s.rrn++; }
    }
  }
  const keys = order ? [...order.filter(k => g[k]), ...Object.keys(g).filter(k => !order.includes(k))] : Object.keys(g);
  return keys.map(k => ({ k, ...g[k] }));
}

function statTable(title, rows, styleFn, { rr = false, note = '' } = {}) {
  if (!rows.length) return '';
  const best = rows.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  return `<div class="card">
    <h4 class="sub">${title}</h4>
    <table class="tbl">
      <thead><tr><th></th><th>Trades</th><th>Win %</th>${rr ? '<th>Avg RR</th>' : ''}<th>PnL</th></tr></thead>
      <tbody>${rows.map(r => `<tr${rows.length > 1 && r === best && r.pnl > 0 ? ' class="best"' : ''}>
        <td><span class="dot k-${U.esc(String(r.k).replace(/[^A-Za-z0-9]/g, ''))}"${styleFn ? ` style="${styleFn(r.k)}"` : ''}></span>${U.esc(r.k)}${rows.length > 1 && r === best && r.pnl > 0 ? ' ★' : ''}</td><td>${r.n}</td>
        <td>${r.w + r.l ? Math.round(r.w / (r.w + r.l) * 100) + '%' : '–'}</td>
        ${rr ? `<td>${r.rrn ? U.fmtRR(r.rr / r.rrn) : '–'}</td>` : ''}
        <td class="${U.cls(r.pnl)}">${U.money(r.pnl)}</td></tr>`).join('')}</tbody>
    </table>
    ${note ? `<p class="muted small tblnote">${note}</p>` : ''}
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

// ---------- Money stats ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "▲ $5.00 more" / "▼ $5.00 less" / "same"
function moneyDiff(d, what) {
  if (!isFinite(d)) return '';
  if (Math.abs(d) < 0.005) return `<span class="muted">same as ${what}</span>`;
  return `<b class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'} ${Money.fmt(Math.abs(d), false)} ${d > 0 ? 'more' : 'less'}</b> than ${what}`;
}

// 2. This week so far, against last week by the same day and an average week.
function moneyCompare(t) {
  const today = U.today();
  const dayName = U.fmtDate(today, { weekday: 'long' });
  const lastSoFar = Money.soFar(t.last.ws);
  const hasLast = t.last.a || t.last.list.length;
  return `<div class="card mcompare">
    <div class="row"><b>👛 This week so far</b><span class="muted small">${U.esc(Money.weekLabel(t.now.ws))}</span></div>
    <div class="big">${Money.fmt(t.now.spent, false)}</div>
    <p class="small">${hasLast ? `${moneyDiff(t.now.spent - lastSoFar, `last week by ${U.esc(dayName)}`)} <span class="muted">(${Money.fmt(lastSoFar, false)})</span>` : '<span class="muted">Nothing tracked last week to compare with.</span>'}</p>
    <div class="w-stats">
      <div><span>Last week</span><b>${hasLast ? Money.fmt(t.last.spent, false) : '–'}</b></div>
      <div><span>Avg week</span><b>${Money.fmt(t.avg, false)}</b></div>
      <div><span>Week's money</span><b>${t.now.a ? Money.fmtOrig(t.now.a) : '–'}</b></div>
    </div>
  </div>`;
}

// 1. Spent per week with that week's money as a marker.
function moneyWeekChart(t) {
  // Headroom so the week's-money line stays clear of the value labels.
  const top = 1.12 * Math.max(1, ...t.weeks.map(w => Math.max(w.spent, w.a ? w.got : 0)));
  return `<div class="card">
    <h4 class="sub">Spent each week</h4>
    <div class="bars few mbars" role="img" aria-label="Money spent in each of the last 8 weeks">
      ${t.weeks.map(w => {
        const now = w === t.now;
        const over = w.a && w.left < 0;
        const tip = `${Money.weekLabel(w.ws)}: spent ${Money.fmt(w.spent, false)}${w.a ? ` of ${Money.fmtOrig(w.a)} · ${over ? Money.fmt(-w.left, false) + ' over' : Money.fmt(w.left, false) + ' left'}` : ' · no money set'}${now ? ' · this week, in progress' : ''}`;
        return `<button type="button" class="bcol" data-act="barTip" data-tip="${U.esc(tip)}" title="${U.esc(tip)}">
          <span class="bl">${w.spent > 0 ? Money.short(w.spent) : ''}</span>
          <span class="btrack">${w.spent > 0 ? `<i class="${now ? 'm-now' : over ? 'm-over' : 'm-ok'}" style="height:${Math.max(2, w.spent / top * 100)}%"></i>` : ''}${w.a ? `<b class="m-budget" style="bottom:${w.got / top * 100}%"></b>` : ''}</span>
          <span class="bx${now ? ' now' : ''}">${U.fmtDate(w.ws, { day: 'numeric', month: 'short' })}</span></button>`;
      }).join('')}
    </div>
    <div class="legend"><span><i class="m-ok"></i>Within budget</span><span><i class="m-over"></i>Over budget</span><span><i class="m-now"></i>This week</span><span><i class="m-budget"></i>Week's money</span></div>
  </div>`;
}

// 3. Finished weeks in the window.
function moneyTiles(t) {
  const tile = (label, val, cls = '', sub = '') =>
    `<div class="tile"><span>${label}</span><b class="${cls}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const wk = w => U.fmtDate(w.ws, { day: 'numeric', month: 'short' });
  const res = w => (w.a ? (w.left < 0 ? `${Money.fmt(-w.left, false)} over` : `${Money.fmt(w.left, false)} left`) : `${Money.fmt(w.spent, false)} spent`);
  return `<div class="tiles">
    ${tile('Avg week', Money.fmt(t.avg, false), '', `${t.done.length} finished week${t.done.length === 1 ? '' : 's'}`)}
    ${tile('Saved in total', t.budgeted ? Money.fmt(t.saved) : '–', t.budgeted ? U.cls(t.saved) : '', 'left over, all weeks added up')}
    ${tile('Best week', t.best ? wk(t.best) : '–', t.best && t.best.a ? U.cls(t.best.left) : '', t.best ? res(t.best) : '')}
    ${tile('Worst week', t.worst ? wk(t.worst) : '–', t.worst && t.worst.a ? U.cls(t.worst.left) : '', t.worst ? res(t.worst) : '')}
    ${tile('Weeks over budget', t.budgeted ? `${t.over} of ${t.budgeted}` : '–', t.over ? 'neg' : t.budgeted ? 'pos' : '')}
  </div>`;
}

// 4. Each category this week so far, against its usual full week.
function moneyCatCompare(t) {
  const usual = {};
  for (const w of t.done) for (const r of Money.byCat(w.list)) usual[r.id] = (usual[r.id] || 0) + r.usd / t.done.length;
  const now = Object.fromEntries(Money.byCat(t.now.list).map(r => [r.id, r.usd]));
  const ids = [...new Set([...Object.keys(now), ...Object.keys(usual)])]
    .sort((a, b) => (now[b] || 0) - (now[a] || 0) || (usual[b] || 0) - (usual[a] || 0)).slice(0, 8);
  if (!ids.length) return '';
  return `<div class="card catbreak">
    <h4 class="sub">Categories: this week vs usual week</h4>
    ${ids.map(id => {
      const n = now[id] || 0, u = usual[id] || 0;
      const over = u > 0 ? n > u : n > 0 && t.done.length > 0;
      return `<div class="cb-row">
        <div class="row small"><span>${U.esc(Money.catLabel(id))}</span>
          <span><b>${Money.fmt(n, false)}</b> <span class="muted">/ usual ${t.done.length ? Money.fmt(u, false) : '–'}</span></span></div>
        <div class="bar${over ? ' over' : ''}"><i style="width:${u > 0 ? Math.min(100, n / u * 100) : n > 0 ? 100 : 0}%"></i></div>
      </div>`;
    }).join('')}
    <p class="muted small">Usual = average per finished week. Red means you already spent more than usual.</p>
  </div>`;
}

// 5. Average spent on each day of the week.
function moneyWeekdays(t) {
  if (!t.done.length) return '';
  const avg = Money.byWeekday(t.done);
  const top = Math.max(...avg);
  if (!(top > 0)) return '';
  const most = avg.indexOf(top);
  return `<div class="card">
    <h4 class="sub">Average by day of the week</h4>
    <div class="bars few mbars wd" role="img" aria-label="Average spent on each day of the week">
      ${avg.map((v, i) => {
        const tip = `${WEEKDAYS[i]}: ${Money.fmt(v, false)} on average`;
        return `<button type="button" class="bcol" data-act="barTip" data-tip="${U.esc(tip)}" title="${U.esc(tip)}">
          <span class="bl">${i === most ? Money.short(v) : ''}</span>
          <span class="btrack">${v > 0 ? `<i class="m-ok${i === most ? ' m-top' : ''}" style="height:${Math.max(2, v / top * 100)}%"></i>` : ''}</span>
          <span class="bx${i === most ? ' now' : ''}">${WEEKDAYS[i]}</span></button>`;
      }).join('')}
    </div>
    <p class="small">You spend the most on <b>${WEEKDAYS[most]}</b> (${Money.fmt(top, false)} on average).</p>
  </div>`;
}

// 6. Cash / Bank / Card over the whole window.
function moneyMethods(t) {
  const list = t.weeks.flatMap(w => w.list);
  const m = Money.byMethod(list);
  const total = Money.total(list);
  if (!(total > 0)) return '';
  const keys = Object.keys(METHODS).filter(k => m[k] > 0);
  return `<div class="card">
    <h4 class="sub">Paid with</h4>
    <div class="mstack" role="img" aria-label="Share of spending by payment method">
      ${keys.map(k => `<i class="pm-${k}" style="flex:${m[k]}" title="${U.esc(METHODS[k])}"></i>`).join('')}
    </div>
    <ul class="missedlist mlegend">${keys.map(k =>
      `<li><span><i class="pm-${k}"></i>${U.esc(METHODS[k])}</span><b>${Money.fmt(m[k], false)} <span class="muted">${Math.round(m[k] / total * 100)}%</span></b></li>`).join('')}</ul>
  </div>`;
}

function viewMoneyStats() {
  const t = Money.trend(8);
  if (!t.done.length && !t.now.a && !t.now.list.length) {
    return '<p class="empty">No spending yet. Add your week\'s money and expenses in the Money tab, and your weekly stats show up here.</p>';
  }
  return `<p class="muted small">Last 8 weeks, Sunday to Saturday.</p>
    ${moneyCompare(t)}
    ${moneyWeekChart(t)}
    ${moneyTiles(t)}
    ${moneyCatCompare(t)}
    ${moneyWeekdays(t)}
    ${moneyMethods(t)}`;
}

function viewStats() {
  const [from, to] = rangeDates(ui.statsRange, ui.statsFrom, ui.statsTo);
  const sections = chips('statsSection', ui.statsSection, [['trading', '📈 Trading'], ['activities', '☑ Activities'], ['money', '💰 Money']]);
  // Money stats always look at the last 8 weeks, so they skip the range chips.
  if (ui.statsSection === 'money') return `<section class="view">${sections}${viewMoneyStats()}</section>`;
  const head = `${sections}
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
    ${equityCard(from, to)}
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
    ${statTable('By pair', groupStats(trades, t => t.pair, Pairs.all().map(p => p.name)), Pairs.style)}
    ${tagTables(trades)}
    ${statTable('By session', groupStats(trades, t => U.calc(t).session || '–', ['Asia', 'London', 'London/NY overlap', 'New York', 'Off-session']))}
    ${statTable('Buy vs Sell', groupStats(trades, t => t.side, ['Buy', 'Sell']))}
    ${ui.acct === 'all' && Acct.all().length > 1 ? statTable('By account', groupStats(trades, t => Acct.label(Store.get('accounts', t.accountId)))) : ''}
  </section>`;
}

// ---------- Equity curve ----------

let eqPts = []; // points drawn in the Stats curve, for the tap readout

// One account: its balance (with the fail line if funded). All accounts: PnL added up.
function equityPoints(from, to) {
  const a = ui.acct !== 'all' ? Store.get('accounts', ui.acct) : null;
  let pts;
  if (a) {
    pts = Acct.curve(a);
  } else {
    let sum = 0;
    pts = [{ start: true, bal: 0, line: NaN }];
    for (const t of tradesIn('0000-00-00', '9999-12-31').reverse()) {
      sum += U.num(t.pnl) || 0;
      pts.push({ date: t.date, time: t.time, bal: sum, line: NaN, trade: t });
    }
    pts[0].date = pts[1] ? pts[1].date : '';
  }
  // Keep the range, starting from the balance just before it.
  const before = pts.filter(p => !p.start && p.date < from);
  const inside = pts.filter(p => !p.start && p.date >= from && p.date <= to);
  if (!inside.some(p => p.trade)) return { pts: [], a };
  const first = before.length ? { ...before[before.length - 1], trade: null, flow: null, start: true, date: from } : pts[0];
  return { pts: [first, ...inside], a };
}

function eqLabel(p) {
  const when = U.fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short' });
  const what = p.start ? 'Start'
    : p.flow ? `${U.num(p.flow.amount) < 0 ? 'Withdraw' : 'Deposit'} ${U.money(U.num(p.flow.amount))}`
      : `${U.esc(p.trade.pair)} <b class="${U.cls(U.num(p.trade.pnl))}">${U.money(U.num(p.trade.pnl))}</b>`;
  const line = isFinite(p.line) ? ` · fail line ${U.money(p.line, false)}` : '';
  return `${U.esc(when)}${p.time && !p.start && !p.flow ? ' ' + U.esc(p.time) : ''} · ${what}<br>
    <span class="muted">${ui.acct === 'all' ? 'Total PnL' : 'Balance'} <b>${U.money(p.bal, ui.acct === 'all')}</b>${line}</span>`;
}

function equityCard(from, to) {
  const { pts, a } = equityPoints(from, to);
  eqPts = pts;
  if (pts.length < 2) return '';
  const all = !a;
  const W = 300, H = 140;
  const vals = pts.flatMap(p => [p.bal, p.line]).filter(isFinite);
  const target = a && a.type === 'funded' && (Acct.stats(a).status === 'active') ? Acct.amount(a.target, U.num(a.startBalance) || 0) : NaN;
  const targetBal = isFinite(target) ? (U.num(a.startBalance) || 0) + target : NaN;
  if (isFinite(targetBal)) vals.push(targetBal);
  if (all) vals.push(0);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  lo -= pad; hi += pad;
  const x = i => (i / (pts.length - 1)) * W;
  const y = v => H - ((v - lo) / (hi - lo)) * H;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.bal).toFixed(1)}`).join('');
  for (const p of pts) p.top = y(p.bal) / H * 100;
  const area = `${path}L${W},${H}L0,${H}Z`;
  // Fail line as steps, since it only moves when a trade lands.
  const failPts = pts.map((p, i) => [i, p.line]).filter(([, v]) => isFinite(v));
  const fail = failPts.length
    ? failPts.map(([i, v], k) => `${k ? `L${x(i).toFixed(1)},${y(failPts[k - 1][1]).toFixed(1)}L` : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + `L${W},${y(failPts[failPts.length - 1][1]).toFixed(1)}`
    : '';
  const hline = (v, cls) => isFinite(v) ? `<path class="${cls}" d="M0,${y(v).toFixed(1)}H${W}"/>` : '';

  const s = pts[0].bal, e = pts[pts.length - 1].bal;
  let peak = -Infinity, dd = 0, cash = 0;
  for (const p of pts) {
    if (p.flow && !p.start) cash += U.num(p.flow.amount) || 0;
    const v = p.bal - cash; // trading result only
    peak = Math.max(peak, v); dd = Math.min(dd, v - peak);
  }
  // Deposits and withdrawals move the balance but aren't profit.
  const flows = pts.slice(1).reduce((sum, p) => sum + (p.flow ? U.num(p.flow.amount) || 0 : 0), 0);
  const change = e - s - flows;
  const pct = !all && s > 0 ? ` (${change >= 0 ? '+' : '−'}${Math.abs(change / s * 100).toFixed(1)}%)` : '';
  const up = change >= 0 ? 'up' : 'down';
  const last = pts.length - 1;

  return `<div class="card eq">
    <div class="eq-head">
      <h4 class="sub">${all ? 'PnL curve · all accounts' : `Balance · ${U.esc(Acct.label(a))}`}</h4>
      <div class="eq-sum"><b>${U.money(s, all)} → ${U.money(e, all)}</b> <span class="${U.cls(change)}">${U.money(change)}${pct}</span></div>
      <div class="muted small">Max drawdown <b class="${dd < 0 ? 'neg' : ''}">${dd < 0 ? U.money(dd) : '$0.00'}</b>${flows ? ` · ${flows > 0 ? 'deposits' : 'withdrawals'} ${U.money(flows)}` : ''}${isFinite(pts[last].line) ? ` · ${U.money(e - pts[last].line, false)} above the fail line` : ''}</div>
    </div>
    <div class="eq-plot" data-n="${pts.length}" role="img" aria-label="Balance chart. Drag across it to see each trade.">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="eq-area ${up}" d="${area}"/>
        ${all ? hline(0, 'eq-zero') : hline(s, 'eq-zero')}
        ${hline(targetBal, 'eq-target')}
        ${fail ? `<path class="eq-fail" d="${fail}"/>` : ''}
        <path class="eq-line ${up}" d="${path}"/>
      </svg>
      <i class="eq-dot ${up}" style="left:100%;top:${pts[last].top.toFixed(2)}%"></i>
    </div>
    <div class="eq-axis muted small"><span>${U.esc(U.fmtDate(pts[0].date, { day: 'numeric', month: 'short' }))}</span><span>${U.esc(U.fmtDate(pts[last].date, { day: 'numeric', month: 'short' }))}</span></div>
    <p class="eq-read small">${eqLabel(pts[last])}</p>
    ${fail || isFinite(targetBal) ? `<div class="legend">${fail ? '<span><i class="lg-fail"></i>Fail line</span>' : ''}${isFinite(targetBal) ? '<span><i class="lg-target"></i>Profit target</span>' : ''}</div>` : ''}
  </div>`;
}

// Drag or tap across the curve to read each point.
function eqScrub(e) {
  const plot = e.target.closest('.eq-plot');
  if (!plot || !eqPts.length) return;
  const r = plot.getBoundingClientRect();
  const n = eqPts.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
  const dot = plot.querySelector('.eq-dot');
  dot.style.left = (i / (n - 1) * 100) + '%';
  dot.style.top = eqPts[i].top + '%';
  plot.closest('.eq').querySelector('.eq-read').innerHTML = eqLabel(eqPts[i]);
}

// By setup, and what each mistake cost. Shown once trades in the range have tags.
function tagTables(trades) {
  const NONE = 'No setup', CLEAN = 'Clean trades ✓';
  let out = '';
  if (trades.some(t => Tags.setup(t))) {
    out += statTable('By setup', groupStats(trades, t => Tags.name(Tags.setup(t)) || NONE,
      [...Tags.all('setup').map(t => t.name), NONE]), null, { rr: true });
  }
  if (trades.some(t => Tags.mistakes(t).length)) {
    const rows = groupStats(trades, t => Tags.mistakes(t).length ? Tags.mistakes(t).map(Tags.name) : CLEAN,
      [CLEAN, ...Tags.all('mistake').map(t => t.name)]);
    const withMis = sumPnl(trades.filter(t => Tags.mistakes(t).length));
    out += statTable('Mistakes', rows, null, {
      note: `Clean trades have no mistake tagged. A trade with two mistakes counts in both rows. All trades with a mistake: <b class="${U.cls(withMis)}">${U.money(withMis)}</b>.`,
    });
  }
  return out;
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
    }).join('')}</ul>` : ''}
    ${reviewSpending(from)}`;
}

// Spending weeks run Sunday to Saturday, so use the one that holds `from`
// (for last week's review that's the most recent finished spending week).
function reviewSpending(from) {
  const ws = Money.weekStart(from);
  const w = Money.week(ws);
  const list = w.list;
  if (!list.length && !w.a) return '';
  const total = w.spent;
  const cats = Money.byCat(list);
  const m = Money.byMethod(list);
  const limit = Money.dailyBudget(ws);
  const over = limit ? Object.values(Money.byDay(ws, U.addDays(ws, 6), true)).filter(v => v > limit).length : 0;
  return `<h3 class="sub spend">💰 Spending</h3>
    <p class="muted small">${U.esc(Money.weekLabel(ws))}</p>
    <div class="tiles">
      ${w.a ? `<div class="tile"><span>${w.left < 0 ? 'Over budget' : 'Left over'}</span><b class="${U.cls(w.left)}">${Money.fmt(Math.abs(w.left), false)}</b><small>of ${Money.fmtOrig(w.a)}</small></div>` : ''}
      <div class="tile"><span>Spent</span><b>${Money.fmt(total, false)}</b>${Money.nz() ? '' : `<small>≈ ${Money.fmtKHR(total * KHR_PER_USD)}</small>`}</div>
      <div class="tile"><span>Avg / day</span><b>${Money.fmt(total / 7, false)}</b>${limit ? `<small>${over} day${over === 1 ? '' : 's'} over limit</small>` : ''}</div>
      ${total > 0 ? `<div class="tile"><span>Paid with</span><b class="small">${U.esc(Money.methodLine(m))}</b></div>` : ''}
    </div>
    <ul class="missedlist">${cats.slice(0, 3).map(c =>
      `<li><span>${U.esc(Money.catLabel(c.id))}</span><b>${Money.fmt(c.usd, false)}</b></li>`).join('')}</ul>`;
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
    Store.list('trades').some(t => t.date >= from && t.date <= to) ||
    Store.list('expenses').some(e => e.date >= from && e.date <= to) ||
    Store.list('allowances').some(a => a.id >= U.addDays(from, -1) && a.id <= to);
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
  f.moneyCur.value = Money.nz() ? 'nzd' : 'usd';
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

const VIEWS = { plan: viewPlan, trades: viewTrades, money: viewMoney, calendar: viewCalendar, stats: viewStats };

function render() {
  if (!VIEWS[ui.tab]) ui.tab = 'plan';
  if (ui.acct !== 'all' && !Store.get('accounts', ui.acct)) ui.acct = 'all';
  if (ui.acct !== 'all' && Store.get('accounts', ui.acct).deleted) ui.acct = 'all';
  fillRoutines();
  const draft = $('#taskInput') ? $('#taskInput').value : '';
  const hadFocus = document.activeElement && document.activeElement.id === 'taskInput';
  const editDraft = $('#editInput') && $('#editInput').closest('form').dataset.id === ui.editing ? $('#editInput').value : null;
  $('#view').innerHTML = VIEWS[ui.tab]();
  document.body.dataset.tab = ui.tab;
  for (const b of $$('.tabbar button')) b.classList.toggle('on', b.dataset.v === ui.tab);
  renderHeader();
  const ti = $('#taskInput');
  if (ti && draft) { ti.value = draft; if (hadFocus) ti.focus(); }
  const ei = $('#editInput');
  if (ei) {
    if (editDraft !== null) ei.value = editDraft;
    ei.focus();
    ei.setSelectionRange(ei.value.length, ei.value.length);
  }
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
    if (!t) return;
    const msg = t.routine && Store.get('routines', t.routine) && !Store.get('routines', t.routine).deleted
      ? `Remove "${t.text}" from this day only?

It will still come back on other days. To stop it for good, tap ⚙ Manage in the Daily section.`
      : `Delete "${t.text}"?`;
    if (confirm(msg)) Store.remove('tasks', t.id);
  },
  editTask(el) { ui.editing = el.dataset.id; render(); },
  cancelEdit() { ui.editing = null; render(); },
  clearTask() { const i = $('#taskInput'); i.value = ''; i.focus(); },
  toggleDone() { ui.doneOpen = !ui.doneOpen; render(); },
  toggleMissed() { ui.missedOpen = !ui.missedOpen; render(); },
  toggleManage() { ui.manageOpen = !ui.manageOpen; render(); },
  stopDaily(el) {
    const r = Store.get('routines', el.dataset.id);
    if (!r || !confirm(`Stop adding "${r.text}" every day?

Past days and today stay as they are.`)) return;
    const today = U.today();
    // Drop copies already put on later days that weren't ticked yet.
    for (const t of Store.list('tasks')) {
      if (t.routine === r.id && t.date > today && !t.done) Store.remove('tasks', t.id);
    }
    Store.remove('routines', r.id);
    toast('Stopped');
  },
  dailyDays(el) {
    const r = Store.get('routines', el.dataset.id);
    if (!r || r.deleted) return;
    const today = U.today();
    const weekdays = r.days !== 'weekdays';
    Store.upsert('routines', { ...r, days: weekdays ? 'weekdays' : 'all' });
    if (weekdays) {
      // Drop unticked weekend copies from today on.
      for (const t of Store.list('tasks')) {
        if (t.routine === r.id && t.date >= today && !t.done && isWeekend(t.date)) Store.remove('tasks', t.id);
      }
    } else {
      // Bring back weekend copies removed by the switch, on the days being shown.
      for (const d of new Set([today, ui.planDate])) {
        const id = routineTaskId(r.id, d);
        const t = Store.get('tasks', id);
        if (d >= today && d >= r.start && isWeekend(d) && t && t.deleted) {
          Store.upsert('tasks', { id, text: r.text, date: d, done: false, routine: r.id, createdAt: r.createdAt });
        }
      }
    }
    toast(weekdays ? 'Now Mon–Fri only' : 'Now every day');
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
  moneyRange(el) { ui.moneyRange = el.dataset.v; render(); },
  addExp(el) { openExpForm(null, el.dataset.v); },
  openExp(el) { openExpForm(el.dataset.id); },
  delExp() {
    if (eform.id && confirm('Delete this expense?')) {
      Store.remove('expenses', eform.id);
      $('#expDlg').close();
      toast('Expense deleted');
    }
  },
  manageCats() { openCats(); },
  managePairs() { openPairs(); },
  addPair() { addPair(); },
  hidePair(el) { setPairHidden(el.dataset.id, true); },
  showPair(el) { setPairHidden(el.dataset.id, false); },
  delPair(el) { delPair(el.dataset.id); },
  manageTags() { openTags(); },
  addTag(el) { addTag(el.dataset.v); },
  hideTag(el) { setTagHidden(el.dataset.id, true); },
  showTag(el) { setTagHidden(el.dataset.id, false); },
  delTag(el) { delTag(el.dataset.id); },
  setAllow(el) { openAllow(el.dataset.v); },
  delAllow() {
    if (!confirm("Remove this week's money?")) return;
    Store.remove('allowances', aw.ws);
    $('#allowDlg').close();
    toast("Week's money removed");
  },
  openWeek(el) { openWeek(el.dataset.v); },
  histAll() { ui.histAll = !ui.histAll; render(); },
  walletShift(el) { ui.walletWs = U.addDays(walletWeek(), 7 * el.dataset.v); render(); },
  walletNow() { ui.walletWs = null; render(); },
  addCat() { addCat(); },
  delCat(el) { delCat(el.dataset.id); },
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
    if (t) {
      Store.upsert('tasks', { ...t, done: el.checked, doneAt: el.checked ? Date.now() : null });
      const day = tasksOn(t.date);
      if (el.checked && t.date === ui.planDate && ui.tab === 'plan' && day.every(x => x.done)) celebrate();
    }
  } else if (el.id === 'taskDaily') {
    ui.dailyOn = el.checked;
    $('#taskInput').placeholder = el.checked ? 'Add a daily activity…' : 'Add an activity…';
    $('#taskInput').focus();
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
  } else if (el.name === 'moneyCur') {
    lsSet('dt.moneyCur', el.value); render();
    toast(el.value === 'nzd' ? 'Money now in NZ$' : 'Money now in US$ + riel');
  } else if (el.dataset.pair) {
    editPair(el);
  } else if (el.dataset.cat) {
    renameCat(el);
  } else if (el.dataset.tag) {
    renameTag(el);
  } else if (el.name === 'setup') {
    // One setup per trade: picking one clears the others.
    if (el.checked) for (const x of $$('#setupPick input')) if (x !== el) x.checked = false;
  } else if (el.closest('#expForm')) {
    expHint();
  } else if (el.closest('#allowForm')) {
    allowHint();
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
  else if (e.target.closest('#expForm')) expHint();
  else if (e.target.closest('#allowForm')) allowHint();
});

document.addEventListener('submit', e => {
  if (e.target.id === 'taskForm') {
    e.preventDefault();
    const input = $('#taskInput');
    const text = input.value.trim();
    if (!text) return;
    if ($('#taskDaily').checked) {
      // New daily activities run Mon–Fri; added on a weekend, they start Monday.
      let start = ui.planDate;
      while (isWeekend(start)) start = U.addDays(start, 1);
      const r = Store.upsert('routines', { id: U.uid(), text, start, days: 'weekdays', createdAt: Date.now() });
      if (start === ui.planDate) {
        Store.upsert('tasks', { id: routineTaskId(r.id, start), text, date: start, done: false, routine: r.id, createdAt: r.createdAt });
      }
      ui.dailyOn = false;
      toast(start === ui.planDate ? 'Added. It will show up Mon–Fri.' : 'Added. It starts Monday and shows up Mon–Fri.');
    } else {
      Store.upsert('tasks', { id: U.uid(), text, date: ui.planDate, done: false, createdAt: Date.now() });
    }
    input.value = '';
    $('#taskInput').focus();
  } else if (e.target.classList.contains('editrow')) {
    e.preventDefault();
    saveEdit(e.target.dataset.id, $('#editInput').value.trim());
  } else if (e.target.id === 'tradeForm') {
    e.preventDefault();
    saveTrade();
  } else if (e.target.id === 'acctForm') {
    e.preventDefault();
    saveAcct();
  } else if (e.target.id === 'expForm') {
    e.preventDefault();
    saveExp();
  } else if (e.target.id === 'allowForm') {
    e.preventDefault();
    saveAllow();
  } else if (e.target.id === 'catForm' || e.target.id === 'pairForm' || e.target.id === 'tagForm' || e.target.id === 'settingsForm') {
    e.preventDefault();
  }
});

// Enter in the "new category" boxes adds it; in a rename box it saves the field.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && e.target.id === 'editInput') { ui.editing = null; render(); }
});

$('#catForm').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  if (e.target.name === 'newName' || e.target.name === 'newEmoji') addCat();
  else e.target.blur();
});

// Enter in the "new pair" boxes adds it; in an edit box it saves the field.
$('#pairForm').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  if (e.target.name === 'newName' || e.target.name === 'newValue') addPair();
  else e.target.blur();
});

document.addEventListener('pointerdown', eqScrub);
document.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') eqScrub(e); });

// Enter in a "new tag" box adds it; in a rename box it saves the name.
$('#tagForm').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  if (e.target.name === 'newSetup') addTag('setup');
  else if (e.target.name === 'newMistake') addTag('mistake');
  else e.target.blur();
});

// Tags edited from inside the trade form show up there right away.
$('#tagDlg').addEventListener('close', () => {
  if ($('#tradeDlg').open) { const t = formTags(); renderTagPick(t.setup, t.mistakes); }
});

// The page isn't rebuilt under an open trade form, so catch up when it closes.
$('#tradeDlg').addEventListener('close', () => render());

// Pairs edited from inside the trade form show up there right away.
$('#pairDlg').addEventListener('close', () => {
  if ($('#tradeDlg').open) { renderPairPick(formPair()); updatePreview(); }
});

// Categories edited from inside the expense form show up there right away.
$('#catDlg').addEventListener('close', () => {
  if ($('#expDlg').open) renderCatPick(($('#catPick input:checked') || {}).value);
});

// Tap outside a dialog closes it.
for (const d of $$('dialog')) {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}

Store.on(() => {
  // Don't rebuild the page under an open trade form; just refresh the header
  // and the pair buttons (pairs can be edited from inside the form).
  if ($('#tradeDlg').open) { renderHeader(); renderPairPick(formPair()); } else render();
  if ($('#settingsDlg').open) renderSyncInfo();
  if ($('#weekDlg').open) renderWeek(ui.weekOpen);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    Store.syncNow();
  }
});

// ---------- Start ----------

// The Plan add bar sits on top of the tab bar, so keep its height handy for CSS.
function measureTabbar() {
  document.documentElement.style.setProperty('--tabbar-h', $('.tabbar').offsetHeight + 'px');
}
measureTabbar();
addEventListener('resize', measureTabbar);

applyTheme(lsGet('dt.theme', 'dark'));
Store.load();
render();
maybeShowReview();
Store.syncNow().then(maybeShowReview);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
