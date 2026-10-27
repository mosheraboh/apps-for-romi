'use strict';

/* ---------------------------------------------------------------------
   לומדים ABC! (Learning ABC)
   A local, offline app for a Hebrew-speaking, non-English-speaking
   7-year-old to learn the English alphabet (both cases). Every round
   asks about one letter, but the question format rotates across four
   mini-games so it stays interesting:
   - Case match: given a letter in one case, tap it in the other case
   - Picture: given a classic mnemonic picture (🍎 for A, etc.), tap the
     matching letter
   - Sequence: tap the missing letter in a short alphabetical run
   - Letter hunt: find and tap every tile (either case) matching a
     target letter among decoys, then confirm
   None of these require reading a sentence — a persistent "🔊 hear it"
   button (Web Speech API, English voice) lets her hear the letter's
   name, since recognizing the *sound* of English letters is the whole
   point for a non-English speaker. All instructional text is Hebrew;
   all interaction is mouse/keyboard, no touchscreen assumed.
   - Tracks mastery per letter (A-Z) using a Leitner-style box (0-5).
   - Mixes ~2/3 practice from letters she's expected to know with ~1/3
     from letters she's still learning (spaced repetition).
   - Splits the alphabet into 13 levels (2 new letters each, in order:
     A,B then C,D ... Y,Z) so the alphabetical sequence itself stays
     learnable. Only letters from unlocked levels are asked; a level
     completes once both its letters are "known".
   - Rewards correct answers with stars, streaks, stickers, and sound.
   All progress is stored in this browser's localStorage on this Mac.
------------------------------------------------------------------------ */

const STORAGE_KEY = 'abcAppProgressV1';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const TOTAL_LETTERS = LETTERS.length; // 26
const LETTERS_PER_LEVEL = 2;
const LEVEL_COUNT = TOTAL_LETTERS / LETTERS_PER_LEVEL; // 13

const KNOWN_BOX_THRESHOLD = 3;
const MASTERED_BOX_THRESHOLD = 5;
const MAX_BOX = 5;
const KNOWN_PICK_RATIO = 2 / 3;

const GAME_MODES = ['case', 'picture', 'sequence', 'hunt'];

const LETTER_PICS = {
  A: '🍎', B: '🎈', C: '🐱', D: '🐶', E: '🥚', F: '🐸', G: '🦒', H: '🏠',
  I: '🍦', J: '🧃', K: '🔑', L: '🦁', M: '🌙', N: '🥜', O: '🐙', P: '🐷',
  Q: '👑', R: '🌈', S: '☀️', T: '🐯', U: '☂️', V: '🎻', W: '🐋', X: '🩻',
  Y: '🧶', Z: '🦓'
};

const STICKER_SET = ['🧸','🎈','🍭','🦄','🐣','🍓','🎨','🚀','🌈','🐬','🍩','🐥','🌻','🦕','🍉','🎪','🐧','🥳','🎁','🐝'];
const STICKER_MILESTONES = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000, 1200, 1500, 1800, 2200, 2600];

const CORRECT_MESSAGES = [
  "כן! מצוין! 🎉", "את כוכבת האלף-בית! ⭐", "כל הכבוד! 🙌", "וואו, כל כך מהר! ⚡",
  "הצלחת! 🎯", "איזו קריאה נהדרת! 🌈", "איזו ילדה חכמה! 🧠", "כן! מושלם! ✨"
];

