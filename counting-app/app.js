'use strict';

/* ---------------------------------------------------------------------
   Let's Count!
   A local, offline counting practice app for a young learner. Each round
   asks about one number (1-20), but the QUESTION FORMAT rotates across
   six mini-games so it doesn't get repetitive — the underlying mastery
   tracking, level-gating, and rewards are shared by all of them:
   - Type the count / Multiple choice: classic "how many?" (typed or tapped)
   - Match: given a numeral, tap the picture group with that many items
   - Sequence: given a short run of numbers, tap what's missing
   - Compare: given two piles, tap the one with more
   - Feed the monster: tap exactly N snacks, then confirm
   None of the games require reading — each communicates its task through
   layout and icons (a blank "❓" tile, a monster with an order ticket, two
   piles side by side) since the child can't yet read Hebrew sentences.
   All interaction is mouse/keyboard only (no touchscreen).
   - Tracks mastery per number 1-20 using a Leitner-style box (0-5).
   - Mixes ~2/3 practice from numbers she's expected to know with
     ~1/3 from numbers she's still learning (spaced repetition).
   - Splits counting 1-20 into 10 levels (2 new numbers each). Only
     numbers from unlocked levels are asked; a level completes once
     both its numbers are "known", unlocking the next one.
   - Rewards correct answers with stars, streaks, stickers, and sound.
   All progress is stored in this browser's localStorage on this Mac.
------------------------------------------------------------------------ */

const STORAGE_KEY = 'countingAppProgressV1';
const TOTAL_NUMBERS = 20;
const NUMBERS_PER_LEVEL = 2;
const LEVEL_COUNT = TOTAL_NUMBERS / NUMBERS_PER_LEVEL; // 10

const KNOWN_BOX_THRESHOLD = 3;
const MASTERED_BOX_THRESHOLD = 5;
const MAX_BOX = 5;
const KNOWN_PICK_RATIO = 2 / 3;

const ICON_SET = ['🍎','🌟','🎈','🧸','🍓','🐰','🦋','🍩','🌼','🐠','🍭','🎁','🍪','🐝','🌈','🐬','🍉','🐥','🦕','🐧'];
const SNACK_ICONS = ['🍎','🍓','🍩','🍭','🍪','🍉'];

const STICKER_SET = ['🧸','🎈','🍭','🦄','🐣','🍓','🎨','🚀','🌈','🐬','🍩','🐥','🌻','🦕','🍉','🎪','🐧','🥳','🎁','🐝'];
const STICKER_MILESTONES = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000, 1200, 1500, 1800, 2200, 2600];

const CORRECT_MESSAGES = [
  "כן! ספרת נכון! 🎉", "את כוכבת בספירה! ⭐", "כל הכבוד! 🙌", "וואו, כל כך מהר! ⚡",
  "הצלחת! 🎯", "ספירה נהדרת! 🌈", "איזו ילדה חכמה! 🧠", "כן! מושלם! ✨"
];

const GENTLE_MESSAGES = [
  "זה בסדר! בואי נספור שוב. 💪",
  "ניסיון טוב! בואי נזכור את זה. 💡",
  "אין דבר — בפעם הבאה יהיה לך! 🌟",
  "כמעט! בואי נמשיך לתרגל. 🌱"
];

const GAME_MODES = ['type', 'choice', 'match', 'sequence', 'compare', 'feed'];

const SOUND_KINDS = {
  correct: { type: 'sine', notes: [523.25, 659.25, 783.99], noteDur: 0.09, gain: 0.15 },
  gentle: { type: 'sine', notes: [392.0, 349.23], noteDur: 0.09, gain: 0.15 },
  sticker: { type: 'triangle', notes: [783.99, 987.77, 1174.66], noteDur: 0.08, gain: 0.14 },
  levelUp: { type: 'triangle', notes: [523.25, 659.25, 783.99, 1046.5], noteDur: 0.12, gain: 0.18 },
  trophy: { type: 'triangle', notes: [523.25, 659.25, 783.99, 1046.5, 1318.51], noteDur: 0.14, gain: 0.19 },
  tick: { type: 'sine', notes: [880], noteDur: 0.05, gain: 0.06 },
};

/* ---------------------------- State ---------------------------- */

function defaultState() {
  return {
    numbers: {},        // "n" -> { box, attempts, correct, lastSeen }
    stars: 0,
    currentStreak: 0,
    bestStreak: 0,
    totalCorrect: 0,
    totalAsked: 0,
    unlockedStickers: [],
    currentLevel: 1,
    trophyShown: false,
    settings: { sound: 'on' }
  };
}

