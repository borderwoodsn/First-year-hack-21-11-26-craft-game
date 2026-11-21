// Extras for Song Craft / Film Craft:
//   1. Recipe book   - a lifetime collection of everything you've discovered, with recipes
//   2. Achievements  - badges with an "ACHIEVEMENT UNLOCKED" pop-up, plus a profile screen
//   3. Suggestions   - when two things don't combine, suggest what they should make
//   4. Rush mode     - craft as many targets as you can before the clock runs out
// This file is loaded after game.js and reacts to its events through `hooks`.
'use strict';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// =====================================================================================
// Stats (shared by achievements and the profile)
// =====================================================================================

function getStats() {
  return {
    attempts: 0, fails: 0, wins: 0, mpWins: 0, suggestions: 0,
    dailyDays: [], rushBest: {},
    ...store.get('stats', {}),
  };
}
function saveStats(stats) { store.set('stats', stats); }

// =====================================================================================
// 1. Recipe book
// =====================================================================================

const getCollection = (modeId = state.game.id) => store.get(`collection.${modeId}`, {});
const getRecipes = (modeId = state.game.id) => store.get(`recipes.${modeId}`, []);

/** Starters are always in the book. */
function seedCollection() {
  const c = getCollection();
  let changed = false;
  for (const e of state.starters) {
    if (!c[e.name]) { c[e.name] = { emoji: e.emoji, from: null, at: Date.now() }; changed = true; }
  }
  if (changed) store.set(`collection.${state.game.id}`, c);
}

hooks.on('gameChanged', () => { seedCollection(); checkCollectionAchievements(); });

hooks.on('combine', ({ a, b, result }) => {
  const stats = getStats();
  stats.attempts++;
  if (!result) stats.fails++;
  saveStats(stats);
  if (stats.attempts >= 200) unlock('experimenter');
  if (stats.fails >= 50) unlock('oops');
  if (!result) return;

  // remember every recipe the player has found
  const recipes = getRecipes();
  const same = (r) => r[2] === result.name && ((r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));
  if (!recipes.some(same)) {
    recipes.push([a, b, result.name]);
    if (recipes.length > 5000) recipes.shift();
    store.set(`recipes.${state.game.id}`, recipes);
  }
  // and add new things to the lifetime collection
  const c = getCollection();
  if (!c[result.name]) {
    c[result.name] = { emoji: result.emoji, from: [a, b], at: Date.now() };
    store.set(`collection.${state.game.id}`, c);
    unlock('first_find');
    checkCollectionAchievements();
  }
});

function openBook(name) {
  $('bookTitle').textContent = `📖 ${capital(state.game.noun)} Craft recipe book`;
  $('bookSearch').value = '';
  renderBookList();
  if (name && getCollection()[name]) showBookEntry(name);
  else showBookList();
  $('bookModal').hidden = false;
}

function showBookList() {
  $('bookEntry').hidden = true;
  $('bookList').hidden = false;
}

function renderBookList() {
  const c = getCollection();
  const names = Object.keys(c).sort((x, y) => x.localeCompare(y));
  const total = state.totalElements || names.length;
  const targetNames = new Set(state.targets.map((t) => t.name));
  $('bookCount').textContent = `${names.length} / ${total} discovered`;
  $('bookBarFill').style.width = `${Math.min(100, (names.length / total) * 100)}%`;

  const q = $('bookSearch').value.trim().toLowerCase();
  const shown = names.filter((n) => n.toLowerCase().includes(q));
  const items = shown.map((n) => {
    const b = el('button', 'book-item' + (targetNames.has(n) ? ' is-target' : ''));
    b.append(el('span', 'bi-emoji', c[n].emoji), el('span', 'bi-name', n));
    b.addEventListener('click', () => showBookEntry(n));
    return b;
  });
  const missing = total - names.length;
  if (!q && missing > 0) {
    const locked = el('div', 'book-item locked');
    locked.append(el('span', 'bi-emoji', '❓'), el('span', 'bi-name', `${missing} still to discover`));
    items.push(locked);
  }
  if (!items.length) items.push(el('p', 'sub', 'Nothing matches that search.'));
  $('bookGrid').replaceChildren(...items);
}

function bookChip(name) {
  const c = getCollection();
  const known = c[name];
  const chip = el('button', 'chip book-link' + (known ? '' : ' unknown'));
  chip.append(el('span', 'e', known ? known.emoji : '❓'), el('span', '', known ? name : '???'));
  if (known) chip.addEventListener('click', () => showBookEntry(name));
  return chip;
}