const GENTLE_MESSAGES = [
  "זה בסדר! בואי ננסה שוב. 💪",
  "ניסיון טוב! בואי נזכור את זה. 💡",
  "אין דבר — בפעם הבאה יהיה לך! 🌟",
  "כמעט! בואי נמשיך לתרגל. 🌱"
];

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
    letters: {},        // "A" -> { box, attempts, correct, lastSeen }
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
let currentTarget = null;   // the letter currently being asked (e.g. "B")
let currentMode = null;
let lastTarget = null;
let lastMode = null;
let feedbackTimer = null;
let stickerToastTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, parsed, {
      letters: parsed.letters || {},
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

/* ---------------------------- Letters ---------------------------- */

function getLetterRecord(letter) {
  if (!state.letters[letter]) {
    state.letters[letter] = { letter, box: 0, attempts: 0, correct: 0, lastSeen: 0 };
  }
  return state.letters[letter];
}

function isKnown(rec) { return rec.box >= KNOWN_BOX_THRESHOLD; }
function isMastered(rec) { return rec.box >= MASTERED_BOX_THRESHOLD; }

/* ------------------------ Levels ------------------------
   Level k covers letters at alphabet positions (2k-2) and (2k-1) (0-based),
   so the alphabet is learned in order: Level 1 = A,B ... Level 13 = Y,Z.
------------------------------------------------------------------- */

function getLettersForLevel(level) {
  const start = (level - 1) * LETTERS_PER_LEVEL;
  return LETTERS.slice(start, start + LETTERS_PER_LEVEL);
}

function getUnlockedLetters() {
  const maxUnlocked = Math.min(state.currentLevel * LETTERS_PER_LEVEL, TOTAL_LETTERS);
  return LETTERS.slice(0, maxUnlocked);
}

function checkLevelCompletion() {
  const letters = getLettersForLevel(state.currentLevel);
  const allKnown = letters.length > 0 && letters.every(l => isKnown(getLetterRecord(l)));
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
  const letters = getLettersForLevel(level);
  const known = letters.filter(l => isKnown(getLetterRecord(l))).length;
  const total = letters.length;
  const percent = total ? Math.round((known / total) * 100) : 100;
  const done = state.trophyShown && level === LEVEL_COUNT;
  return { level, levelCount: LEVEL_COUNT, known, total, percent, done };
}

/* ------------------------ Letter selection ------------------------
   ~2/3 of the time: pick a letter she's expected to know (box >= 3),
     weighted toward the ones seen longest ago (spaced repetition).
   ~1/3 of the time: pick a letter still being learned (box < 3),
     weighted toward the ones she struggles with most / has seen least.
------------------------------------------------------------------- */

function pickNextTarget() {
  const pool = getUnlockedLetters();
  const known = [];
  const learning = [];

  for (const l of pool) {
    const rec = getLetterRecord(l);
    (isKnown(rec) ? known : learning).push(l);
  }

  let candidates;
  if (known.length && learning.length) {
    candidates = (Math.random() < KNOWN_PICK_RATIO) ? known : learning;
  } else {
    candidates = known.length ? known : learning;
  }

  if (candidates.length > 1 && lastTarget !== null) {
    const filtered = candidates.filter(l => l !== lastTarget);
    if (filtered.length) candidates = filtered;
  }

  const weights = candidates.map(l => {
    const rec = getLetterRecord(l);
    if (isKnown(rec)) {
      const sinceSeen = Date.now() - (rec.lastSeen || 0);
      return 1 + sinceSeen / 60000;
    }
    return 1 + (KNOWN_BOX_THRESHOLD - rec.box) * 3 + Math.max(0, 3 - rec.attempts);
  });

  const l = weightedRandomPick(candidates, weights);
  lastTarget = l;
  return l;
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

// Picks `count` distinct letters near `target` in the alphabet (from the
// full A-Z range — they're multiple-choice decoys, not something she
// needs to have practiced yet).
function pickDecoys(target, count) {
  const targetIdx = LETTERS.indexOf(target);
  const candidates = LETTERS.filter(l => l !== target);
  const weights = candidates.map(l => 1 / (1 + Math.abs(LETTERS.indexOf(l) - targetIdx)));
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

function recordAnswer(letter, outcome) {
  const rec = getLetterRecord(letter);
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

  modeCase: document.getElementById('modeCase'),
  caseTargetLetter: document.getElementById('caseTargetLetter'),
  caseButtons: document.getElementById('caseButtons'),

  modePicture: document.getElementById('modePicture'),
  pictureEmoji: document.getElementById('pictureEmoji'),
  pictureButtons: document.getElementById('pictureButtons'),

  modeSequence: document.getElementById('modeSequence'),
  sequenceTiles: document.getElementById('sequenceTiles'),
  sequenceButtons: document.getElementById('sequenceButtons'),

  modeHunt: document.getElementById('modeHunt'),
  huntTargetLetters: document.getElementById('huntTargetLetters'),
  huntTray: document.getElementById('huntTray'),
  huntCount: document.getElementById('huntCount'),
  huntDoneBtn: document.getElementById('huntDoneBtn'),

  hearBtn: document.getElementById('hearBtn'),
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
  letterGrid: document.getElementById('letterGrid'),
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

const modePanels = [el.modeCase, el.modePicture, el.modeSequence, el.modeHunt];
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
  el.levelProgressText.textContent = `${d.known}/${d.total} ידועות`;
  el.levelProgressFill.style.width = d.percent + '%';
  el.levelProgressHint.textContent = levelHintText(d.percent, d.done);
}

function levelHintText(percent, done) {
  if (done) return 'היא אלופת האלף-בית! 🏆';
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
    const knownCount = LETTERS.filter(l => isKnown(getLetterRecord(l))).length;
    el.startHint.textContent = `את כבר יודעת ${knownCount} מתוך ${TOTAL_LETTERS} אותיות!`;
  }
}

/* ---------------------------- Practice screen ---------------------------- */

function startPractice() {
  showScreen(el.practiceScreen);
  nextQuestion();
}

const RENDERERS = {
  case: renderCaseMode,
  picture: renderPictureMode,
  sequence: renderSequenceMode,
  hunt: renderHuntMode,
};

function nextQuestion() {
  clearTimeout(stickerToastTimer);

  el.feedback.classList.add('hidden');
  el.questionCard.classList.remove('hidden');
  el.dontKnowBtn.disabled = false;

  modePanels.forEach(p => p.classList.add('hidden'));

  currentTarget = pickNextTarget();
  currentMode = pickGameMode();
  RENDERERS[currentMode](currentTarget);
  // Say the letter's name as each question appears — for a first
  // exposure to a new alphabet, hearing it shouldn't depend on her
  // remembering to tap the "hear it" button; that stays as a repeat.
  speakLetter(currentTarget);
}

function makeLetterButtons(container, choices, onPick) {
  container.innerHTML = '';
  choices.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn letter-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => onPick(opt));
    container.appendChild(btn);
  });
}