let state = loadState();
let currentTarget = null;   // the number currently being asked
let currentMode = null;     // which mini-game is active this round
let lastTarget = null;
let lastMode = null;
let feedbackTimer = null;
let stickerToastTimer = null;
let tickTimers = [];
let compareLeftCount = 0;
let compareRightCount = 0;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, parsed, {
      numbers: parsed.numbers || {},
      settings: Object.assign(base.settings, parsed.settings || {})
    });
  } catch (e) {
    console.warn('Could not load saved progress, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------- Numbers ---------------------------- */

function getNumberRecord(n) {
  const key = String(n);
  if (!state.numbers[key]) {
    state.numbers[key] = { n, box: 0, attempts: 0, correct: 0, lastSeen: 0 };
  }
  return state.numbers[key];
}

function allNumbers() {
  const ids = [];
  for (let n = 1; n <= TOTAL_NUMBERS; n++) ids.push(n);
  return ids;
}

function isKnown(rec) { return rec.box >= KNOWN_BOX_THRESHOLD; }
function isMastered(rec) { return rec.box >= MASTERED_BOX_THRESHOLD; }

/* ------------------------ Levels ------------------------
   Level k covers numbers (2k-1) and (2k), so counting is learned in
   order: Level 1 = 1,2 ... Level 10 = 19,20.
------------------------------------------------------------------- */

function getNumbersForLevel(level) {
  const start = (level - 1) * NUMBERS_PER_LEVEL + 1;
  const nums = [];
  for (let n = start; n < start + NUMBERS_PER_LEVEL && n <= TOTAL_NUMBERS; n++) nums.push(n);
  return nums;
}

function getUnlockedNumbers() {
  const maxUnlocked = Math.min(state.currentLevel * NUMBERS_PER_LEVEL, TOTAL_NUMBERS);
  const ids = [];
  for (let n = 1; n <= maxUnlocked; n++) ids.push(n);
  return ids;
}

function checkLevelCompletion() {
  const nums = getNumbersForLevel(state.currentLevel);
  const allKnown = nums.length > 0 && nums.every(n => isKnown(getNumberRecord(n)));
  if (!allKnown) return null;

  if (state.currentLevel < LEVEL_COUNT) {
    state.currentLevel += 1;
    return { type: 'levelUp', completedLevel: state.currentLevel - 1, newLevel: state.currentLevel };
  }
  if (!state.trophyShown) {
    state.trophyShown = true;
    return { type: 'allComplete' };
  }
  return null;
}

function levelProgressData() {
  const level = Math.min(state.currentLevel, LEVEL_COUNT);
  const nums = getNumbersForLevel(level);
  const known = nums.filter(n => isKnown(getNumberRecord(n))).length;
  const total = nums.length;
  const percent = total ? Math.round((known / total) * 100) : 100;
  const done = state.trophyShown && level === LEVEL_COUNT;
  return { level, levelCount: LEVEL_COUNT, known, total, percent, done };
}

/* ------------------------ Number selection ------------------------
   ~2/3 of the time: pick a number she's expected to know (box >= 3),
     weighted toward the ones seen longest ago (spaced repetition).
   ~1/3 of the time: pick a number still being learned (box < 3),
     weighted toward the ones she struggles with most / has seen least.
------------------------------------------------------------------- */

function pickNextTarget() {
  const pool = getUnlockedNumbers();
  const known = [];
  const learning = [];

  for (const n of pool) {
    const rec = getNumberRecord(n);
    (isKnown(rec) ? known : learning).push(n);
  }

  let candidates;
  if (known.length && learning.length) {
    candidates = (Math.random() < KNOWN_PICK_RATIO) ? known : learning;
  } else {
    candidates = known.length ? known : learning;
  }

  if (candidates.length > 1 && lastTarget !== null) {
    const filtered = candidates.filter(n => n !== lastTarget);
    if (filtered.length) candidates = filtered;
  }

  const weights = candidates.map(n => {
    const rec = getNumberRecord(n);
    if (isKnown(rec)) {
      const sinceSeen = Date.now() - (rec.lastSeen || 0);
      return 1 + sinceSeen / 60000;
    }
    return 1 + (KNOWN_BOX_THRESHOLD - rec.box) * 3 + Math.max(0, 3 - rec.attempts);
  });

  const n = weightedRandomPick(candidates, weights);
  lastTarget = n;
  return n;
}

function pickGameMode() {
  let candidates = GAME_MODES;
  if (lastMode !== null && candidates.length > 1) {
    const filtered = candidates.filter(m => m !== lastMode);
    if (filtered.length) candidates = filtered;
  }
  const mode = candidates[Math.floor(Math.random() * candidates.length)];
  lastMode = mode;
  return mode;
}

function weightedRandomPick(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Picks `count` distinct numbers near `target` (from the full 1-20 range,
// not just the unlocked pool — they're only used as multiple-choice
// decoys, not as something she needs to have practiced yet).
function pickDecoys(target, count) {
  const candidates = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) if (i !== target) candidates.push(i);
  const weights = candidates.map(c => 1 / (1 + Math.abs(c - target)));
  const chosen = [];
  const pool = [...candidates];
  const w = [...weights];
  for (let k = 0; k < count && pool.length; k++) {
    const idx = weightedIndexPick(w);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
    w.splice(idx, 1);
  }
  return chosen;
}

function weightedIndexPick(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------ Answer handling ------------------------ */

function recordAnswer(n, outcome) {
  const rec = getNumberRecord(n);
  rec.attempts += 1;
  rec.lastSeen = Date.now();
  state.totalAsked += 1;

  let levelEvent = null;

  if (outcome === 'correct') {
    rec.correct += 1;
    rec.box = Math.min(MAX_BOX, rec.box + 1);
    state.totalCorrect += 1;
    state.stars += 1;
    state.currentStreak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.currentStreak);
    maybeUnlockSticker();
    levelEvent = checkLevelCompletion();
  } else if (outcome === 'wrong') {
    rec.box = Math.max(0, rec.box - 1);
    state.currentStreak = 0;
  } else if (outcome === 'dontknow') {
    rec.box = Math.max(0, rec.box - 2);
    state.currentStreak = 0;
  }

  saveState();
  return levelEvent;
}

function maybeUnlockSticker() {
  const idx = STICKER_MILESTONES.indexOf(state.stars);
  if (idx !== -1 && idx < STICKER_SET.length && !state.unlockedStickers.includes(idx)) {
    state.unlockedStickers.push(idx);
    return STICKER_SET[idx];
  }
  return null;
}

/* ---------------------------- UI: elements ---------------------------- */

const el = {
  starCount: document.getElementById('starCount'),
  streakCount: document.getElementById('streakCount'),
  progressBtn: document.getElementById('progressBtn'),
  settingsBtn: document.getElementById('settingsBtn'),

  levelBadge: document.getElementById('levelBadge'),
  levelProgressText: document.getElementById('levelProgressText'),
  levelProgressFill: document.getElementById('levelProgressFill'),
  levelProgressHint: document.getElementById('levelProgressHint'),

  startScreen: document.getElementById('startScreen'),
  startBtn: document.getElementById('startBtn'),
  startHint: document.getElementById('startHint'),

  practiceScreen: document.getElementById('practiceScreen'),
  questionCard: document.getElementById('questionCard'),

  modeType: document.getElementById('modeType'),
  iconLabel: document.getElementById('iconLabel'),
  countScene: document.getElementById('countScene'),
  answerInput: document.getElementById('answerInput'),
  submitBtn: document.getElementById('submitBtn'),

  modeChoice: document.getElementById('modeChoice'),
  choiceScene: document.getElementById('choiceScene'),
  choiceButtons: document.getElementById('choiceButtons'),

  modeMatch: document.getElementById('modeMatch'),
  matchTargetNumeral: document.getElementById('matchTargetNumeral'),
  matchCards: document.getElementById('matchCards'),

  modeSequence: document.getElementById('modeSequence'),
  sequenceTiles: document.getElementById('sequenceTiles'),
  sequenceButtons: document.getElementById('sequenceButtons'),

  modeCompare: document.getElementById('modeCompare'),
  compareLeft: document.getElementById('compareLeft'),
  compareRight: document.getElementById('compareRight'),
  compareLeftScene: document.getElementById('compareLeftScene'),
  compareRightScene: document.getElementById('compareRightScene'),

  modeFeed: document.getElementById('modeFeed'),
  monsterOrder: document.getElementById('monsterOrder'),
  feedTray: document.getElementById('feedTray'),
  feedCount: document.getElementById('feedCount'),
  feedDoneBtn: document.getElementById('feedDoneBtn'),

  dontKnowBtn: document.getElementById('dontKnowBtn'),
  feedback: document.getElementById('feedback'),
  feedbackEmoji: document.getElementById('feedbackEmoji'),
  feedbackMessage: document.getElementById('feedbackMessage'),
  feedbackAnswer: document.getElementById('feedbackAnswer'),
  nextBtn: document.getElementById('nextBtn'),
  confettiLayer: document.getElementById('confettiLayer'),

  progressScreen: document.getElementById('progressScreen'),
  statStars: document.getElementById('statStars'),
  statBest: document.getElementById('statBest'),
  statKnown: document.getElementById('statKnown'),
  statTotal: document.getElementById('statTotal'),
  stickerBook: document.getElementById('stickerBook'),
  levelList: document.getElementById('levelList'),
  numberGrid: document.getElementById('numberGrid'),
  backFromProgressBtn: document.getElementById('backFromProgressBtn'),

  settingsScreen: document.getElementById('settingsScreen'),
  gateBox: document.getElementById('gateBox'),
  gateQuestion: document.getElementById('gateQuestion'),
  gateInput: document.getElementById('gateInput'),
  gateSubmit: document.getElementById('gateSubmit'),
  gateError: document.getElementById('gateError'),
  settingsBody: document.getElementById('settingsBody'),
  soundSelect: document.getElementById('soundSelect'),
  resetProgressBtn: document.getElementById('resetProgressBtn'),
  resetConfirmHint: document.getElementById('resetConfirmHint'),
  backFromSettingsBtn: document.getElementById('backFromSettingsBtn'),
};

const modePanels = [el.modeType, el.modeChoice, el.modeMatch, el.modeSequence, el.modeCompare, el.modeFeed];

const screens = [el.startScreen, el.practiceScreen, el.progressScreen, el.settingsScreen];

function showScreen(screen) {
  screens.forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

/* ---------------------------- Header stats ---------------------------- */

function refreshHeader() {
  el.starCount.textContent = state.stars;
  el.streakCount.textContent = state.currentStreak;
  refreshLevelBar();
}

function refreshLevelBar() {
  const d = levelProgressData();
  el.levelBadge.textContent = d.done
    ? `כל ${d.levelCount} השלבים הושלמו! 🏆`
    : `שלב ${d.level} מתוך ${d.levelCount}`;
  el.levelProgressText.textContent = `${d.known}/${d.total} ידועים`;
  el.levelProgressFill.style.width = d.percent + '%';
  el.levelProgressHint.textContent = levelHintText(d.percent, d.done);
}

function levelHintText(percent, done) {
  if (done) return 'היא אלופת הספירה! 🏆';
  if (percent >= 100) return 'השלב הושלם! 🎉';
  if (percent >= 75) return 'כמעט שם! 🌟';
  if (percent >= 50) return 'באמצע הדרך! 💪';
  if (percent >= 25) return 'מתקדמת יפה! 🚀';
  return 'רק מתחילות! 🌱';
}

/* ---------------------------- Start screen ---------------------------- */

function refreshStartHint() {
  if (state.totalAsked === 0) {
    el.startHint.textContent = '';
  } else {
    const knownCount = allNumbers().filter(n => isKnown(getNumberRecord(n))).length;
    el.startHint.textContent = `את כבר יודעת ${knownCount} מתוך ${TOTAL_NUMBERS} מספרים!`;
  }
}

/* ---------------------------- Practice screen ---------------------------- */

function startPractice() {
  showScreen(el.practiceScreen);
  nextQuestion();
}

const ICON_NAMES = {
  '🍎':'תפוחים','🌟':'כוכבים','🎈':'בלונים','🧸':'דובונים','🍓':'תותים',
  '🐰':'ארנבים','🦋':'פרפרים','🍩':'סופגניות','🌼':'פרחים','🐠':'דגים',
  '🍭':'סוכריות','🎁':'מתנות','🍪':'עוגיות','🐝':'דבורים','🌈':'קשתות',
  '🐬':'דולפינים','🍉':'אבטיחים','🐥':'אפרוחים','🦕':'דינוזאורים','🐧':'פינגווינים'
};

const RENDERERS = {
  type: renderTypeMode,
  choice: renderChoiceMode,
  match: renderMatchMode,
  sequence: renderSequenceMode,
  compare: renderCompareMode,
  feed: renderFeedMode,
};

function nextQuestion() {
  clearTimeout(stickerToastTimer);
  tickTimers.forEach(t => clearTimeout(t));
  tickTimers = [];

  el.feedback.classList.add('hidden');
  el.questionCard.classList.remove('hidden');
  el.dontKnowBtn.disabled = false;
  el.dontKnowBtn.classList.remove('hidden');

  modePanels.forEach(p => p.classList.add('hidden'));

  currentTarget = pickNextTarget();
  currentMode = pickGameMode();
  RENDERERS[currentMode](currentTarget);
}

function renderCountScene(container, icon, count, compact) {
  container.innerHTML = '';
  const size = compact
    ? (count <= 6 ? 30 : count <= 12 ? 24 : 18)
    : (count <= 6 ? 48 : count <= 12 ? 38 : 28);
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'count-icon';
    span.textContent = icon;
    span.style.fontSize = size + 'px';
    span.style.animationDelay = (i * 0.05) + 's';
    container.appendChild(span);
  }
}

function scheduleTicks(count) {
  for (let i = 0; i < count; i++) {
    const t = setTimeout(() => playSound('tick'), i * 70);
    tickTimers.push(t);
  }
}

function makeChoiceButtons(container, target, onPick) {
  const decoys = pickDecoys(target, 2);
  const options = shuffle([target, ...decoys]);
  container.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => onPick(opt));
    container.appendChild(btn);
  });
}

