// Song Craft / Film Craft front end: drag blocks onto each other to combine them and work toward a
// target song or film. The current game mode (music, film, ...) is sent with every API request.
'use strict';

// ------------------------------------------------------------------ helpers

const $ = (id) => document.getElementById(id);

const api = {
  async get(path) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(state.game ? `${path}${sep}mode=${encodeURIComponent(state.game.id)}` : path);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: state.game?.id, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

// localStorage can be unavailable (private mode etc.), so never let it crash the game.
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('songcraft.' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('songcraft.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

// Music keeps the original storage keys so earlier progress isn't lost; other modes get their own.
const modeKey = (key) => (!state.game || state.game.id === 'music' ? key : `${key}.${state.game.id}`);

// Simple event hooks so extras.js (recipe book, achievements, rush, suggestions) can react to the game.
// Events: combine, discover, win, reset, gameChanged, levelsShown, mpHost, mpWin
const hooks = {
  handlers: {},
  on(event, fn) { (this.handlers[event] ||= []).push(fn); },
  emit(event, data) {
    for (const fn of this.handlers[event] || []) {
      try { fn(data); } catch (err) { console.error(`hook ${event} failed`, err); }
    }
  },
};

const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

let toastTimer;
function toast(message, ms = 2200) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ sound effects (Web Audio, no files)

const sfx = (() => {
  let ctx = null;
  let muted = store.get('muted', false);
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // pentatonic

  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type = 'triangle', vol = 0.15) {
    if (muted) return;
    try {
      const c = audio();
      const t = c.currentTime + start;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch { /* audio not supported */ }
  }
  // Every element gets its own note, based on its name.
  function noteFor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return scale[h % scale.length];
  }
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('muted', muted); return muted; },
    pick: (name) => tone(noteFor(name) * 2, 0, 0.08, 'sine', 0.05),
    // a soft wooden 'thock' when a block lands on the board
    place: () => { tone(190, 0, 0.09, 'sine', 0.16); tone(380, 0.012, 0.06, 'triangle', 0.05); },
    beep: (high) => tone(high ? 880 : 440, 0, high ? 0.35 : 0.15, 'square', 0.07),
    combine: (name) => { const f = noteFor(name); tone(f, 0, 0.25); tone(f * 1.5, 0.08, 0.3); },
    discover: (name) => { const f = noteFor(name); [1, 1.25, 1.5, 2].forEach((m, i) => tone(f * m, i * 0.07, 0.4)); },
    fail: () => { tone(150, 0, 0.18, 'sawtooth', 0.05); tone(110, 0.1, 0.22, 'sawtooth', 0.05); },
    win: () => {
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
        .forEach((f, i) => tone(f, i * 0.13, i === 5 ? 0.9 : 0.25, 'square', 0.07));
    },
  };
})();

// ------------------------------------------------------------------ game state

const state = {
  mode: null,          // 'level', 'daily' or 'free'
  daily: null,         // today's challenge: {day, target, par, moveLimit}
  failed: false,       // ran out of moves in the daily challenge
  playerMode: 'single', // title screen choice: 'single' or 'multi'
  mp: null,            // multiplayer: {code, player, lobby, round, ...}
  mpLocked: false,     // true during the race countdown / after the race ends
  hints: 0,            // hints used in the current game
  rush: null,          // rush mode: {score, endAt, done, hints}
  game: null,          // the game mode: {id: 'music' | 'film', name, emoji, noun}
  modes: [],           // all game modes
  target: null,        // the song/film we're aiming for (level mode)
  targets: [],         // all targets in this game mode, sorted by difficulty
  starters: [],
  inventory: [],       // discovered elements, in discovery order: {name, emoji}
  newNames: new Set(), // shown with a NEW badge
  moves: 0,
  startTime: 0,
  elapsed: 0,
  timerId: null,
  won: false,
  scoreSubmitted: false, // only one leaderboard entry per win
  sort: ['newest', 'oldest', 'az', 'za'].includes(store.get('sort')) ? store.get('sort') : 'newest',
  totalElements: 0,
};

const board = $('board');
const itemsEl = $('items');
const sidebar = $('sidebar');

function has(name) {
  return state.inventory.some((e) => e.name === name);
}

// ------------------------------------------------------------------ sidebar (discoveries)

function makeChip(element) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.dataset.name = element.name;
  chip.dataset.emoji = element.emoji;
  const e = document.createElement('span');
  e.className = 'e';
  e.textContent = element.emoji;
  const n = document.createElement('span');
  n.textContent = element.name;
  chip.append(e, n);
  return chip;
}

function renderItems() {
  const q = $('search').value.trim().toLowerCase();
  let list = state.inventory.filter((e) => e.name.toLowerCase().includes(q));
  // state.inventory is already in discovery order (oldest first)
  if (state.sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'za') list.sort((a, b) => b.name.localeCompare(a.name));
  else if (state.sort === 'newest') list.reverse();

  itemsEl.replaceChildren(...list.map((el) => {
    const chip = makeChip(el);
    if (state.newNames.has(el.name)) chip.classList.add('new-item');
    if (state.target && el.name === state.target.name) chip.classList.add('target-item');
    chip.addEventListener('pointerdown', (ev) => startDrag(ev, el, null));
    return chip;
  }));

  const total = state.totalElements ? ` / ${state.totalElements}` : '';
  $('discoveredCount').textContent = `${state.inventory.length}${total} discovered`;
}

function discover(element, from = null) {
  if (has(element.name)) return false;
  hooks.emit('discover', { element, from });
  state.inventory.push(element);
  state.newNames.add(element.name);
  if (state.mode === 'free') store.set(modeKey('freeInventory'), state.inventory);
  renderItems();
  return true;
}

// ------------------------------------------------------------------ board (crafting area)

function boardChips() {
  return [...board.querySelectorAll('.chip')];
}

function updateBoardHelp() {
  board.classList.toggle('has-items', boardChips().length > 0);
}

function placeChip(chip, x, y) {
  const maxX = Math.max(0, board.clientWidth - chip.offsetWidth - 4);
  const maxY = Math.max(0, board.clientHeight - chip.offsetHeight - 4);
  chip.style.left = Math.min(Math.max(4, x), maxX) + 'px';
  chip.style.top = Math.min(Math.max(4, y), maxY) + 'px';
}

function addToBoard(element, x, y, animate = false) {
  const chip = makeChip(element);
  board.appendChild(chip);
  placeChip(chip, x, y);
  if (animate) chip.classList.add('pop');
  chip.addEventListener('pointerdown', (ev) => startDrag(ev, element, chip));
  chip.addEventListener('dblclick', () => {
    addToBoard(element, chip.offsetLeft + 24, chip.offsetTop + 24, true);
    sfx.place();
  });
  updateBoardHelp();
  return chip;
}