/* --- Mode: case match (given one case, tap the other) --- */
function renderCaseMode(target) {
  el.modeCase.classList.remove('hidden');
  const showUpper = Math.random() < 0.5;
  el.caseTargetLetter.textContent = showUpper ? target : target.toLowerCase();

  const correctOpt = showUpper ? target.toLowerCase() : target;
  const decoys = pickDecoys(target, 2).map(l => showUpper ? l.toLowerCase() : l);
  const options = shuffle([correctOpt, ...decoys]);
  makeLetterButtons(el.caseButtons, options, (opt) => {
    answerRound(opt === correctOpt ? 'correct' : 'wrong');
  });
}

/* --- Mode: picture mnemonic --- */
function renderPictureMode(target) {
  el.modePicture.classList.remove('hidden');
  el.pictureEmoji.textContent = LETTER_PICS[target] || '❓';
  const decoys = pickDecoys(target, 2);
  const options = shuffle([target, ...decoys]);
  makeLetterButtons(el.pictureButtons, options, (opt) => {
    answerRound(opt === target ? 'correct' : 'wrong');
  });
}

/* --- Mode: alphabet sequence (what comes next) --- */
function renderSequenceMode(target) {
  el.modeSequence.classList.remove('hidden');
  const idx = LETTERS.indexOf(target);
  const tileIdxs = idx >= 2
    ? [idx - 2, idx - 1, null]
    : [null, idx + 1, idx + 2];

  el.sequenceTiles.innerHTML = '';
  tileIdxs.forEach(i => {
    const tile = document.createElement('div');
    tile.className = i === null ? 'sequence-tile blank' : 'sequence-tile';
    tile.textContent = i === null ? '❓' : LETTERS[i];
    el.sequenceTiles.appendChild(tile);
  });

  const decoys = pickDecoys(target, 2);
  const options = shuffle([target, ...decoys]);
  makeLetterButtons(el.sequenceButtons, options, (opt) => {
    answerRound(opt === target ? 'correct' : 'wrong');
  });
}

/* --- Mode: letter hunt (find & tap every tile matching target) --- */
function renderHuntMode(target) {
  el.modeHunt.classList.remove('hidden');
  el.huntDoneBtn.disabled = false; // fixed element reused every round
  el.huntTargetLetters.textContent = target + target.toLowerCase();

  // A smaller tray (one pickDecoys call, so decoys can't repeat) keeps
  // this mode from being an all-or-nothing gotcha: fewer tiles means
  // fewer chances to miss or mis-tap one by accident.
  const decoyLetters = pickDecoys(target, 4);
  const tiles = [
    { letter: target, match: true },
    { letter: target.toLowerCase(), match: true },
  ];
  decoyLetters.forEach(l => {
    tiles.push({ letter: Math.random() < 0.5 ? l : l.toLowerCase(), match: false });
  });

  const shuffled = shuffle(tiles);
  el.huntTray.innerHTML = '';
  let pickedCount = 0;
  el.huntCount.textContent = pickedCount;

  shuffled.forEach(({ letter, match }) => {
    const tile = document.createElement('button');
    tile.className = 'hunt-tile';
    tile.textContent = letter;
    tile.dataset.match = match ? '1' : '0';
    tile.addEventListener('click', () => {
      const isPicked = tile.classList.toggle('picked');
      pickedCount += isPicked ? 1 : -1;
      el.huntCount.textContent = pickedCount;
      playSound('tick');
    });
    el.huntTray.appendChild(tile);
  });

  el.huntDoneBtn.onclick = () => {
    const allTiles = [...el.huntTray.querySelectorAll('.hunt-tile')];
    const correct = allTiles.every(t => t.classList.contains('picked') === (t.dataset.match === '1'));
    answerRound(correct ? 'correct' : 'wrong');
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
      el.feedbackMessage.textContent = 'את מכירה את כל האלף-בית! אלופת ה-ABC! 🏆';
      launchConfetti();
      launchConfetti();
      soundKind = 'trophy';
      delay = 4200;
    }

    playSound(soundKind);
  } else {
    el.feedbackEmoji.textContent = '💡';
    el.feedbackMessage.textContent = pickRandom(GENTLE_MESSAGES);
    el.feedbackAnswer.innerHTML = `זאת האות <span class="reveal-letter">${target}${target.toLowerCase()}</span>`;
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
  const colors = ['#4F46E5', '#EC4899', '#FBBF24', '#22C55E', '#38BDF8'];
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

// Separate from the reward chimes above: lets her hear the letter's
// English name, independent of the sound-effects on/off setting, since
// it's instructional content (the whole point for a non-English
// speaker) rather than a reward cue.
function speakLetter(letter) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(letter);
    utter.lang = 'en-US';
    utter.rate = 0.8;
    window.speechSynthesis.speak(utter);
  } catch (e) { /* speech synthesis not available; ignore */ }
}