/* --- Mode: type the count (typed number, keyboard-first) --- */
function renderTypeMode(target) {
  el.modeType.classList.remove('hidden');
  el.answerInput.value = '';
  el.answerInput.disabled = false;
  el.submitBtn.disabled = false;
  const icon = pickRandom(ICON_SET);
  el.iconLabel.textContent = ICON_NAMES[icon] || 'דברים';
  renderCountScene(el.countScene, icon, target);
  scheduleTicks(target);
  el.answerInput.focus();
}

function submitAnswer() {
  const raw = el.answerInput.value.trim();
  if (raw === '') { el.answerInput.focus(); return; }
  const given = Number(raw);
  answerRound(given === currentTarget ? 'correct' : 'wrong');
}

/* --- Mode: multiple choice count (tap the right numeral) --- */
function renderChoiceMode(target) {
  el.modeChoice.classList.remove('hidden');
  const icon = pickRandom(ICON_SET);
  renderCountScene(el.choiceScene, icon, target);
  scheduleTicks(target);
  makeChoiceButtons(el.choiceButtons, target, (opt) => {
    answerRound(opt === target ? 'correct' : 'wrong');
  });
}

/* --- Mode: match a numeral to the picture group with that many --- */
function renderMatchMode(target) {
  el.modeMatch.classList.remove('hidden');
  el.matchTargetNumeral.textContent = target;
  const decoys = pickDecoys(target, 2);
  const cardCounts = shuffle([target, ...decoys]);
  const icons = shuffle(ICON_SET).slice(0, 3);
  el.matchCards.innerHTML = '';
  cardCounts.forEach((count, i) => {
    const card = document.createElement('button');
    card.className = 'match-card';
    const scene = document.createElement('div');
    scene.className = 'count-scene mini';
    card.appendChild(scene);
    card.addEventListener('click', () => answerRound(count === target ? 'correct' : 'wrong'));
    el.matchCards.appendChild(card);
    renderCountScene(scene, icons[i], count, true);
  });
}