function recipeRow(r) {
  const row = el('div', 'recipe-row');
  row.append(bookChip(r[0]), el('span', 'op', '+'), bookChip(r[1]), el('span', 'op', '='), bookChip(r[2]));
  return row;
}

async function showBookEntry(name) {
  const c = getCollection();
  const entry = c[name];
  if (!entry) return;
  const recipes = getRecipes();
  const making = recipes.filter((r) => r[2] === name);
  const using = recipes.filter((r) => r[0] === name || r[1] === name);
  const isTarget = state.targets.some((t) => t.name === name);

  const box = $('bookEntry');
  const head = el('div', 'entry-head');
  head.append(el('div', 'entry-emoji', entry.emoji), el('h2', 'entry-name', name));
  const tags = el('div', 'entry-tags');
  if (!entry.from) tags.append(el('span', 'tag', '🧱 Starting block'));
  if (isTarget) tags.append(el('span', 'tag gold', `🎯 Target ${state.game.noun}`));
  if (entry.at) tags.append(el('span', 'tag', `Found ${new Date(entry.at).toLocaleDateString()}`));
  const facts = el('p', 'entry-facts sub', 'Looking up recipes…');

  const sections = [];
  if (entry.from) {
    sections.push(el('h3', '', 'First made from'));
    sections.push(recipeRow([entry.from[0], entry.from[1], name]));
  }
  if (making.length > (entry.from ? 1 : 0)) {
    sections.push(el('h3', '', `Ways you know to make it (${making.length})`));
    making.forEach((r) => sections.push(recipeRow(r)));
  }
  if (isTarget) {
    sections.push(el('p', 'sub', `🏁 This is a finished ${state.game.noun}, the end of the line. Nothing is made from it.`));
  } else {
    sections.push(el('h3', '', `Used in (${using.length} you know)`));
    if (using.length) using.slice(0, 40).forEach((r) => sections.push(recipeRow(r)));
    else sections.push(el('p', 'sub', 'You haven\'t used it in anything yet. Try mixing it!'));
  }

  const actions = el('div', 'entry-actions');
  if (has(name) && $('titleScreen').hidden) {
    const place = el('button', 'btn primary', '➕ Put it on the board');
    place.addEventListener('click', () => {
      const element = state.inventory.find((e) => e.name === name);
      $('bookModal').hidden = true;
      addToBoardSomewhere(element);
      sfx.place();
    });
    actions.append(place);
  }

  box.replaceChildren(head, tags, facts, ...sections, actions);
  $('bookList').hidden = true;
  box.hidden = false;
  $('bookModal').querySelector('.modal-card').scrollTop = 0;

  try {
    const info = await fetch(`/api/element?mode=${encodeURIComponent(state.game.id)}&name=${encodeURIComponent(name)}`)
      .then((r) => r.json());
    if (info.error) throw new Error(info.error);
    const knownMaking = making.length;
    const knownUsing = using.length;
    facts.textContent = (info.starter ? 'A starting block. ' : `There ${info.recipesMaking === 1 ? 'is 1 way' : `are ${info.recipesMaking} ways`} to make it (you know ${knownMaking}). `) +
      (info.target ? '' : `It's an ingredient in ${info.recipesUsing} recipe${info.recipesUsing === 1 ? '' : 's'} (you know ${knownUsing}).`);
  } catch {
    facts.textContent = '';
  }
}

$('bookSearch').addEventListener('input', renderBookList);
$('bookCloseBtn').addEventListener('click', () => { $('bookModal').hidden = true; });
$('bookBtn').addEventListener('click', () => openBook());
$('titleBookBtn').addEventListener('click', () => openBook());
// Right-click any block to look it up in the book
for (const area of [itemsEl, board]) {
  area.addEventListener('contextmenu', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    ev.preventDefault();
    openBook(chip.dataset.name);
  });
}

// =====================================================================================
// 2. Achievements + profile
// =====================================================================================