function addToBoardSomewhere(element) {
  const w = board.clientWidth, h = board.clientHeight;
  const x = w * 0.2 + Math.random() * w * 0.5;
  const y = h * 0.2 + Math.random() * h * 0.55;
  addToBoard(element, x, y, true);
}

function clearBoard() {
  boardChips().forEach((c) => c.remove());
  updateBoardHelp();
}

// ------------------------------------------------------------------ dragging

let drag = null;

function startDrag(ev, element, boardChip) {
  if (ev.button !== undefined && ev.button !== 0) return;
  if (boardChip && boardChip.classList.contains('pending')) return;
  ev.preventDefault();
  drag = {
    element,
    chip: boardChip,        // null until a sidebar drag actually moves
    fromSidebar: !boardChip,
    startX: ev.clientX,
    startY: ev.clientY,
    offsetX: 0,
    offsetY: 0,
    moved: false,
    dropTarget: null,
  };
  if (boardChip) {
    const r = boardChip.getBoundingClientRect();
    drag.offsetX = ev.clientX - r.left;
    drag.offsetY = ev.clientY - r.top;
    boardChip.classList.add('dragging');
    board.appendChild(boardChip); // bring to front
  }
}

function overlapTarget(chip) {
  const a = chip.getBoundingClientRect();
  let best = null, bestArea = 0;
  for (const other of boardChips()) {
    if (other === chip || other.classList.contains('pending')) continue;
    const b = other.getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 0 && h > 0 && w * h > bestArea) { best = other; bestArea = w * h; }
  }
  return best;
}

function pointerOver(el, ev) {
  const r = el.getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

window.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 5) return;

  if (!drag.moved) {
    drag.moved = true;
    if (drag.fromSidebar) {
      drag.chip = addToBoard(drag.element, -999, -999);
      drag.chip.classList.add('dragging');
      drag.offsetX = drag.chip.offsetWidth / 2;
      drag.offsetY = drag.chip.offsetHeight / 2;
      sfx.pick(drag.element.name);
    }
  }

  const br = board.getBoundingClientRect();
  drag.chip.style.left = (ev.clientX - br.left - drag.offsetX) + 'px';
  drag.chip.style.top = (ev.clientY - br.top - drag.offsetY) + 'px';

  const target = overlapTarget(drag.chip);
  if (target !== drag.dropTarget) {
    drag.dropTarget?.classList.remove('drop-target');
    target?.classList.add('drop-target');
    drag.dropTarget = target;
  }
  sidebar.classList.toggle('drop-remove', !drag.fromSidebar && pointerOver(sidebar, ev));
});

window.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  sidebar.classList.remove('drop-remove');
  d.dropTarget?.classList.remove('drop-target');

  if (!d.moved) {
    d.chip?.classList.remove('dragging');
    if (d.fromSidebar) { addToBoardSomewhere(d.element); sfx.place(); }
    return;
  }

  d.chip.classList.remove('dragging');
  if (!pointerOver(board, ev)) {         // dropped on the sidebar / outside: remove it
    d.chip.remove();
    updateBoardHelp();
    return;
  }
  placeChip(d.chip, d.chip.offsetLeft, d.chip.offsetTop);
  if (d.dropTarget && d.dropTarget.isConnected) combine(d.chip, d.dropTarget);
  else sfx.place();
});

window.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag.chip?.classList.remove('dragging');
  if (drag.fromSidebar && drag.chip) { drag.chip.remove(); updateBoardHelp(); }
  drag.dropTarget?.classList.remove('drop-target');
  drag = null;
});

// ------------------------------------------------------------------ combining

async function combine(chipA, chipB) {
  const a = chipA.dataset.name;
  const b = chipB.dataset.name;
  if (state.failed) return;
  if (state.mode === 'mp' && state.mpLocked) { toast(state.won ? 'The race is over!' : 'Wait for GO!'); return; }
  chipA.classList.add('pending');
  chipB.classList.add('pending');

  let result, raceOver = false;
  try {
    if (state.mode === 'mp') {
      const res = await api.post('/api/mp/combine', { code: state.mp.code, player: state.mp.player, a, b });
      result = res.result;
      raceOver = res.finished;
    } else {
      result = (await api.post('/api/combine', { a, b })).result;
    }
  } catch (e) {
    chipA.classList.remove('pending');
    chipB.classList.remove('pending');
    toast(state.mode === 'mp' ? '⚠️ ' + e.message : "⚠️ Can't reach the server. Is it running?");
    return;
  }

  if (isTimed() && !state.won) { state.moves++; updateStats(); }
  hooks.emit('combine', { a, b, result, chipA, chipB });

  if (!result) {
    for (const c of [chipA, chipB]) {
      c.classList.remove('pending');
      c.classList.remove('shake');
      void c.offsetWidth; // restart the animation
      c.classList.add('shake');
      // flash red, then fade back to normal (the fade is in the CSS animation)
      clearTimeout(c.shakeTimer);
      c.shakeTimer = setTimeout(() => c.classList.remove('shake'), 1700);
    }
    sfx.fail();
    toast(`${chipA.dataset.emoji} ${a} + ${chipB.dataset.emoji} ${b} don't make anything`, 1600);
    checkOutOfMoves();
    return;
  }

  const x = chipB.offsetLeft, y = chipB.offsetTop;
  const stillOnBoard = chipA.isConnected && chipB.isConnected;
  chipA.remove();
  chipB.remove();
  const newChip = stillOnBoard ? addToBoard(result, x, y, true) : null;
  updateBoardHelp();

  const isNew = discover(result, [a, b]);
  if (isNew) {
    sfx.discover(result.name);
    if (newChip) burst(newChip);
    toast(`✨ New discovery: ${result.emoji} ${result.name}`);
  } else {
    sfx.combine(result.name);
  }

  if (state.mode === 'mp') {
    if (raceOver) pollMp(); // the server decides the winner; fetch the result straight away
  } else if (state.mode === 'rush') {
    rushCheck(result, newChip);
  } else if (isTimed() && !state.won && result.name === state.target.name) {
    win();
  } else {
    checkOutOfMoves();
  }
}

/** Translucent white pixels that pop out where a new discovery was made. */
function burst(chip) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cx = chip.offsetLeft + chip.offsetWidth / 2;
  const cy = chip.offsetTop + chip.offsetHeight / 2;
  for (let i = 0; i < 18; i++) {
    const spark = document.createElement('i');
    spark.className = 'spark';
    const size = Math.round(4 + Math.random() * 6);
    spark.style.width = spark.style.height = size + 'px';
    spark.style.left = cx - size / 2 + 'px';
    spark.style.top = cy - size / 2 + 'px';
    board.appendChild(spark);
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 18;
    const anim = spark.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 0.9 },
      { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0 },
    ], { duration: 550 + Math.random() * 350, easing: 'cubic-bezier(.15,.8,.3,1)' });
    anim.onfinish = () => spark.remove();
  }
}