/* --- Mode: what comes next (sequence with a blank tile) --- */
function renderSequenceMode(target) {
  el.modeSequence.classList.remove('hidden');
  const tiles = target >= 3
    ? [target - 2, target - 1, null]
    : [null, target + 1, target + 2];

  el.sequenceTiles.innerHTML = '';
  tiles.forEach(v => {
    const tile = document.createElement('div');
    tile.className = v === null ? 'sequence-tile blank' : 'sequence-tile';
    tile.textContent = v === null ? '❓' : v;
    el.sequenceTiles.appendChild(tile);
  });

  makeChoiceButtons(el.sequenceButtons, target, (opt) => {
    answerRound(opt === target ? 'correct' : 'wrong');
  });
}

/* --- Mode: which has more (compare two piles) --- */
function renderCompareMode(target) {
  el.modeCompare.classList.remove('hidden');
  // compareLeft/compareRight are fixed elements reused every round (only
  // their inner scene is rebuilt), so — unlike the other modes' buttons,
  // which are freshly created each round — they must be re-enabled here.
  el.compareLeft.disabled = false;
  el.compareRight.disabled = false;
  const deltaOptions = [-3, -2, -1, 1, 2, 3].filter(d => target + d >= 1 && target + d <= TOTAL_NUMBERS);
  const delta = pickRandom(deltaOptions);
  const other = target + delta;
  const targetOnRight = Math.random() < 0.5;
  compareRightCount = targetOnRight ? target : other;
  compareLeftCount = targetOnRight ? other : target;

  const rightIcon = pickRandom(ICON_SET);
  let leftIcon = pickRandom(ICON_SET);
  while (leftIcon === rightIcon) leftIcon = pickRandom(ICON_SET);

  renderCountScene(el.compareRightScene, rightIcon, compareRightCount, true);
  renderCountScene(el.compareLeftScene, leftIcon, compareLeftCount, true);

  const rightWins = compareRightCount > compareLeftCount;
  el.compareRight.onclick = () => answerRound(rightWins ? 'correct' : 'wrong');
  el.compareLeft.onclick = () => answerRound(!rightWins ? 'correct' : 'wrong');
}

