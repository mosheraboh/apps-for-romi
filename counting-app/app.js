'use strict';

/* ---------------------------------------------------------------------
   Let's Count!
   A local, offline counting practice app for a young learner:
   - Shows a picture of N objects and asks "how many?"; she types the
     number (no reading required beyond digits).
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

const STICKER_SET = ['🧸','🎈','🍭','🦄','🐣','🍓','🎨','🚀','🌈','🐬','🍩','🐥','🌻','🦕','🍉','🎪','🐧','🥳','🎁','🐝'];
const STICKER_MILESTONES = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000, 1200, 1500, 1800, 2200, 2600];

const CORRECT_MESSAGES = [
  "Yay! You counted them all! 🎉", "You're a counting star! ⭐", "Super job! 🙌", "Wow, so fast! ⚡",
  "You got it! 🎯", "Fantastic counting! 🌈", "Great job! 🧠", "Yes! Perfect! ✨"
];

const GENTLE_MESSAGES = [
  "That's okay! Let's count them again. 💪",
  "Good try! Let's remember this one. 💡",
  "No worries — you'll get it next time! 🌟",
  "Almost! Let's keep practicing. 🌱"
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
let lastTarget = null;
let feedbackTimer = null;
let stickerToastTimer = null;
let tickTimers = [];

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

function weightedRandomPick(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
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
  iconLabel: document.getElementById('iconLabel'),
  countScene: document.getElementById('countScene'),
  answerInput: document.getElementById('answerInput'),
  submitBtn: document.getElementById('submitBtn'),
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
    ? `All ${d.levelCount} levels complete! 🏆`
    : `Level ${d.level} of ${d.levelCount}`;
  el.levelProgressText.textContent = `${d.known}/${d.total} known`;
  el.levelProgressFill.style.width = d.percent + '%';
  el.levelProgressHint.textContent = levelHintText(d.percent, d.done);
}

function levelHintText(percent, done) {
  if (done) return "She's a Counting Champion! 🏆";
  if (percent >= 100) return 'Level complete! 🎉';
  if (percent >= 75) return 'So close! 🌟';
  if (percent >= 50) return 'Halfway there! 💪';
  if (percent >= 25) return 'Making progress! 🚀';
  return 'Just getting started! 🌱';
}

/* ---------------------------- Start screen ---------------------------- */

function refreshStartHint() {
  if (state.totalAsked === 0) {
    el.startHint.textContent = '';
  } else {
    const knownCount = allNumbers().filter(n => isKnown(getNumberRecord(n))).length;
    el.startHint.textContent = `You know ${knownCount} of ${TOTAL_NUMBERS} numbers so far!`;
  }
}

/* ---------------------------- Practice screen ---------------------------- */

function startPractice() {
  showScreen(el.practiceScreen);
  nextQuestion();
}

const ICON_NAMES = {
  '🍎':'apples','🌟':'stars','🎈':'balloons','🧸':'teddy bears','🍓':'strawberries',
  '🐰':'bunnies','🦋':'butterflies','🍩':'donuts','🌼':'flowers','🐠':'fish',
  '🍭':'lollipops','🎁':'presents','🍪':'cookies','🐝':'bees','🌈':'rainbows',
  '🐬':'dolphins','🍉':'watermelons','🐥':'chicks','🦕':'dinosaurs','🐧':'penguins'
};

function nextQuestion() {
  clearTimeout(stickerToastTimer);
  tickTimers.forEach(t => clearTimeout(t));
  tickTimers = [];

  el.feedback.classList.add('hidden');
  el.questionCard.classList.remove('hidden');
  el.answerInput.value = '';
  el.answerInput.disabled = false;
  el.submitBtn.disabled = false;
  el.dontKnowBtn.disabled = false;

  currentTarget = pickNextTarget();
  const icon = pickRandom(ICON_SET);
  el.iconLabel.textContent = ICON_NAMES[icon] || 'items';

  renderCountScene(icon, currentTarget);
  el.answerInput.focus();
}

function renderCountScene(icon, count) {
  el.countScene.innerHTML = '';
  const size = count <= 6 ? 48 : count <= 12 ? 38 : 28;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'count-icon';
    span.textContent = icon;
    span.style.fontSize = size + 'px';
    span.style.animationDelay = (i * 0.07) + 's';
    el.countScene.appendChild(span);
    const t = setTimeout(() => playSound('tick'), i * 70);
    tickTimers.push(t);
  }
}

function submitAnswer() {
  const raw = el.answerInput.value.trim();
  if (raw === '') { el.answerInput.focus(); return; }
  const given = Number(raw);
  finishQuestion(given === currentTarget ? 'correct' : 'wrong');
}

function submitDontKnow() {
  finishQuestion('dontknow');
}

function finishQuestion(outcome) {
  el.answerInput.disabled = true;
  el.submitBtn.disabled = true;
  el.dontKnowBtn.disabled = true;

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
        el.feedbackMessage.textContent = `New sticker unlocked! ${newSticker}`;
      }, 700);
    }

    if (levelEvent && levelEvent.type === 'levelUp') {
      el.feedbackEmoji.textContent = '🆙';
      el.feedbackMessage.textContent = `Level ${levelEvent.completedLevel} complete! Level ${levelEvent.newLevel} unlocked! 🎉`;
      launchConfetti();
      soundKind = 'levelUp';
      delay = 3800;
    } else if (levelEvent && levelEvent.type === 'allComplete') {
      el.feedbackEmoji.textContent = '🏆';
      el.feedbackMessage.textContent = 'You can count all the way to 20! Counting Champion! 🏆';
      launchConfetti();
      launchConfetti();
      soundKind = 'trophy';
      delay = 4200;
    }

    playSound(soundKind);
  } else {
    el.feedbackEmoji.textContent = '💡';
    el.feedbackMessage.textContent = pickRandom(GENTLE_MESSAGES);
    el.feedbackAnswer.textContent = `There are ${target}!`;
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
      span.title = `Unlocked at ${milestone} stars`;
    } else {
      span.className = 'sticker-locked';
      span.textContent = '⭐';
      span.title = `Unlocks at ${milestone} stars`;
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
      cell.title = `Locked — unlocks at Level ${level}`;
    } else {
      cls = 'new';
      if (isMastered(rec)) cls = 'mastered';
      else if (isKnown(rec)) cls = 'known';
      else if (rec.attempts > 0) cls = 'learning';
      cell.textContent = n;
      cell.title = `Number ${n}`;
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
    const count = isDone || isCurrent ? `${known}/${total}` : 'Locked';
    const label = `Level ${lvl} (${nums.join('-')})`;
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
  el.gateQuestion.textContent = `Quick check: what's ${x} + ${y}?`;
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
  el.resetConfirmHint.textContent = 'All progress has been reset.';
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
el.backFromProgressBtn.addEventListener('click', () => showScreen(el.startScreen));

el.settingsBtn.addEventListener('click', openSettings);
el.gateSubmit.addEventListener('click', checkGate);
el.gateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkGate(); });
el.soundSelect.addEventListener('change', applySettings);
el.resetProgressBtn.addEventListener('click', () => {
  if (confirm("Reset all counting progress? This can't be undone.")) resetProgress();
});
el.backFromSettingsBtn.addEventListener('click', () => { refreshStartHint(); showScreen(el.startScreen); });

/* ---------------------------- Init ---------------------------- */

refreshHeader();
refreshStartHint();
showScreen(el.startScreen);