// ------------------------------------------------------------------ game modes (music, film, ...)

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (noun) => (noun.endsWith('s') ? noun : noun + 's');

function renderModeTabs() {
  const tabs = $('modeTabs');
  tabs.hidden = state.modes.length < 2;
  tabs.replaceChildren(...state.modes.map((m) => {
    const b = document.createElement('button');
    b.className = 'mode-tab' + (state.game?.id === m.id ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.game?.id === m.id));
    b.textContent = `${m.emoji} ${m.name}`;
    b.addEventListener('click', async () => {
      try {
        await switchGame(m.id);
        renderLevels();
        refreshDaily();
      } catch {
        toast("⚠️ Couldn't load that mode. Is the server running?");
      }
    });
    return b;
  }));
}

/** Loads a game mode's starters and targets, and relabels the page for it. */
async function switchGame(id) {
  const game = state.modes.find((m) => m.id === id) || state.modes[0];
  if (state.game?.id === game.id && state.targets.length) return;

  const previous = state.game;
  state.game = game; // api.get/post send this mode
  let data;
  try {
    data = await Promise.all([api.get('/api/starters'), api.get('/api/targets'), api.get('/api/stats')]);
  } catch (e) {
    state.game = previous;
    throw e;
  }
  const [{ elements }, { targets }, stats] = data;
  state.starters = elements;
  state.targets = targets.sort((a, b) => a.par - b.par);
  state.totalElements = stats.totalElements;
  store.set('game', game.id);

  // A game in progress belongs to the old mode, so end it.
  if (state.mode) {
    const pickerOpen = !$('levelModal').hidden;
    resetCommon();
    state.mode = null;
    state.target = null;
    state.inventory = [];
    $('goal').hidden = true;
    $('stats').hidden = true;
    $('hintBtn').hidden = true;
    renderItems();
    $('levelModal').hidden = !pickerOpen;
  }

  const noun = game.noun;
  document.documentElement.dataset.game = game.id;
  document.title = `${capital(noun)} Craft`;
  const craft = document.createElement('span');
  craft.textContent = 'Craft';
  $('logo').replaceChildren(`${game.emoji} ${capital(noun)}`, craft);
  $('levelsBtn').textContent = `${game.emoji} ${capital(plural(noun))}`;
  $('levelTitle').textContent = `Pick a ${noun} to craft ${game.emoji}`;
  $('levelSub').textContent =
    `Start with ${state.starters.length} building blocks. Combine them until you make the ${noun}. Fewer moves is better.`;
  $('nextSongBtn').textContent = `Next ${noun} ▶`;
  renderModeTabs();
  updateGameArt();
  hooks.emit('gameChanged', game);
}

// ------------------------------------------------------------------ title screen + pixel art

const gameTheme = () => PIXEL_THEMES[state.game?.id] || PIXEL_THEMES.default;

const BOARD_DECO_SPOTS = [
  { top: '10%', left: '5%', transform: 'rotate(-8deg)' },
  { top: '14%', right: '6%', transform: 'rotate(10deg)' },
  { bottom: '24%', left: '9%', transform: 'rotate(6deg)' },
  { bottom: '20%', right: '9%', transform: 'rotate(-6deg)' },
];

/** Bouncing 8-bit equalizer bars, each with its own speed and height. */
function makeEqBars(count) {
  return Array.from({ length: count }, () => {
    const bar = document.createElement('i');
    bar.className = 'eq-bar';
    bar.style.setProperty('--d', (0.5 + Math.random() * 0.9).toFixed(2) + 's');
    bar.style.setProperty('--delay', (-Math.random() * 2).toFixed(2) + 's');
    bar.style.setProperty('--h', (0.35 + Math.random() * 0.65).toFixed(2));
    return bar;
  });
}