/* --- Mode: feed the monster exactly N snacks --- */
function renderFeedMode(target) {
  el.modeFeed.classList.remove('hidden');
  el.feedDoneBtn.disabled = false; // fixed element reused every round
  el.monsterOrder.textContent = target;

  const extra = 2 + Math.floor(Math.random() * 3);
  const totalSnacks = Math.min(target + extra, TOTAL_NUMBERS + 4);
  const snackIcon = pickRandom(SNACK_ICONS);

  el.feedTray.innerHTML = '';
  let fedCount = 0;
  el.feedCount.textContent = fedCount;

  for (let i = 0; i < totalSnacks; i++) {
    const snack = document.createElement('button');
    snack.className = 'feed-snack';
    snack.textContent = snackIcon;
    snack.addEventListener('click', () => {
      const isFed = snack.classList.toggle('fed');
      fedCount += isFed ? 1 : -1;
      el.feedCount.textContent = fedCount;
      playSound('tick');
    });
    el.feedTray.appendChild(snack);
  }

  el.feedDoneBtn.onclick = () => {
    answerRound(fedCount === target ? 'correct' : 'wrong');
  };
}

function submitDontKnow() {
  answerRound('dontknow');
}

function disableActivePanel() {
  modePanels.forEach(p => {
    if (!p.classList.contains('hidden')) {
      p.querySelectorAll('button, input').forEach(elm => { elm.disabled = true; });
    }
  });
  el.dontKnowBtn.disabled = true;
}

