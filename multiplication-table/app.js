'use strict';

/* ---------------------------------------------------------------------
   Romi's Times Tables
   A local, offline practice app that:
   - Asks one multiplication fact at a time (typed answer, or "I don't know")
   - Tracks mastery per fact using a Leitner-style box (0-5)
   - Mixes ~1/2 practice from facts she's expected to know with
     ~1/2 from facts she's still learning (spaced repetition), and
     avoids repeating any of the last few questions when possible
   - Rewards correct answers with stars, streaks, and stickers
   - Splits the times table into 10 levels, taught in the order kids
     usually find easiest (1s, 2s, 10s, 5s, 3s, 4s, 6s, 9s, 7s, 8s).
     Only facts from unlocked levels are asked; a level is complete once
     every fact in it is "known", which unlocks the next one.
   All progress is stored in this browser's localStorage on this Mac.
------------------------------------------------------------------------ */

const STORAGE_KEY = 'romiMultiplicationProgressV1';
const KNOWN_BOX_THRESHOLD = 2;   // box >= 2 => "known"
const MASTERED_BOX_THRESHOLD = 5; // box >= 5 => "mastered" (darker green)
const MAX_BOX = 5;
const KNOWN_PICK_RATIO = 1 / 2;  // ~1/2 of questions from known facts (was 2/3 — leveling up dragged on)
const RECENT_AVOID_WINDOW = 3;   // don't repeat any of the last N facts if the pool allows it

const STICKER_SET = ['🦄','🌈','🐱','🍦','🎈','🦋','🍭','🎨','🚀','🌟','🐬','🍩','🐢','🌻','🦕','🍓','🎪','🐧','🍉','🥳'];
const STICKER_MILESTONES = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000, 1200, 1500, 1800, 2200, 2600];

const CORRECT_MESSAGES = [
  "Amazing! 🎉", "You're a math star! ⭐", "Super job! 🙌", "Wow, so fast! ⚡",
  "You nailed it! 🎯", "Fantastic! 🌈", "Brainy! 🧠", "Yes! Perfect! ✨"
];

const GENTLE_MESSAGES = [
  "That's okay! We'll practice this one again. 💪",
  "Good try! Let's remember this one together. 💡",
  "No worries — you'll get it next time! 🌟",
  "Almost! Let's keep practicing this one. 🌱"
];

// Numbers introduced roughly easiest-first. Facts are grouped into levels
// by whichever of their two factors is introduced first.
const LEVEL_INTRO_ORDER = [1, 2, 10, 5, 3, 4, 6, 9, 7, 8, 11, 12];
const TARGET_LEVEL_COUNT = 10;

/* ---------------------------- State ---------------------------- */

function defaultState() {
  return {
    facts: {},          // id -> { a, b, box, attempts, correct, lastSeen }
    stars: 0,
    currentStreak: 0,
    bestStreak: 0,
    totalCorrect: 0,
    totalAsked: 0,
    unlockedStickers: [],
    currentLevel: 1,
    trophyShown: false,
    settings: { maxTable: 10, sound: 'on' }
  };
}