/** Redraws the title screen, board decorations and picker art for the current game mode. */
function updateGameArt() {
  const theme = gameTheme();
  const noun = state.game.noun;

  // Title screen
  $('titleArt').replaceChildren(...theme.title.map((name) => {
    const wrap = document.createElement('span');
    wrap.className = 'bob';
    wrap.append(pixelSprite(name, name === theme.hero ? 7 : 4, 'outlined'));
    return wrap;
  }));
  const t1 = document.createElement('span');
  t1.className = 't1';
  t1.textContent = noun.toUpperCase();
  const t2 = document.createElement('span');
  t2.className = 't2';
  t2.textContent = 'CRAFT';
  $('titleLogo').replaceChildren(t1, t2);
  $('titleTag').textContent = theme.tagline;
  $('titleFoot').textContent =
    `${state.targets.length} ${plural(noun).toUpperCase()} · ${state.totalElements} THINGS TO DISCOVER`;
  $('titleFloaters').replaceChildren(...Array.from({ length: 12 }, (_, i) => {
    const sprite = pixelSprite(theme.floaters[i % theme.floaters.length], 3 + (i % 3), 'floater');
    sprite.style.left = `${(i * 8.3 + Math.random() * 5) % 96}%`;
    sprite.style.setProperty('--d', `${10 + Math.random() * 8}s`);
    sprite.style.setProperty('--delay', `${-Math.random() * 18}s`);
    sprite.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 60)}deg`);
    return sprite;
  }));
  if (!$('titleEq').children.length) $('titleEq').replaceChildren(...makeEqBars(32));
  renderTitleModes();
  updateStartButton();

  // Faint art behind the crafting board: an equalizer for music, film strips for film
  const deco = theme.board.map((name, i) => {
    const sprite = pixelSprite(name, 5);
    Object.assign(sprite.style, BOARD_DECO_SPOTS[i % BOARD_DECO_SPOTS.length]);
    return sprite;
  });
  if (state.game.id === 'film') {
    for (const side of ['top', 'bottom']) {
      const strip = document.createElement('div');
      strip.className = 'board-strip ' + side;
      deco.push(strip);
    }
  } else {
    const eq = document.createElement('div');
    eq.className = 'board-eq';
    eq.append(...makeEqBars(40));
    deco.push(eq);
  }
  $('boardDeco').replaceChildren(...deco);

  // Song/film picker
  $('pickerArt').replaceChildren(...theme.picker.map((name, i) => pixelSprite(name, i === 1 ? 4 : 3, 'outlined')));
}

/** The SONG CRAFT / FILM CRAFT buttons on the title screen. */
function renderTitleModes() {
  $('titleModes').replaceChildren(...state.modes.map((m) => {
    const b = document.createElement('button');
    const active = m.id === state.game?.id;
    b.className = 'title-mode' + (active ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(active));
    b.textContent = `${m.emoji} ${m.noun.toUpperCase()} CRAFT`;
    b.addEventListener('click', async () => {
      if (m.id === state.game?.id) return;
      if (state.mp) { toast('Leave the multiplayer lobby to switch games'); return; }
      try {
        await switchGame(m.id);
        sfx.discover(m.name);
      } catch {
        toast("⚠️ Couldn't load that game. Is the server running?");
      }
    });
    return b;
  }));
}

const gameInProgress = () => Boolean(state.mode) && !state.won && !state.failed;

function updateStartButton() {
  $('startBtn').lastChild.textContent = gameInProgress() ? ' CONTINUE' : state.mp ? ' BACK TO LOBBY' : ' PRESS START';
}

function syncTitleTools() {
  $('titleMute').textContent = $('muteBtn').textContent;
  $('titleTheme').textContent = $('themeBtn').textContent;
  $('titleTheme').title = $('themeBtn').title;
}

function showTitle() {
  updateStartButton();
  syncTitleTools();
  $('titleScreen').hidden = false;
}

function hideTitle() {
  $('titleScreen').hidden = true;
}

$('startBtn').addEventListener('click', () => {
  sfx.discover('start');
  const resume = gameInProgress();
  hideTitle();
  if (resume) return;
  if (state.mp || state.playerMode === 'multi') showMpModal();
  else showLevels();
});
$('titleDailyBtn').addEventListener('click', async () => {
  hideTitle();
  await refreshDaily();
  if (state.daily) startDaily();
  else showLevels();
});
/** Ends the single-player game that's running (level, daily, rush or free play) and clears the board. */
function endGame() {
  if (!state.mode || state.mode === 'mp') return;
  resetCommon(); // stops the timer, clears the board, closes menus, stops rush mode
  state.mode = null;
  state.target = null;
  state.inventory = [];
  $('goal').hidden = true;
  $('stats').hidden = true;
  $('hintBtn').hidden = true;
  renderItems();
}

// The home button ends the current game. In multiplayer it asks first, because leaving ends the race for everyone.
$('homeBtn').addEventListener('click', () => {
  if (state.mp) { $('quitBtn').click(); return; }
  endGame();
  showTitle();
});
$('titleMute').addEventListener('click', () => { $('muteBtn').click(); syncTitleTools(); });
$('titleTheme').addEventListener('click', () => { $('themeBtn').click(); syncTitleTools(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !$('titleScreen').hidden && document.activeElement?.tagName !== 'BUTTON') {
    $('startBtn').click();
  }
});

// ------------------------------------------------------------------ multiplayer
//
// A host creates a lobby and shares the 4-letter code. Everyone polls /api/mp/state about once a
// second. When the host starts a race, every player gets the same target; the server checks every
// combination and decides who crafted the target first.

const formatMs = (ms) => {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

function renderPlayerModes() {
  for (const b of document.querySelectorAll('.player-btn')) {
    const on = b.dataset.players === state.playerMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('titleDailyBtn').hidden = state.playerMode === 'multi';
}
document.querySelectorAll('.player-btn').forEach((b) => b.addEventListener('click', () => {
  state.playerMode = b.dataset.players;
  renderPlayerModes();
  sfx.pick(b.dataset.players);
}));

function showMpModal() {
  $('levelModal').hidden = true;
  $('winModal').hidden = true;
  $('failModal').hidden = true;
  $('mpNoun').textContent = state.game.noun;
  $('mpModeLabel').textContent = `${state.game.emoji} ${capital(state.game.noun)} Craft`;
  if (state.mp) {
    $('mpMenu').hidden = true;
    $('mpLobby').hidden = false;
    renderLobby();
  } else {
    $('mpMenu').hidden = false;
    $('mpLobby').hidden = true;
    if (!$('mpName').value) $('mpName').value = store.get('player', '');
  }
  loadAddresses();
  $('mpModal').hidden = false;
}

/** Shows the address friends should type in. */
async function loadAddresses() {
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let text = `Friends on the same network open ${location.origin}`;
  if (isLocal) {
    try {
      const { addresses } = await api.get('/api/mp/info');
      text = addresses.length
        ? `Friends on the same Wi-Fi open ${addresses.join(' or ')}`
        : "This computer isn't on a network, so other devices can't reach it.";
    } catch { /* keep the default text */ }
  }
  $('mpAddress').textContent = text;
  $('mpLobbyAddress').textContent = text;
}

async function mpEnter(action) {
  const name = $('mpName').value.trim();
  if (!name) { toast('Enter your name first'); $('mpName').focus(); return; }
  store.set('player', name);
  try {
    let res;
    if (action === 'host') {
      res = await api.post('/api/mp/create', { name });
      hooks.emit('mpHost');
    } else {
      const code = $('mpCode').value.trim().toUpperCase();
      if (code.length !== 4) { toast('Enter the 4-letter lobby code'); $('mpCode').focus(); return; }
      res = await api.post('/api/mp/join', { code, name });
      if (res.mode !== state.game.id) await switchGame(res.mode); // play whichever game the host picked
    }
    if (state.mode && state.mode !== 'mp') {
      // leaving a single-player game behind
      resetCommon();
      state.mode = null;
      $('goal').hidden = true;
      $('stats').hidden = true;
      $('hintBtn').hidden = true;
    }
    state.playerMode = 'multi';
    renderPlayerModes();
    state.mp = { code: res.code, player: res.player, lobby: null, round: 0, finishedRound: 0 };
    const first = await api.get(mpStateUrl());
    // Don't replay a race that finished before we joined
    state.mp.round = first.status === 'racing' ? 0 : first.round;
    state.mp.finishedRound = first.round;
    state.mp.lobby = first;
    $('levelsBtn').textContent = '👥 Lobby';
    showMpModal();
    state.mp.pollId = setInterval(pollMp, 1000);
    sfx.discover('lobby');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
}

const mpStateUrl = () =>
  `/api/mp/state?code=${encodeURIComponent(state.mp.code)}&player=${encodeURIComponent(state.mp.player)}`;

async function pollMp() {
  const mp = state.mp;
  if (!mp || mp.polling) return;
  mp.polling = true;
  try {
    const lobby = await api.get(mpStateUrl());
    if (state.mp !== mp) return;
    mp.lobby = lobby;
    handleLobby(lobby);
  } catch (e) {
    if (/not in this lobby|No lobby/.test(e.message)) {
      toast('⚠️ ' + e.message, 4000);
      leaveMultiplayer(false);
      showTitle();
    }
  } finally {
    mp.polling = false;
  }
}

function handleLobby(l) {
  if (l.status === 'racing' && l.round !== state.mp.round) startRace(l);
  if (l.status === 'finished' && l.round !== state.mp.finishedRound) {
    state.mp.finishedRound = l.round;
    finishRace(l);
  }
  if (state.mode === 'mp') updateRacePanel(l);
  if (!$('mpModal').hidden) renderLobby();
  updateStartButton();
}

function startRace(l) {
  state.mp.round = l.round;
  resetCommon();
  hideTitle();
  $('mpModal').hidden = true;
  state.mode = 'mp';
  state.target = l.target;
  state.inventory = state.starters.map((e) => ({ ...e }));
  state.startTime = Date.now() + l.startsInMs;
  state.elapsed = 0;
  state.mpLocked = true;
  clearInterval(state.timerId);
  state.timerId = setInterval(updateStats, 250);
  showGoal(l.target, 'Race');
  $('hintBtn').hidden = true;
  $('quitBtn').hidden = false;
  $('levelsBtn').textContent = '👥 Lobby';
  renderItems();
  updateStats();
  updateRacePanel(l);
  $('racePanel').hidden = false;
  runCountdown(l.startsInMs);
}

/** 3, 2, 1, GO! Combining unlocks on GO. */
function runCountdown(ms) {
  const overlay = $('countdown');
  const goAt = Date.now() + ms;
  let shown = null;
  clearInterval(state.mp.countdownId);
  const tick = () => {
    const left = goAt - Date.now();
    const label = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
    if (label !== shown) {
      shown = label;
      overlay.textContent = label;
      overlay.hidden = false;
      overlay.classList.remove('pulse');
      void overlay.offsetWidth;
      overlay.classList.add('pulse');
      sfx.beep(label === 'GO!');
    }
    if (left <= 0) {
      state.mpLocked = false;
      clearInterval(state.mp?.countdownId);
      setTimeout(() => { overlay.hidden = true; }, 700);
    }
  };
  tick();
  state.mp.countdownId = setInterval(tick, 100);
}

function finishRace(l) {
  const iWon = l.winner && l.winner.id === l.you;
  if (state.mode === 'mp') {
    state.won = true;
    state.mpLocked = true;
    clearInterval(state.timerId);
    if (iWon) state.elapsed = Math.floor(l.winner.ms / 1000);
    updateStats();
  }
  $('countdown').hidden = true;
  $('quitModal').hidden = true;
  if (l.endReason === 'quit') toast(`🚪 ${l.quitter} quit the race`, 3000);
  if (iWon) { sfx.win(); confetti(); hooks.emit('mpWin'); } else { sfx.fail(); }
  setTimeout(showMpModal, iWon ? 1200 : 500);
}

function sortedPlayers(l) {
  return [...l.players].sort((a, b) => {
    if (l.winner) {
      if (a.id === l.winner.id) return -1;
      if (b.id === l.winner.id) return 1;
    }
    return b.discoveries - a.discoveries;
  });
}

function updateRacePanel(l) {
  const list = sortedPlayers(l);
  const medals = ['🥇', '🥈', '🥉'];
  $('racePanelList').replaceChildren(...list.map((p, i) => {
    const li = document.createElement('li');
    if (p.you) li.classList.add('you');
    if (!p.connected) li.classList.add('away');
    const name = document.createElement('span');
    name.className = 'rp-name';
    name.textContent = `${medals[i] || '▫️'} ${p.name}${p.you ? ' (you)' : ''}`;
    const score = document.createElement('span');
    score.className = 'rp-score';
    score.textContent = l.winner && l.winner.id === p.id ? '🏆' : `${p.discoveries} found`;
    li.append(name, score);
    return li;
  }));
}

function fillTargetSelect() {
  const select = $('mpTarget');
  if (select.dataset.mode === state.game.id && select.options.length === state.targets.length + 1) return;
  const keep = select.value;
  const random = new Option(`🎲 Random ${state.game.noun}`, 'random');
  select.replaceChildren(random, ...state.targets.map((t) => new Option(`${t.emoji} ${t.name}`, t.name)));
  select.dataset.mode = state.game.id;
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}

function renderLobby() {
  const l = state.mp?.lobby;
  if (!l) return;
  $('mpCodeShow').textContent = l.code;

  const results = $('mpResults');
  if (l.status === 'finished' && l.target) {
    const iWon = l.winner && l.winner.id === l.you;
    const quit = l.endReason === 'quit';
    const banner = document.createElement('div');
    banner.className = 'mp-winner';
    banner.textContent = !l.winner ? '🚪 RACE OVER'
      : iWon ? '🏆 YOU WIN! 🏆' : `🏆 ${l.winner.name.toUpperCase()} WINS!`;
    const line = document.createElement('p');
    line.className = 'sub';
    line.textContent = quit
      ? (l.winner ? `${l.quitter} quit the race, so ${iWon ? 'you win' : l.winner.name + ' wins'}!`
                  : `${l.quitter} quit, so the race ended. The ${state.game.noun} was ${l.target.emoji} ${l.target.name}.`)
      : `Made ${l.target.emoji} ${l.target.name} in ${formatMs(l.winner.ms)}`;
    const fact = document.createElement('p');
    fact.className = 'fact';
    fact.textContent = `${state.game.emoji} ${l.target.fact}`;
    results.replaceChildren(banner, line, fact);
    results.hidden = false;
  } else {
    results.hidden = true;
  }

  $('mpPlayers').replaceChildren(...sortedPlayers(l).map((p) => {
    const li = document.createElement('li');
    if (p.you) li.classList.add('you');
    if (!p.connected) li.classList.add('away');
    const name = document.createElement('span');
    name.textContent = `${p.host ? '👑 ' : ''}${p.name}${p.you ? ' (you)' : ''}${p.connected ? '' : ' · away'}`;
    li.append(name);
    if (l.status !== 'waiting') {
      const score = document.createElement('span');
      score.className = 'mp-score';
      score.textContent = l.winner && l.winner.id === p.id
        ? (l.endReason === 'quit' ? '🏆 by default' : `🏆 ${formatMs(l.winner.ms)}`)
        : `${p.discoveries} found`;
      li.append(score);
    }
    return li;
  }));
  $('mpCount').textContent = `${l.players.length}/8`;

  const canStart = l.isHost && l.status !== 'racing';
  $('mpHostControls').hidden = !canStart;
  $('mpWaiting').hidden = l.isHost || l.status === 'racing';
  $('mpWaiting').textContent = l.status === 'finished'
    ? 'Waiting for the host to start the next race…'
    : 'Waiting for the host to start the race…';
  $('mpStartBtn').textContent = l.status === 'finished' ? '▶ NEXT RACE' : '▶ START RACE';
  if (canStart) fillTargetSelect();
  $('mpCloseBtn').hidden = state.mode !== 'mp';
}

async function leaveMultiplayer(tellServer = true) {
  const mp = state.mp;
  if (!mp) return;
  clearInterval(mp.pollId);
  clearInterval(mp.countdownId);
  state.mp = null;
  state.mpLocked = false;
  if (tellServer) api.post('/api/mp/leave', { code: mp.code, player: mp.player }).catch(() => {});
  $('racePanel').hidden = true;
  $('countdown').hidden = true;
  $('mpModal').hidden = true;
  $('quitBtn').hidden = true;
  $('quitModal').hidden = true;
  $('levelsBtn').textContent = `${state.game.emoji} ${capital(plural(state.game.noun))}`;
  if (state.mode === 'mp') {
    resetCommon();
    state.mode = null;
    state.target = null;
    state.inventory = [];
    $('goal').hidden = true;
    $('stats').hidden = true;
    renderItems();
  }
  updateStartButton();
}

$('quitBtn').addEventListener('click', () => {
  if (!state.mp) return;
  const others = (state.mp.lobby?.players.length || 1) - 1;
  $('quitText').textContent = state.mp.lobby?.status === 'racing'
    ? (others === 1
      ? 'Quitting ends the race for everyone, and the other player wins.'
      : 'Quitting ends the race for everyone.')
    : 'You will leave the lobby.';
  $('quitModal').hidden = false;
});
$('quitCancelBtn').addEventListener('click', () => { $('quitModal').hidden = true; });
$('quitConfirmBtn').addEventListener('click', () => {
  $('quitModal').hidden = true;
  leaveMultiplayer();
  showTitle();
  toast('🚪 You quit the race');
});

$('mpHostBtn').addEventListener('click', () => mpEnter('host'));
$('mpJoinBtn').addEventListener('click', () => mpEnter('join'));
$('mpCode').addEventListener('input', () => { $('mpCode').value = $('mpCode').value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('mpCode').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') mpEnter('join'); });
$('mpBackBtn').addEventListener('click', () => { $('mpModal').hidden = true; showTitle(); });
$('mpLeaveBtn').addEventListener('click', () => { leaveMultiplayer(); showTitle(); });
$('mpCloseBtn').addEventListener('click', () => { $('mpModal').hidden = true; });
$('mpStartBtn').addEventListener('click', async () => {
  if (!state.mp) return;
  $('mpStartBtn').disabled = true;
  try {
    await api.post('/api/mp/start', { code: state.mp.code, player: state.mp.player, target: $('mpTarget').value });
    await pollMp();
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    $('mpStartBtn').disabled = false;
  }
});
$('mpCodeShow').addEventListener('click', () => $('mpCopyBtn').click());
$('mpCopyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.mp?.code || '');
    toast('📋 Code copied');
  } catch {
    toast(`The code is ${state.mp?.code}`);
  }
});
// Tell the server when someone closes the tab, so they don't linger in the lobby
window.addEventListener('pagehide', () => {
  if (state.mp) navigator.sendBeacon('/api/mp/leave', JSON.stringify({ code: state.mp.code, player: state.mp.player }));
});

// ------------------------------------------------------------------ levels

function difficulty(par) {
  if (par < 0) return '❓';
  const stars = par <= 4 ? 1 : par <= 5 ? 2 : par <= 6 ? 3 : par <= 7 ? 4 : 5;
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function renderLevels() {
  const best = store.get(modeKey('best'), {});
  $('levelGrid').replaceChildren(...state.targets.map((t) => {
    const card = document.createElement('button');
    card.className = 'level' + (best[t.name] ? ' done' : '');
    const parts = [
      ['le', t.emoji], ['ln', t.name], ['la', `${t.creator} · ${t.year}`],
      ['ld', difficulty(t.par)],
      ['lb', best[t.name] ? `✔ Best: ${best[t.name].moves} moves` : ''],
    ];
    for (const [cls, text] of parts) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      card.appendChild(s);
    }
    card.addEventListener('click', () => startLevel(t));
    return card;
  }));
}

function showLevels() {
  renderLevels();
  refreshDaily();
  hooks.emit('levelsShown');
  $('winModal').hidden = true;
  $('failModal').hidden = true;
  $('levelModal').hidden = false;
}

function resetCommon() {
  clearBoard();
  state.newNames.clear();
  state.won = false;
  state.failed = false;
  state.moves = 0;
  state.hints = 0;
  hooks.emit('reset');
  clearInterval(state.timerId);
  $('failModal').hidden = true;
  $('search').value = '';
  $('levelModal').hidden = true;
  $('winModal').hidden = true;
}

function startLevel(target) {
  if (state.mp) leaveMultiplayer();
  resetCommon();
  state.mode = 'level';
  state.target = target;
  state.inventory = state.starters.map((e) => ({ ...e }));
  state.startTime = Date.now();
  state.elapsed = 0;
  state.timerId = setInterval(updateStats, 1000);

  showGoal(target, 'Make');
  $('hintBtn').hidden = false;
  updateStats();
  renderItems();
  toast(`🎯 Craft "${target.name}"! Par is ${target.par} combinations.`, 3000);
}

function startFreePlay() {
  if (state.mp) leaveMultiplayer();
  resetCommon();
  state.mode = 'free';
  state.target = null;
  const saved = store.get(modeKey('freeInventory'), null);
  state.inventory = Array.isArray(saved) && saved.length ? saved : state.starters.map((e) => ({ ...e }));
  $('goal').hidden = true;
  $('stats').hidden = true;
  $('hintBtn').hidden = true;
  renderItems();
  toast('🌌 Free play: your discoveries are saved in this browser', 3000);
}

function updateStats() {
  if (state.mode === 'rush') { rushUpdateStats(); return; }
  if (!isTimed()) return;
  if (!state.won && !state.failed) state.elapsed = Math.max(0, Math.floor((Date.now() - state.startTime) / 1000));
  const box = $('moves').parentElement;
  if (state.mode === 'daily') {
    const left = state.daily.moveLimit - state.moves;
    $('moves').textContent = `${state.moves} / ${state.daily.moveLimit}`;
    box.classList.toggle('low', left <= 3);
    box.title = `${left} move${left === 1 ? '' : 's'} left`;
  } else {
    $('moves').textContent = state.moves;
    box.classList.remove('low');
    box.title = 'Combinations tried';
  }
  $('timer').textContent = formatTime(state.elapsed);
}

async function hint() {
  if ((state.mode !== 'level' && state.mode !== 'rush') || state.won) return;
  let data;
  try {
    data = await api.post('/api/hint', { target: state.target.name, inventory: state.inventory.map((e) => e.name) });
  } catch {
    toast("⚠️ Can't reach the server");
    return;
  }
  if (!data.hint) { toast('No hint available'); return; }
  state.hints++;
  if (state.mode === 'rush') rushPenalty();
  else state.moves += 3;
  updateStats();
  $('search').value = '';
  renderItems();
  const { first, second } = data.hint;
  for (const name of [first, second]) {
    const chip = [...itemsEl.children].find((c) => c.dataset.name === name);
    if (chip) { chip.classList.add('glow'); chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  const emoji = (n) => state.inventory.find((e) => e.name === n)?.emoji ?? '';
  toast(`💡 Try ${emoji(first)} ${first} + ${emoji(second)} ${second}  (${state.mode === 'rush' ? '−15s' : '+3 moves'})`, 4000);
}

// ------------------------------------------------------------------ daily challenge

const isTimed = () => ['level', 'daily', 'mp', 'rush'].includes(state.mode);

function showGoal(target, label) {
  $('goalLabel').textContent = label;
  $('goalEmoji').textContent = target.emoji;
  $('goalName').textContent = target.name;
  $('goalArtist').textContent = target.creator;
  $('goal').hidden = false;
  $('stats').hidden = false;
}

const formatDay = (day) =>
  new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Fetches today's challenge for the current mode and draws the card at the top of the menu. */
async function refreshDaily() {
  try {
    state.daily = await api.get('/api/daily');
  } catch {
    $('dailyCard').hidden = true;
    return;
  }
  renderDailyCard();
}

function renderDailyCard() {
  const d = state.daily;
  const card = $('dailyCard');
  if (!d) { card.hidden = true; return; }
  const done = store.get(modeKey('daily'), null);
  const doneToday = done && done.day === d.day;

  const span = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  const info = document.createElement('div');
  info.className = 'dinfo';
  info.append(
    span('dlabel', `📅 Daily challenge · ${formatDay(d.day)}`),
    span('dname', d.target.name),
    span('dmeta', `${d.target.creator} · ${d.moveLimit}-move limit · fastest time wins · no hints`),
  );
  if (doneToday) info.append(span('ddone', `✔ Done in ${formatTime(done.seconds)} with ${done.moves} moves`));
  const play = document.createElement('button');
  play.className = 'btn primary';
  play.textContent = doneToday ? '🔁 Play again' : '▶ Play';
  play.addEventListener('click', () => startDaily());
  card.replaceChildren(span('de', d.target.emoji), info, play);
  card.hidden = false;
}

function startDaily() {
  if (!state.daily) return;
  if (state.mp) leaveMultiplayer();
  resetCommon();
  state.mode = 'daily';
  state.target = state.daily.target;
  state.inventory = state.starters.map((e) => ({ ...e }));
  state.startTime = Date.now();
  state.elapsed = 0;
  state.timerId = setInterval(updateStats, 1000);
  showGoal(state.target, 'Daily');
  $('hintBtn').hidden = true; // no hints in the daily challenge, to keep the race fair
  updateStats();
  renderItems();
  toast(`📅 Daily challenge: make "${state.target.name}" in ${state.daily.moveLimit} moves or fewer. Go!`, 3500);
}

/** In the daily challenge, warns when moves are running low and ends the attempt at zero. */
function checkOutOfMoves() {
  if (state.mode !== 'daily' || state.won || state.failed) return;
  const left = state.daily.moveLimit - state.moves;
  if (left > 0) {
    if (left <= 3) toast(`⚠️ ${left} move${left === 1 ? '' : 's'} left!`, 1500);
    return;
  }
  state.failed = true;
  clearInterval(state.timerId);
  sfx.fail();
  $('failText').textContent =
    `You used all ${state.daily.moveLimit} moves without making ${state.target.emoji} ${state.target.name}. ` +
    'Try again: the clock restarts from zero.';
  setTimeout(() => { $('failModal').hidden = false; }, 600);
}

$('failRetryBtn').addEventListener('click', startDaily);
$('failMenuBtn').addEventListener('click', showLevels);

// ------------------------------------------------------------------ winning

async function win() {
  state.won = true;
  clearInterval(state.timerId);
  updateStats();
  sfx.win();
  confetti();

  const t = state.target;
  const isDaily = state.mode === 'daily';
  if (isDaily) {
    // Remember today's best: faster wins, fewer moves breaks a tie.
    const prev = store.get(modeKey('daily'), null);
    const better = !prev || prev.day !== state.daily.day || state.elapsed < prev.seconds ||
      (state.elapsed === prev.seconds && state.moves < prev.moves);
    if (better) store.set(modeKey('daily'), { day: state.daily.day, moves: state.moves, seconds: state.elapsed });
  } else {
    const best = store.get(modeKey('best'), {});
    if (!best[t.name] || state.moves < best[t.name].moves) {
      best[t.name] = { moves: state.moves, seconds: state.elapsed };
      store.set(modeKey('best'), best);
    }
  }

  $('winEmoji').textContent = t.emoji;
  $('winName').textContent = t.name;
  $('winArtist').textContent = `${t.creator} · ${t.year}`;
  $('winFact').textContent = state.game.emoji + ' ' + t.fact;
  $('winBanner').textContent = gameTheme().winBanner;
  $('winMoves').textContent = state.moves;
  $('winTime').textContent = formatTime(state.elapsed);
  $('winPar').textContent = isDaily ? state.daily.moveLimit : t.par;
  $('winParLabel').textContent = isDaily ? 'move limit' : 'par';
  $('leaderboardTitle').textContent = isDaily ? "📅 Today's leaderboard (fastest first)" : '🏆 Leaderboard';
  $('nextSongBtn').textContent = isDaily ? 'Back to menu' : `Next ${state.game.noun} ▶`;
  state.scoreSubmitted = false;
  $('scoreForm').hidden = false;
  $('scoreThanks').hidden = true;
  $('saveScoreBtn').disabled = false;
  $('playerName').value = store.get('player', '');
  hooks.emit('win', { kind: state.mode, target: t, moves: state.moves, seconds: state.elapsed, par: t.par, hints: state.hints });
  await loadLeaderboard();
  setTimeout(() => { $('winModal').hidden = false; }, 1100);
}

async function loadLeaderboard(highlight) {
  try {
    const { scores } = state.mode === 'daily'
      ? await api.get('/api/daily/scores?day=' + encodeURIComponent(state.daily.day))
      : await api.get('/api/scores?target=' + encodeURIComponent(state.target.name));
    renderLeaderboard(scores, highlight);
  } catch {
    renderLeaderboard([], null);
  }
}

function renderLeaderboard(scores, highlight) {
  const ol = $('leaderboard');
  if (!scores.length) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet. Be the first!';
    ol.replaceChildren(li);
    return;
  }
  ol.replaceChildren(...scores.map((s) => {
    const li = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = s.player;
    li.append(name, state.mode === 'daily'
      ? ` · ${formatTime(s.seconds)} · ${s.moves} moves` // daily is ranked by time
      : ` · ${s.moves} moves · ${formatTime(s.seconds)}`);
    if (highlight && s.player === highlight.player && s.moves === highlight.moves && s.seconds === highlight.seconds) {
      li.classList.add('me');
    }
    return li;
  }));
}

$('scoreForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (state.scoreSubmitted) return; // one entry per win
  const player = $('playerName').value.trim();
  if (!player) return;
  // Lock straight away so a double-click or a quick second submit can't add a second entry.
  state.scoreSubmitted = true;
  $('saveScoreBtn').disabled = true;
  store.set('player', player);
  const entry = { player, target: state.target.name, moves: state.moves, seconds: state.elapsed };
  try {
    const { scores } = state.mode === 'daily'
      ? await api.post('/api/daily/scores', { ...entry, day: state.daily.day })
      : await api.post('/api/scores', entry);
    renderLeaderboard(scores, entry);
    $('scoreForm').hidden = true;
    $('scoreThanks').textContent = `🎉 Thank you, ${player}! Your score is on the leaderboard.`;
    $('scoreThanks').hidden = false;
  } catch (e) {
    // Saving failed, so let them try again.
    state.scoreSubmitted = false;
    $('saveScoreBtn').disabled = false;
    toast('⚠️ ' + e.message);
  }
});

function nextSong() {
  if (state.mode === 'daily') { showLevels(); return; }
  const best = store.get(modeKey('best'), {});
  const i = state.targets.findIndex((t) => t.name === state.target?.name);
  const ordered = [...state.targets.slice(i + 1), ...state.targets.slice(0, i + 1)];
  const next = ordered.find((t) => !best[t.name]);
  if (next) startLevel(next);
  else showLevels();
}

// ------------------------------------------------------------------ confetti

// Why this is smooth:
//  - Each emoji is drawn ONCE into a small offscreen "sprite" canvas. Drawing emoji text every frame
//    is slow, but copying a ready-made image (drawImage) is very fast.
//  - Movement uses the real time between frames, so speed stays the same on 60Hz and 144Hz screens,
//    and a dropped frame doesn't make everything stutter.
//  - The canvas matches the screen's pixel density, so it stays sharp without extra work.
const CONFETTI_SYMBOLS = {
  music: ['🎵', '🎶', '✨', '🎸', '🥁', '🎹', '⭐'],
  film: ['🎬', '🍿', '🎥', '⭐', '🎞️', '🏆', '✨'],
};
const spriteCache = new Map();

function confettiSprites() {
  const symbols = CONFETTI_SYMBOLS[state.game?.id] || ['🎉', '🎊', '✨', '⭐'];
  const key = symbols.join('');
  if (spriteCache.has(key)) return spriteCache.get(key);
  const size = 64;
  const sprites = symbols.map((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.font = `${size * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, size / 2, size / 2 + size * 0.05);
    return c;
  });
  spriteCache.set(key, sprites);
  return sprites;
}