function answerRound(outcome) {
  disableActivePanel();

  const target = currentTarget;
  const mode = currentMode;
  const levelEvent = recordAnswer(target, outcome);
  refreshHeader();

  el.questionCard.classList.add('hidden');
  el.feedback.classList.remove('hidden');

  let delay = 2600;

  if (outcome === 'correct') {
    el.feedbackEmoji.textContent = pickRandom(['🎉','⭐','🥳','🌈','🚀','🏆']);
    el.feedbackMessage.textContent = pickRandom(CORRECT_MESSAGES);
    el.feedbackAnswer.classList.add('hidden');
    launchConfetti();

    const newSticker = getNewestSticker();
    let soundKind = 'correct';

    if (newSticker && !levelEvent) {
      soundKind = 'sticker';
      clearTimeout(stickerToastTimer);
      stickerToastTimer = setTimeout(() => {
        el.feedbackMessage.textContent = `מדבקה חדשה נפתחה! ${newSticker}`;
      }, 700);
    }

    if (levelEvent && levelEvent.type === 'levelUp') {
      el.feedbackEmoji.textContent = '🆙';
      el.feedbackMessage.textContent = `שלב ${levelEvent.completedLevel} הושלם! שלב ${levelEvent.newLevel} נפתח! 🎉`;
      launchConfetti();
      soundKind = 'levelUp';
      delay = 3800;
    } else if (levelEvent && levelEvent.type === 'allComplete') {
      el.feedbackEmoji.textContent = '🏆';
      el.feedbackMessage.textContent = 'את יודעת לספור עד 20! אלופת הספירה! 🏆';
      launchConfetti();
      launchConfetti();
      soundKind = 'trophy';
      delay = 4200;
    }

    playSound(soundKind);
  } else {
    el.feedbackEmoji.textContent = '💡';
    el.feedbackMessage.textContent = pickRandom(GENTLE_MESSAGES);

    if (mode === 'compare') {
      const rightBigger = compareRightCount > compareLeftCount;
      el.feedbackAnswer.innerHTML =
        `<span class="${rightBigger ? 'compare-winner' : ''}">${compareRightCount}</span>` +
        ` ⚖️ ` +
        `<span class="${!rightBigger ? 'compare-winner' : ''}">${compareLeftCount}</span>`;
    } else {
      el.feedbackAnswer.textContent = `יש ${target}!`;
    }
    el.feedbackAnswer.classList.remove('hidden');
    el.feedback.classList.add('shake');
    setTimeout(() => el.feedback.classList.remove('shake'), 400);
    playSound('gentle');
  }

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(nextQuestion, delay);
}