/* ---------------------------- Progress screen ---------------------------- */

function renderProgress() {
  const knownCount = LETTERS.filter(l => isKnown(getLetterRecord(l))).length;

  el.statStars.textContent = state.stars;
  el.statBest.textContent = state.bestStreak;
  el.statKnown.textContent = knownCount;
  el.statTotal.textContent = TOTAL_LETTERS;

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

  // Letter grid
  el.letterGrid.innerHTML = '';
  LETTERS.forEach((letter, i) => {
    const level = Math.ceil((i + 1) / LETTERS_PER_LEVEL);
    const rec = getLetterRecord(letter);
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
      cell.textContent = letter + letter.toLowerCase();
      cell.title = `האות ${letter}`;
    }
    cell.className = `letter-cell ${cls}`;
    el.letterGrid.appendChild(cell);
  });
}

function renderLevelList() {
  el.levelList.innerHTML = '';
  for (let lvl = 1; lvl <= LEVEL_COUNT; lvl++) {
    const letters = getLettersForLevel(lvl);
    const known = letters.filter(l => isKnown(getLetterRecord(l))).length;
    const total = letters.length;

    const isDone = lvl < state.currentLevel || (lvl === state.currentLevel && lvl === LEVEL_COUNT && state.trophyShown);
    const isCurrent = lvl === state.currentLevel && !isDone;

    const row = document.createElement('div');
    row.className = `level-row ${isDone ? 'done' : isCurrent ? 'current' : 'locked'}`;
    const status = isDone ? '✅' : isCurrent ? '🔓' : '🔒';
    const count = isDone || isCurrent ? `${known}/${total}` : 'נעול';
    const label = `שלב ${lvl} (${letters.join('-')})`;
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

el.hearBtn.addEventListener('click', () => { if (currentTarget) speakLetter(currentTarget); });
el.dontKnowBtn.addEventListener('click', submitDontKnow);
el.nextBtn.addEventListener('click', () => { clearTimeout(feedbackTimer); nextQuestion(); });

el.progressBtn.addEventListener('click', () => { renderProgress(); showScreen(el.progressScreen); });
el.backFromProgressBtn.addEventListener('click', () => { showScreen(el.startScreen); el.startBtn.focus(); });

el.settingsBtn.addEventListener('click', openSettings);
el.gateSubmit.addEventListener('click', checkGate);
el.gateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkGate(); });
el.soundSelect.addEventListener('change', applySettings);
el.resetProgressBtn.addEventListener('click', () => {
  if (confirm('לאפס את כל ההתקדמות באלף-בית? לא ניתן לבטל את זה.')) resetProgress();
});
el.backFromSettingsBtn.addEventListener('click', () => { refreshStartHint(); showScreen(el.startScreen); el.startBtn.focus(); });

/* ---------------------------- Keyboard support ----------------------------
   All games here are mouse-driven (letters, not typed numbers, and no
   touchscreen to assume) — but Enter/Space still works to start from the
   title screen and to jump straight to the next question once feedback
   is showing, instead of waiting for the auto-advance timer.
------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  if (el.startScreen && !el.startScreen.classList.contains('hidden')) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startPractice();
    }
    return;
  }

  if (el.practiceScreen.classList.contains('hidden')) return;

  const feedbackVisible = !el.feedback.classList.contains('hidden');
  if (feedbackVisible && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    clearTimeout(feedbackTimer);
    nextQuestion();
  }
});

/* ---------------------------- Init ---------------------------- */

refreshHeader();
refreshStartHint();
showScreen(el.startScreen);
el.startBtn.focus();