let confettiRun = 0;

function confetti() {
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const run = ++confettiRun;   // a new burst cancels an old one
  const duration = 3200;       // ms
  const gravity = 1400;        // px per second²
  const sprites = confettiSprites();
  const parts = Array.from({ length: 70 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 650 + Math.random() * 650;
    return {
      x: w / 2 + (Math.random() - 0.5) * 160,
      y: h * 0.6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 8,
      size: 22 + Math.random() * 20,
      sprite: sprites[Math.floor(Math.random() * sprites.length)],
      wobble: Math.random() * Math.PI * 2,
    };
  });

  const start = performance.now();
  let last = start;
  function frame(now) {
    if (run !== confettiRun) return;
    const dt = Math.min((now - last) / 1000, 1 / 30); // cap so a stall doesn't teleport particles
    last = now;
    const t = now - start;
    // Fade everything out over the last 800ms
    const alpha = t > duration - 800 ? Math.max(0, (duration - t) / 800) : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = alpha;
    for (const p of parts) {
      p.vy += gravity * dt;
      p.vx *= 1 - 0.8 * dt;          // a little air resistance
      p.wobble += dt * 6;
      p.x += (p.vx + Math.sin(p.wobble) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + 60) continue;   // off screen: skip drawing
      const c = Math.cos(p.rot) * dpr, s = Math.sin(p.rot) * dpr;
      ctx.setTransform(c, s, -s, c, p.x * dpr, p.y * dpr);
      ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
    }

    if (t < duration) requestAnimationFrame(frame);
    else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.height = 0; // free the memory
    }
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ buttons

$('search').addEventListener('input', renderItems);
$('sortSelect').value = state.sort;
$('sortSelect').addEventListener('change', () => {
  state.sort = $('sortSelect').value;
  store.set('sort', state.sort);
  renderItems();
});

// Light / dark mode (the starting theme is applied by a small script in index.html's <head>)
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('themeBtn').textContent = dark ? '☀️' : '🌙';
  $('themeBtn').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}
$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  updateThemeButton();
});
updateThemeButton();
$('clearBtn').addEventListener('click', clearBoard);
$('hintBtn').addEventListener('click', hint);
$('levelsBtn').addEventListener('click', () => (state.mp ? showMpModal() : showLevels()));
$('freePlayBtn').addEventListener('click', startFreePlay);
$('keepPlayingBtn').addEventListener('click', () => { $('winModal').hidden = true; });
$('nextSongBtn').addEventListener('click', nextSong);
$('muteBtn').textContent = sfx.muted ? '🔇' : '🔊';
$('muteBtn').addEventListener('click', () => { $('muteBtn').textContent = sfx.toggle() ? '🔇' : '🔊'; });

// ------------------------------------------------------------------ start up

(async function init() {
  try {
    const { modes } = await api.get('/api/modes');
    state.modes = modes;
    // The title screen always opens on Song Craft (or the first mode if there's no music mode)
    await switchGame(modes.some((m) => m.id === 'music') ? 'music' : modes[0].id);
    showTitle();
  } catch (e) {
    toast("⚠️ Couldn't load the game. Is the Java server running?", 10000);
    console.error(e);
  }
})();