let state = loadState();
let currentFact = null;   // { id, a, b }
let recentFactIds = [];   // short history, to avoid repeating recent questions
let feedbackTimer = null;
let stickerToastTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, parsed, {
      facts: parsed.facts || {},
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

/* ---------------------------- Facts ---------------------------- */

function factId(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return `${lo}x${hi}`;
}

function allFactIds() {
  const max = state.settings.maxTable;
  const ids = [];
  for (let a = 1; a <= max; a++) {
    for (let b = a; b <= max; b++) {
      ids.push(factId(a, b));
    }
  }
  return ids;
}

function getFactRecord(id) {
  if (!state.facts[id]) {
    const [a, b] = id.split('x').map(Number);
    state.facts[id] = { a, b, box: 0, attempts: 0, correct: 0, lastSeen: 0 };
  }
  return state.facts[id];
}

function isKnown(rec) { return rec.box >= KNOWN_BOX_THRESHOLD; }
function isMastered(rec) { return rec.box >= MASTERED_BOX_THRESHOLD; }

/* ------------------------ Levels ------------------------
   The times table is split into levels (10 by default; fewer only if a
   smaller table range is chosen in settings). Level groups are built from
   LEVEL_INTRO_ORDER, chunked as evenly as possible; a fact belongs to
   whichever level introduces the EARLIER of its two factors, matching how
   a "times table" is taught (e.g. 3 x 4 is learned as part of the 3s).
------------------------------------------------------------------- */

function getLevelGroups(maxTable) {
  const numbers = LEVEL_INTRO_ORDER.filter(n => n <= maxTable);
  const levelCount = Math.min(TARGET_LEVEL_COUNT, numbers.length);
  const base = Math.floor(numbers.length / levelCount);
  const rem = numbers.length % levelCount;
  const groups = [];
  let idx = 0;
  for (let i = 0; i < levelCount; i++) {
    const size = base + (i < rem ? 1 : 0);
    groups.push(numbers.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

function getNumberLevelMap(maxTable) {
  const groups = getLevelGroups(maxTable);
  const map = {};
  groups.forEach((nums, i) => nums.forEach(n => { map[n] = i + 1; }));
  return map;
}

function getLevelCount() {
  return getLevelGroups(state.settings.maxTable).length;
}

function getFactsForLevel(level) {
  const map = getNumberLevelMap(state.settings.maxTable);
  return allFactIds().filter(id => {
    const rec = getFactRecord(id);
    return Math.min(map[rec.a], map[rec.b]) === level;
  });
}

function getUnlockedFactIds() {
  const map = getNumberLevelMap(state.settings.maxTable);
  return allFactIds().filter(id => {
    const rec = getFactRecord(id);
    return Math.min(map[rec.a], map[rec.b]) <= state.currentLevel;
  });
}

function checkLevelCompletion() {
  const levelCount = getLevelCount();
  const facts = getFactsForLevel(state.currentLevel);
  const allKnown = facts.length > 0 && facts.every(id => isKnown(getFactRecord(id)));
  if (!allKnown) return null;

  if (state.currentLevel < levelCount) {
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
  const levelCount = getLevelCount();
  const level = Math.min(state.currentLevel, levelCount);
  const facts = getFactsForLevel(level);
  const known = facts.filter(id => isKnown(getFactRecord(id))).length;
  const total = facts.length;
  const percent = total ? Math.round((known / total) * 100) : 100;
  const done = state.trophyShown && level === levelCount;
  return { level, levelCount, known, total, percent, done };
}

/* ------------------------ Fact selection ------------------------
   ~1/2 of the time: pick from facts she's expected to know (box >= 2),
     weighted toward the ones seen longest ago (spaced repetition).
   ~1/2 of the time: pick from facts still being learned (box < 2),
     weighted toward the ones she struggles with most / has seen least.
   Falls back gracefully when one bucket is empty, and avoids repeating
   any of the last few questions asked when the pool is large enough to.
------------------------------------------------------------------- */

function pickNextFact() {
  const ids = getUnlockedFactIds();
  const known = [];
  const learning = [];

  for (const id of ids) {
    const rec = getFactRecord(id);
    (isKnown(rec) ? known : learning).push(id);
  }

  let pool;
  if (known.length && learning.length) {
    pool = (Math.random() < KNOWN_PICK_RATIO) ? known : learning;
  } else {
    pool = known.length ? known : learning;
  }

  // Avoid repeating anything asked recently, shrinking the exclusion
  // window if the pool is too small to honor it fully.
  for (let window = RECENT_AVOID_WINDOW; window > 0; window--) {
    const recent = recentFactIds.slice(-window);
    const filtered = pool.filter(id => !recent.includes(id));
    if (filtered.length) { pool = filtered; break; }
  }

  const weights = pool.map(id => {
    const rec = getFactRecord(id);
    if (isKnown(rec)) {
      // Spaced repetition: longer since last seen => higher weight.
      const sinceSeen = Date.now() - (rec.lastSeen || 0);
      return 1 + sinceSeen / 60000; // minutes since last seen, plus base
    } else {
      // Prioritize lower box (struggling more) and fewer attempts.
      return 1 + (KNOWN_BOX_THRESHOLD - rec.box) * 3 + Math.max(0, 3 - rec.attempts);
    }
  });

  const id = weightedRandomPick(pool, weights);
  const rec = getFactRecord(id);
  recentFactIds.push(id);
  if (recentFactIds.length > RECENT_AVOID_WINDOW) recentFactIds.shift();

  // Randomize presentation order (a x b vs b x a) for variety.
  const flip = Math.random() < 0.5;
  const a = flip ? rec.b : rec.a;
  const b = flip ? rec.a : rec.b;
  return { id, a, b };
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

function recordAnswer(id, outcome) {
  // outcome: 'correct' | 'wrong' | 'dontknow'
  const rec = getFactRecord(id);
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
  questionText: document.getElementById('questionText'),
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
  factGrid: document.getElementById('factGrid'),
  backFromProgressBtn: document.getElementById('backFromProgressBtn'),

  settingsScreen: document.getElementById('settingsScreen'),
  gateBox: document.getElementById('gateBox'),
  gateQuestion: document.getElementById('gateQuestion'),
  gateInput: document.getElementById('gateInput'),
  gateSubmit: document.getElementById('gateSubmit'),
  gateError: document.getElementById('gateError'),
  settingsBody: document.getElementById('settingsBody'),
  maxTableSelect: document.getElementById('maxTableSelect'),
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
  if (done) return "You're a Times Tables Champion! 🏆";
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
    const knownCount = allFactIds().filter(id => isKnown(getFactRecord(id))).length;
    el.startHint.textContent = `You know ${knownCount} of ${allFactIds().length} facts so far!`;
  }
}

/* ---------------------------- Practice screen ---------------------------- */

function startPractice() {
  showScreen(el.practiceScreen);
  nextQuestion();
}

function nextQuestion() {
  clearTimeout(stickerToastTimer);
  el.feedback.classList.add('hidden');
  el.questionCard.classList.remove('hidden');
  el.answerInput.value = '';
  el.answerInput.disabled = false;
  el.submitBtn.disabled = false;
  el.dontKnowBtn.disabled = false;

  currentFact = pickNextFact();
  el.questionText.textContent = `${currentFact.a} × ${currentFact.b}`;
  el.answerInput.focus();
}

function submitAnswer() {
  const raw = el.answerInput.value.trim();
  if (raw === '') { el.answerInput.focus(); return; }
  const given = Number(raw);
  const correctAnswer = currentFact.a * currentFact.b;
  const isCorrect = given === correctAnswer;
  finishQuestion(isCorrect ? 'correct' : 'wrong', correctAnswer);
}

function submitDontKnow() {
  const correctAnswer = currentFact.a * currentFact.b;
  finishQuestion('dontknow', correctAnswer);
}

function finishQuestion(outcome, correctAnswer) {
  el.answerInput.disabled = true;
  el.submitBtn.disabled = true;
  el.dontKnowBtn.disabled = true;

  const levelEvent = recordAnswer(currentFact.id, outcome);
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
      el.feedbackMessage.textContent = 'You know ALL your times tables! Multiplication Champion! 🏆';
      launchConfetti();
      launchConfetti();
      soundKind = 'trophy';
      delay = 4200;
    }

    playSound(soundKind);
  } else {
    el.feedbackEmoji.textContent = '💡';
    el.feedbackMessage.textContent = pickRandom(GENTLE_MESSAGES);
    el.feedbackAnswer.textContent = `${currentFact.a} × ${currentFact.b} = ${correctAnswer}`;
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
  const colors = ['#7C3AED', '#EC4899', '#FBBF24', '#22C55E', '#38BDF8'];
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

/* ---------------------------- Sound ----------------------------
   Small synthesized chimes (Web Audio, no audio files) so bigger
   moments feel bigger: a plain correct answer gets a quick 3-note
   chime, a sticker unlock a brighter twinkle, a level-up a rising
   4-note fanfare, and finishing all levels a fuller 5-note fanfare.
------------------------------------------------------------------- */

const SOUND_KINDS = {
  correct: { type: 'sine', notes: [523.25, 659.25, 783.99], noteDur: 0.09, gain: 0.15 },
  gentle: { type: 'sine', notes: [392.0, 349.23], noteDur: 0.09, gain: 0.15 },
  sticker: { type: 'triangle', notes: [783.99, 987.77, 1174.66], noteDur: 0.08, gain: 0.14 },
  levelUp: { type: 'triangle', notes: [523.25, 659.25, 783.99, 1046.5], noteDur: 0.12, gain: 0.18 },
  trophy: { type: 'triangle', notes: [523.25, 659.25, 783.99, 1046.5, 1318.51], noteDur: 0.14, gain: 0.19 },
};

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
  const ids = allFactIds();
  const knownCount = ids.filter(id => isKnown(getFactRecord(id))).length;

  el.statStars.textContent = state.stars;
  el.statBest.textContent = state.bestStreak;
  el.statKnown.textContent = knownCount;
  el.statTotal.textContent = ids.length;

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

  // Fact grid
  const max = state.settings.maxTable;
  const levelMap = getNumberLevelMap(max);
  el.factGrid.innerHTML = '';
  el.factGrid.style.gridTemplateColumns = `repeat(${max + 1}, 1fr)`;

  const corner = document.createElement('div');
  corner.className = 'fact-cell header';
  corner.textContent = '×';
  el.factGrid.appendChild(corner);

  for (let b = 1; b <= max; b++) {
    const h = document.createElement('div');
    h.className = 'fact-cell header';
    h.textContent = b;
    el.factGrid.appendChild(h);
  }

  for (let a = 1; a <= max; a++) {
    const rowHeader = document.createElement('div');
    rowHeader.className = 'fact-cell header';
    rowHeader.textContent = a;
    el.factGrid.appendChild(rowHeader);

    for (let b = 1; b <= max; b++) {
      const rec = getFactRecord(factId(a, b));
      const factLevel = Math.min(levelMap[a], levelMap[b]);
      const cell = document.createElement('div');
      let cls;
      if (factLevel > state.currentLevel) {
        cls = 'locked';
        cell.textContent = '🔒';
        cell.title = `Locked — unlocks at Level ${factLevel}`;
      } else {
        cls = 'new';
        if (isMastered(rec)) cls = 'mastered';
        else if (isKnown(rec)) cls = 'known';
        else if (rec.attempts > 0) cls = 'learning';
        cell.title = `${a} × ${b} = ${a * b}`;
      }
      cell.className = `fact-cell ${cls}`;
      el.factGrid.appendChild(cell);
    }
  }
}

function renderLevelList() {
  const levelCount = getLevelCount();
  el.levelList.innerHTML = '';
  for (let lvl = 1; lvl <= levelCount; lvl++) {
    const facts = getFactsForLevel(lvl);
    const known = facts.filter(id => isKnown(getFactRecord(id))).length;
    const total = facts.length;

    const isDone = lvl < state.currentLevel || (lvl === state.currentLevel && lvl === levelCount && state.trophyShown);
    const isCurrent = lvl === state.currentLevel && !isDone;

    const row = document.createElement('div');
    row.className = `level-row ${isDone ? 'done' : isCurrent ? 'current' : 'locked'}`;
    const status = isDone ? '✅' : isCurrent ? '🔓' : '🔒';
    const count = isDone || isCurrent ? `${known}/${total}` : 'Locked';
    row.innerHTML = `<span class="level-row-status">${status}</span><span class="level-row-name">Level ${lvl}</span><span class="level-row-count">${count}</span>`;
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
  const x = 2 + Math.floor(Math.random() * 8);
  const y = 2 + Math.floor(Math.random() * 8);
  gateAnswer = x * y;
  el.gateQuestion.textContent = `Quick check: what's ${x} × ${y}?`;
  el.gateInput.focus();
}

function checkGate() {
  const val = Number(el.gateInput.value.trim());
  if (val === gateAnswer) {
    el.gateBox.classList.add('hidden');
    el.settingsBody.classList.remove('hidden');
    el.maxTableSelect.value = String(state.settings.maxTable);
    el.soundSelect.value = state.settings.sound;
    el.resetConfirmHint.textContent = '';
  } else {
    el.gateError.classList.remove('hidden');
  }
}

function applySettings() {
  state.settings.maxTable = Number(el.maxTableSelect.value);
  state.settings.sound = el.soundSelect.value;
  // Table range change reshapes the levels — keep currentLevel in range
  // and let a fresh trophy be earned against the new fact set.
  state.currentLevel = Math.min(state.currentLevel, getLevelCount());
  state.trophyShown = false;
  saveState();
  refreshHeader();
  refreshStartHint();
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
el.maxTableSelect.addEventListener('change', applySettings);
el.soundSelect.addEventListener('change', applySettings);
el.resetProgressBtn.addEventListener('click', () => {
  if (confirm("Reset Romi's progress? This can't be undone.")) resetProgress();
});
el.backFromSettingsBtn.addEventListener('click', () => { refreshStartHint(); showScreen(el.startScreen); });

/* ---------------------------- Init ---------------------------- */

refreshHeader();
refreshStartHint();
showScreen(el.startScreen);