const ACHIEVEMENTS = [
  { id: 'first_find', icon: '✨', name: 'First Find', desc: 'Make your first discovery.' },
  { id: 'collector25', icon: '🎒', name: 'Collector', desc: 'Have 25 things in one recipe book.' },
  { id: 'collector100', icon: '📚', name: 'Hoarder', desc: 'Have 100 things in one recipe book.' },
  { id: 'both_worlds', icon: '🎭', name: 'Double Feature', desc: 'Discover something in both Song Craft and Film Craft.' },
  { id: 'first_win', icon: '🏁', name: 'First Hit', desc: 'Craft your first song or film.' },
  { id: 'under_par', icon: '⛳', name: 'Under Par', desc: 'Finish a level in par moves or fewer.' },
  { id: 'no_hints', icon: '🧠', name: 'No Help Needed', desc: 'Win a level without using a hint.' },
  { id: 'speedy', icon: '⚡', name: 'Speedy', desc: 'Win a level in under 60 seconds.' },
  { id: 'lightning', icon: '🌩️', name: 'Lightning Fingers', desc: 'Win a level in under 20 seconds.' },
  { id: 'all_music', icon: '🎵', name: 'Greatest Hits', desc: 'Craft every song.' },
  { id: 'all_film', icon: '🎬', name: 'Film Buff', desc: 'Craft every film.' },
  { id: 'daily', icon: '📅', name: 'Daily Player', desc: 'Complete a daily challenge.' },
  { id: 'streak3', icon: '🔥', name: 'On a Roll', desc: 'Complete daily challenges 3 days in a row.' },
  { id: 'mp_host', icon: '🏠', name: 'Party Starter', desc: 'Host a multiplayer lobby.' },
  { id: 'mp_win', icon: '🥇', name: 'Champion', desc: 'Win a multiplayer race.' },
  { id: 'rush3', icon: '⏱️', name: 'Rush Hour', desc: 'Score 3 in Rush mode.' },
  { id: 'rush6', icon: '🚀', name: 'Unstoppable', desc: 'Score 6 in Rush mode.' },
  { id: 'suggester', icon: '💡', name: 'Ideas Person', desc: 'Suggest a new combination.' },
  { id: 'experimenter', icon: '🧪', name: 'Mad Scientist', desc: 'Try 200 combinations.' },
  { id: 'oops', icon: '💥', name: 'Happy Accidents', desc: 'Try 50 combinations that make nothing.' },
];

const achQueue = [];
let achShowing = false;

function unlock(id) {
  const got = store.get('achievements', {});
  if (got[id]) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  got[id] = Date.now();
  store.set('achievements', got);
  achQueue.push(a);
  if (!achShowing) showNextAchievement();
}

function showNextAchievement() {
  const a = achQueue.shift();
  if (!a) { achShowing = false; return; }
  achShowing = true;
  const box = $('achToast');
  box.replaceChildren(el('span', 'ach-icon', a.icon), Object.assign(el('div', 'ach-text'), {}));
  box.lastChild.append(el('small', '', 'ACHIEVEMENT UNLOCKED'), el('b', '', a.name));
  box.classList.remove('show');
  void box.offsetWidth;
  box.classList.add('show');
  sfx.discover('achievement-' + a.id);
  setTimeout(() => {
    box.classList.remove('show');
    setTimeout(showNextAchievement, 450);
  }, 3200);
}

function checkCollectionAchievements() {
  const counts = state.modes.map((m) => Object.values(getCollection(m.id)).filter((x) => x.from).length);
  const biggest = Math.max(...state.modes.map((m) => Object.keys(getCollection(m.id)).length));
  if (counts.some((n) => n > 0)) unlock('first_find');
  if (biggest >= 25) unlock('collector25');
  if (biggest >= 100) unlock('collector100');
  if (counts.length > 1 && counts.every((n) => n > 0)) unlock('both_worlds');
}

hooks.on('win', ({ kind, moves, seconds, par, hints }) => {
  const stats = getStats();
  stats.wins++;
  unlock('first_win');
  if (kind === 'level') {
    if (moves <= par) unlock('under_par');
    if (hints === 0) unlock('no_hints');
    if (seconds < 60) unlock('speedy');
    if (seconds < 20) unlock('lightning');
    const best = store.get(modeKey('best'), {});
    if (state.targets.every((t) => best[t.name])) unlock(`all_${state.game.id}`);
  }
  if (kind === 'daily') {
    unlock('daily');
    if (!stats.dailyDays.includes(state.daily.day)) stats.dailyDays.push(state.daily.day);
    if (dailyStreak(stats.dailyDays) >= 3) unlock('streak3');
  }
  saveStats(stats);
});
hooks.on('mpHost', () => unlock('mp_host'));
hooks.on('mpWin', () => {
  const stats = getStats();
  stats.mpWins++;
  saveStats(stats);
  unlock('mp_win');
});