function getNewestSticker() {
  const idx = STICKER_MILESTONES.indexOf(state.stars);
  if (idx !== -1 && idx < STICKER_SET.length && state.unlockedStickers.includes(idx)) {
    return STICKER_SET[idx];
  }
  return null;
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------------------- Confetti ---------------------------- */

function launchConfetti() {
  const colors = ['#F97316', '#EC4899', '#FBBF24', '#22C55E', '#38BDF8'];
  const count = 26;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    const duration = 1.4 + Math.random() * 1.2;
    piece.style.animationDuration = duration + 's';
    piece.style.opacity = String(0.7 + Math.random() * 0.3);
    el.confettiLayer.appendChild(piece);
    setTimeout(() => piece.remove(), duration * 1000 + 100);
  }
}

/* ---------------------------- Sound ---------------------------- */

let audioCtx = null;
function playSound(kind) {
  if (state.settings.sound !== 'on') return;
  const spec = SOUND_KINDS[kind] || SOUND_KINDS.correct;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    spec.notes.forEach((freq, i) => {
      const start = now + i * spec.noteDur;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = spec.type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + spec.noteDur * 2.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + spec.noteDur * 2.4);
    });
  } catch (e) { /* audio not available; ignore */ }
}

/* ---------------------------- Progress screen ---------------------------- */

function renderProgress() {
  const nums = allNumbers();
  const knownCount = nums.filter(n => isKnown(getNumberRecord(n))).length;

  el.statStars.textContent = state.stars;
  el.statBest.textContent = state.bestStreak;
  el.statKnown.textContent = knownCount;
  el.statTotal.textContent = TOTAL_NUMBERS;

  // Sticker book
  el.stickerBook.innerHTML = '';
  STICKER_MILESTONES.forEach((milestone, idx) => {
    const span = document.createElement('span');
    if (state.unlockedStickers.includes(idx)) {
      span.className = 'sticker';
      span.textContent = STICKER_SET[idx];
      span.title = `נפתח ב-${milestone} כוכבים`;
    } else {
      span.className = 'sticker-locked';
      span.textContent = '⭐';
      span.title = `נפתח ב-${milestone} כוכבים`;
    }
    el.stickerBook.appendChild(span);
  });

  renderLevelList();

  // Number grid
  el.numberGrid.innerHTML = '';
  for (let n = 1; n <= TOTAL_NUMBERS; n++) {
    const level = Math.ceil(n / NUMBERS_PER_LEVEL);
    const rec = getNumberRecord(n);
    const cell = document.createElement('div');
    let cls;
    if (level > state.currentLevel) {
      cls = 'locked';
      cell.textContent = '🔒';
      cell.title = `נעול — נפתח בשלב ${level}`;
    } else {
      cls = 'new';
      if (isMastered(rec)) cls = 'mastered';
      else if (isKnown(rec)) cls = 'known';
      else if (rec.attempts > 0) cls = 'learning';
      cell.textContent = n;
      cell.title = `מספר ${n}`;
    }
    cell.className = `number-cell ${cls}`;
    el.numberGrid.appendChild(cell);
  }
}