/** How many days in a row (ending today or yesterday) have a completed daily challenge. */
function dailyStreak(days) {
  const set = new Set(days);
  const d = new Date();
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (!set.has(key(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (set.has(key(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

async function openProfile() {
  const stats = getStats();
  const got = store.get('achievements', {});
  $('profileName').textContent = store.get('player', '') ? `Player: ${store.get('player', '')}` : 'Set your name by saving a score.';

  const tiles = [];
  const tile = (big, label) => {
    const t = el('div', 'stat-tile');
    t.append(el('b', '', String(big)), el('small', '', label));
    return t;
  };
  for (const m of state.modes) {
    const collection = getCollection(m.id);
    let total = '?';
    let targets = [];
    try {
      const [s, t] = await Promise.all([
        fetch(`/api/stats?mode=${m.id}`).then((r) => r.json()),
        fetch(`/api/targets?mode=${m.id}`).then((r) => r.json()),
      ]);
      total = s.totalElements;
      targets = t.targets;
    } catch { /* offline */ }
    const best = store.get(m.id === 'music' ? 'best' : `best.${m.id}`, {});
    const done = targets.filter((t) => best[t.name]).length;
    tiles.push(tile(`${Object.keys(collection).length}/${total}`, `${m.emoji} ${m.name} discoveries`));
    tiles.push(tile(`${done}/${targets.length || '?'}`, `${m.emoji} ${capital(plural(m.noun))} crafted`));
    tiles.push(tile(stats.rushBest[m.id] || 0, `${m.emoji} Best rush score`));
  }
  const rate = stats.attempts ? Math.round(((stats.attempts - stats.fails) / stats.attempts) * 100) : 0;
  tiles.push(tile(stats.attempts, 'Combinations tried'));
  tiles.push(tile(`${rate}%`, 'Success rate'));
  tiles.push(tile(stats.mpWins, 'Multiplayer wins'));
  tiles.push(tile(dailyStreak(stats.dailyDays), 'Daily streak (days)'));
  tiles.push(tile(stats.suggestions, 'Ideas suggested'));
  $('profileStats').replaceChildren(...tiles);

  $('achCount').textContent = `${Object.keys(got).length}/${ACHIEVEMENTS.length}`;
  $('achGrid').replaceChildren(...ACHIEVEMENTS.map((a) => {
    const card = el('div', 'ach-card' + (got[a.id] ? ' got' : ''));
    card.title = got[a.id] ? `Unlocked ${new Date(got[a.id]).toLocaleDateString()}` : 'Locked';
    card.append(el('span', 'ach-icon', got[a.id] ? a.icon : '🔒'), el('b', '', a.name), el('small', '', a.desc));
    return card;
  }));
  $('profileModal').hidden = false;
}

$('titleProfileBtn').addEventListener('click', openProfile);
$('profileCloseBtn').addEventListener('click', () => { $('profileModal').hidden = true; });

// =====================================================================================
// 3. Suggestions: "these should make something!"
// =====================================================================================

let lastFail = null;
let suggestBarTimer;

hooks.on('combine', ({ a, b, result, chipA, chipB }) => {
  if (result || state.mode === 'mp') return;
  lastFail = { a, b, emojiA: chipA.dataset.emoji, emojiB: chipB.dataset.emoji };
  $('suggestText').textContent = `${lastFail.emojiA} ${a} + ${lastFail.emojiB} ${b} made nothing.`;
  $('suggestBar').hidden = false;
  clearTimeout(suggestBarTimer);
  suggestBarTimer = setTimeout(() => { $('suggestBar').hidden = true; }, 8000);
});
hooks.on('reset', () => { $('suggestBar').hidden = true; });

$('suggestOpenBtn').addEventListener('click', () => {
  if (!lastFail) return;
  $('suggestBar').hidden = true;
  $('suggestPair').textContent = `${lastFail.emojiA} ${lastFail.a}  +  ${lastFail.emojiB} ${lastFail.b}  =  ?`;
  $('suggestResult').value = '';
  $('suggestEmoji').value = '';
  $('suggestForm').hidden = false;
  $('suggestThanks').hidden = true;
  $('suggestModal').hidden = false;
  setTimeout(() => $('suggestResult').focus(), 50);
});
$('suggestCancelBtn').addEventListener('click', () => { $('suggestModal').hidden = true; });
$('suggestForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const result = $('suggestResult').value.trim();
  if (!result || !lastFail) return;
  $('suggestSendBtn').disabled = true;
  try {
    await api.post('/api/suggest', {
      a: lastFail.a, b: lastFail.b, result, emoji: $('suggestEmoji').value.trim(), player: store.get('player', ''),
    });
    const stats = getStats();
    stats.suggestions++;
    saveStats(stats);
    unlock('suggester');
    $('suggestForm').hidden = true;
    $('suggestThanks').textContent = `🙌 Thanks! "${lastFail.a} + ${lastFail.b} = ${result}" has been sent to the game host to review.`;
    $('suggestThanks').hidden = false;
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    $('suggestSendBtn').disabled = false;
  }
});

// =====================================================================================
// 4. Rush mode
// =====================================================================================

const RUSH_SECONDS = 180;
const RUSH_BONUS = 20;
const RUSH_HINT_PENALTY = 15;

function renderRushCard() {
  const best = getStats().rushBest[state.game.id] || 0;
  const card = $('rushCard');
  const info = el('div', 'dinfo');
  info.append(
    el('span', 'dlabel', '⏱️ Rush mode · 3:00'),
    el('span', 'dname', `Craft as many ${plural(state.game.noun)} as you can`),
    el('span', 'dmeta', `Each one adds +${RUSH_BONUS}s to the clock · hints cost ${RUSH_HINT_PENALTY}s`),
  );
  if (best) info.append(el('span', 'ddone', `🏆 Your best: ${best}`));
  const play = el('button', 'btn primary', '▶ Rush');
  play.addEventListener('click', startRush);
  card.replaceChildren(el('span', 'de', '⏱️'), info, play);
  card.hidden = false;
}
hooks.on('levelsShown', renderRushCard);

function startRush() {
  if (state.mp) leaveMultiplayer();
  resetCommon();
  hideTitle();
  state.mode = 'rush';
  state.rush = { score: 0, endAt: Date.now() + RUSH_SECONDS * 1000, done: [] };
  state.inventory = state.starters.map((e) => ({ ...e }));
  state.startTime = Date.now();
  $('hintBtn').hidden = false;
  nextRushTarget();
  state.timerId = setInterval(updateStats, 250);
  renderItems();
  updateStats();
  toast(`⏱️ RUSH! Make as many ${plural(state.game.noun)} as you can. Your discoveries carry over between them!`, 4000);
}

function nextRushTarget() {
  // Pick one of the three easiest targets you haven't made yet, so it gets harder as you go
  const remaining = state.targets.filter((t) => !state.rush.done.includes(t.name) && !has(t.name));
  if (!remaining.length) { endRush(true); return; }
  const pool = [...remaining].sort((a, b) => a.par - b.par).slice(0, 3);
  state.target = pool[Math.floor(Math.random() * pool.length)];
  showGoal(state.target, 'Rush');
  renderItems();
}

function rushCheck(result, chip) {
  if (!state.rush || !result || state.won || result.name !== state.target.name) return;
  state.rush.score++;
  state.rush.done.push(result.name);
  state.rush.endAt += RUSH_BONUS * 1000;
  sfx.win();
  if (chip) burst(chip);
  toast(`🎯 ${result.emoji} ${result.name}! +${RUSH_BONUS}s`, 2200);
  nextRushTarget();
  updateStats();
}

function rushPenalty() {
  if (state.rush) state.rush.endAt -= RUSH_HINT_PENALTY * 1000;
}

function rushUpdateStats() {
  if (!state.rush) return;
  const left = Math.max(0, Math.ceil((state.rush.endAt - Date.now()) / 1000));
  $('moves').textContent = `★ ${state.rush.score}`;
  $('moves').parentElement.title = 'Score';
  $('moves').parentElement.classList.remove('low');
  $('timer').textContent = formatTime(left);
  $('timer').parentElement.classList.toggle('low', left <= 15);
  if (left <= 0 && !state.won) endRush(false);
}

async function endRush(clearedAll) {
  if (!state.rush || state.won) return;
  state.won = true;
  clearInterval(state.timerId);
  const score = state.rush.score;
  const stats = getStats();
  const isBest = score > (stats.rushBest[state.game.id] || 0);
  if (isBest) stats.rushBest[state.game.id] = score;
  saveStats(stats);
  if (score >= 3) unlock('rush3');
  if (score >= 6) unlock('rush6');
  if (score > 0) { sfx.win(); confetti(); } else { sfx.fail(); }

  $('rushBanner').textContent = clearedAll ? `★ ALL ${plural(state.game.noun).toUpperCase()} MADE! ★` : "⏱️ TIME'S UP!";
  $('rushScore').textContent = score;
  $('rushSummary').textContent = `${score} ${score === 1 ? state.game.noun : plural(state.game.noun)} crafted` +
    (isBest && score > 0 ? ' · new personal best!' : '');
  $('rushDone').replaceChildren(...state.rush.done.map((name) => {
    const t = state.targets.find((x) => x.name === name);
    return el('span', 'tag', `${t ? t.emoji : '🎯'} ${name}`);
  }));
  $('rushForm').hidden = score === 0;
  $('rushThanks').hidden = true;
  $('rushSaveBtn').disabled = false;
  $('rushName').value = store.get('player', '');
  $('rushForm').dataset.submitted = '';
  await loadRushBoard();
  $('rushModal').hidden = false;
}

async function loadRushBoard(highlight) {
  try {
    const { scores } = await api.get('/api/rush/scores');
    $('rushBoard').replaceChildren(...(scores.length ? scores.map((s) => {
      const li = el('li');
      li.append(el('b', '', s.player), ` · ★ ${s.score}`);
      if (highlight && s.player === highlight.player && s.score === highlight.score) li.classList.add('me');
      return li;
    }) : [el('li', '', 'No scores yet. Be the first!')]));
  } catch {
    $('rushBoard').replaceChildren(el('li', '', 'Leaderboard unavailable'));
  }
}

hooks.on('reset', () => {
  state.rush = null;
  $('rushModal').hidden = true;
  $('timer').parentElement.classList.remove('low');
});

$('rushForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if ($('rushForm').dataset.submitted) return; // one entry per run
  const player = $('rushName').value.trim();
  if (!player) return;
  $('rushForm').dataset.submitted = '1';
  $('rushSaveBtn').disabled = true;
  store.set('player', player);
  const entry = { player, score: Number($('rushScore').textContent) };
  try {
    await api.post('/api/rush/scores', entry);
    await loadRushBoard(entry);
    $('rushForm').hidden = true;
    $('rushThanks').textContent = `🎉 Thank you, ${player}! Your score is on the leaderboard.`;
    $('rushThanks').hidden = false;
  } catch (e) {
    $('rushForm').dataset.submitted = '';
    $('rushSaveBtn').disabled = false;
    toast('⚠️ ' + e.message);
  }
});
$('rushAgainBtn').addEventListener('click', startRush);
$('rushMenuBtn').addEventListener('click', () => { $('rushModal').hidden = true; showLevels(); });

// =====================================================================================
// Back buttons: every menu has a ◀ BACK button in its top-left corner, and Escape does the same
// =====================================================================================

const BACK = {
  // Song/film picker: back to the game if one is running, otherwise the title screen
  levelModal: () => {
    $('levelModal').hidden = true;
    if (!gameInProgress()) showTitle();
  },
  winModal: () => showLevels(),
  failModal: () => showLevels(),
  rushModal: () => { $('rushModal').hidden = true; showLevels(); },
  // Multiplayer: from the name/code menu go to the title screen; from the lobby, go back to the race
  // if one is running, otherwise to the title screen (you stay in the lobby and can return to it)
  mpModal: () => {
    $('mpModal').hidden = true;
    if (!(state.mode === 'mp' && gameInProgress())) showTitle();
  },
  quitModal: () => { $('quitModal').hidden = true; },
  suggestModal: () => { $('suggestModal').hidden = true; },
  profileModal: () => { $('profileModal').hidden = true; },
  // Recipe book: from an entry go back to the list, from the list close the book
  bookModal: () => {
    if (!$('bookEntry').hidden) { renderBookList(); showBookList(); }
    else $('bookModal').hidden = true;
  },
};

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.back-btn');
  if (!btn) return;
  sfx.pick('back');
  BACK[btn.dataset.back]?.();
});

// Escape presses the back button of the top-most open menu
const BACK_ORDER = ['quitModal', 'suggestModal', 'bookModal', 'profileModal', 'rushModal',
  'failModal', 'winModal', 'mpModal', 'levelModal'];
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  const open = BACK_ORDER.find((id) => !$(id).hidden);
  if (open) { ev.preventDefault(); BACK[open](); }
});

// The page may have finished loading its game mode before this file ran
if (state.game) { seedCollection(); checkCollectionAchievements(); }