function renderLevelList() {
  el.levelList.innerHTML = '';
  for (let lvl = 1; lvl <= LEVEL_COUNT; lvl++) {
    const nums = getNumbersForLevel(lvl);
    const known = nums.filter(n => isKnown(getNumberRecord(n))).length;
    const total = nums.length;

    const isDone = lvl < state.currentLevel || (lvl === state.currentLevel && lvl === LEVEL_COUNT && state.trophyShown);
    const isCurrent = lvl === state.currentLevel && !isDone;

    const row = document.createElement('div');
    row.className = `level-row ${isDone ? 'done' : isCurrent ? 'current' : 'locked'}`;
    const status = isDone ? '✅' : isCurrent ? '🔓' : '🔒';
    const count = isDone || isCurrent ? `${known}/${total}` : 'נעול';
    const label = `שלב ${lvl} (${nums.join('-')})`;
    row.innerHTML = `<span class="level-row-status">${status}</span><span class="level-row-name">${label}</span><span class="level-row-count">${count}</span>`;
    el.levelList.appendChild(row);
  }
}

/* ---------------------------- Settings screen ---------------------------- */

let gateAnswer = null;

function openSettings() {
  showScreen(el.settingsScreen);
  el.settingsBody.classList.add('hidden');
  el.gateBox.classList.remove('hidden');
  el.gateError.classList.add('hidden');
  el.gateInput.value = '';
  const x = 2 + Math.floor(Math.random() * 6);
  const y = 2 + Math.floor(Math.random() * 6);
  gateAnswer = x + y;
  el.gateQuestion.textContent = `בדיקה מהירה: כמה זה ${x} + ${y}?`;
  el.gateInput.focus();
}

function checkGate() {
  const val = Number(el.gateInput.value.trim());
  if (val === gateAnswer) {
    el.gateBox.classList.add('hidden');
    el.settingsBody.classList.remove('hidden');
    el.soundSelect.value = state.settings.sound;
    el.resetConfirmHint.textContent = '';
  } else {
    el.gateError.classList.remove('hidden');
  }
}

function applySettings() {
  state.settings.sound = el.soundSelect.value;
  saveState();
}

function resetProgress() {
  state = defaultState();
  saveState();
  el.resetConfirmHint.textContent = 'כל ההתקדמות אופסה.';
  refreshHeader();
  refreshStartHint();
}

/* ---------------------------- Event wiring ---------------------------- */

el.startBtn.addEventListener('click', startPractice);

el.submitBtn.addEventListener('click', submitAnswer);
el.dontKnowBtn.addEventListener('click', submitDontKnow);
el.nextBtn.addEventListener('click', () => { clearTimeout(feedbackTimer); nextQuestion(); });
el.answerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer();
});

el.progressBtn.addEventListener('click', () => { renderProgress(); showScreen(el.progressScreen); });
el.backFromProgressBtn.addEventListener('click', () => { showScreen(el.startScreen); el.startBtn.focus(); });

el.settingsBtn.addEventListener('click', openSettings);
el.gateSubmit.addEventListener('click', checkGate);
el.gateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkGate(); });
el.soundSelect.addEventListener('change', applySettings);
el.resetProgressBtn.addEventListener('click', () => {
  if (confirm('לאפס את כל ההתקדמות בספירה? לא ניתן לבטל את זה.')) resetProgress();
});
el.backFromSettingsBtn.addEventListener('click', () => { refreshStartHint(); showScreen(el.startScreen); el.startBtn.focus(); });

/* ---------------------------- Keyboard-first flow ----------------------------
   Only the "type" mode has a text box, so keyboard typing/Enter-to-submit
   only applies there; the other modes are mouse-driven mini-games (there's
   no touchscreen, so a mouse click is the natural input for tapping a
   button, a picture card, or a snack). Enter/Space to advance once
   feedback is showing, and to start from the title screen, work in every
   mode since that part of the flow looks the same regardless of mode.
------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.target === el.answerInput) return;

  if (el.startScreen && !el.startScreen.classList.contains('hidden')) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startPractice();
    }
    return;
  }

  if (el.practiceScreen.classList.contains('hidden')) return;

  const feedbackVisible = !el.feedback.classList.contains('hidden');
  if (feedbackVisible) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearTimeout(feedbackTimer);
      nextQuestion();
    }
    return;
  }

  if (currentMode !== 'type') return;

  if (/^[0-9]$/.test(e.key)) {
    el.answerInput.focus();
    el.answerInput.value += e.key;
    e.preventDefault();
  } else if (e.key === 'Backspace') {
    el.answerInput.focus();
    el.answerInput.value = el.answerInput.value.slice(0, -1);
    e.preventDefault();
  } else if (e.key === 'Enter') {
    submitAnswer();
  }
});

/* ---------------------------- Init ---------------------------- */

refreshHeader();
refreshStartHint();
showScreen(el.startScreen);
el.startBtn.focus();
