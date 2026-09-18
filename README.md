# Apps for Romi

## Romi's Times Tables

A friendly Mac app that helps a 7-year-old practice multiplication tables by
memorization — one question at a time, with stars, streaks, and stickers as
rewards.

### How it works

- One exercise appears at a time (e.g. `3 × 4`). Romi types the answer, or
  taps **"I don't know 🤔"** if she'd rather skip straight to seeing it.
- Every fact (1–10 × 1–10 by default) is tracked individually with a mastery
  "box" from 0–5, Leitner-style:
  - A correct answer moves the fact up a box.
  - A wrong answer moves it down a box.
  - "I don't know" moves it down two boxes (it clearly needs more practice).
  - A fact counts as **known** once its box reaches 3+.
- **10 levels.** The times table is split into 10 levels, taught in the order
  kids usually find easiest: 1s, 2s, 10s, 5s, 3s, 4s, 6s, 9s, 7s, 8s. Only
  facts from the current (and earlier) levels are ever asked. A level is
  complete once every fact in it is known, which unlocks the next one with a
  "Level up!" celebration.
- **A global progress bar**, always visible at the top of the app, shows
  Romi exactly how close she is to finishing her current level (e.g.
  "Level 3 of 10 — 6/8 known — So close! 🌟"), so she always has a concrete,
  visible target to aim for.
- Within whatever is currently unlocked, questions are picked so that
  **about 2/3 come from facts she's expected to know** (reviewed with spaced
  repetition — the longer since she last saw one, the more likely it's
  picked, to keep it fresh) and **about 1/3 from facts she's still learning**
  (weighted toward the ones she struggles with most). This keeps practice
  mostly encouraging while steadily working on weak spots.
- Correct answers earn a star, a streak counter, a burst of confetti, and a
  cheerful message. Getting something wrong or skipping is always gentle —
  it just shows the right answer and quietly queues that fact for more
  practice, no penalty beyond that.
- Star milestones unlock stickers for a growing "sticker book."
- A progress screen shows a level-by-level checklist, a color-coded 10×10
  grid of every fact (locked / new / learning / known / mastered), plus
  totals and best streak.
- A lightweight settings screen (behind a simple grown-up math check) lets
  you change the table range (5, 10, or 12 — the level count adjusts
  automatically for smaller ranges), toggle sound, or reset progress.
- Small celebratory sound chimes (synthesized in-browser, no audio files)
  play on a correct answer, with bigger, distinct fanfares for unlocking a
  sticker, completing a level, and finishing all 10 levels. Sound can be
  turned off in settings.

All progress is saved locally in the browser via `localStorage` — nothing
leaves the Mac, no account or internet connection needed.

### Running it on the Mac

The app is a small offline web app (HTML/CSS/JS) rather than a compiled
`.app` bundle — no App Store account, code signing, or Xcode build step
needed, and it works fully offline.

1. Copy the `multiplication-table` folder onto the Mac (or `git clone` this
   repo).
2. Double-click **`Start Romi's Math App.command`** inside that folder. The
   first time, macOS Gatekeeper may block it — right-click (or Control-click)
   the file and choose **Open** instead, then confirm.
3. It opens in Safari.
4. To make it feel like a real Mac app with its own Dock icon and window
   (no browser toolbar): in Safari's menu bar choose **File → Add to Dock**
   (or the Share button → Add to Dock). From then on, launch it straight
   from the Dock like any other app.

Progress is tied to the browser it's opened in, so once you've added it to
the Dock, keep using that same icon.

### Files

```
multiplication-table/
  index.html                     the app UI
  style.css                      styling/animations
  app.js                         game logic: fact tracking, selection, rewards
  Start Romi's Math App.command  double-click launcher
```

## Let's Count!

A Mac app for a 4-year-old learning to count — same idea as Romi's Times
Tables, adapted for a younger learner: she sees a picture of some objects
and types how many there are, no reading required beyond digits.

### How it works

- Each question shows a group of pictures (apples, stars, balloons, and
  more — a random one each time) and asks "How many are there?" She types
  the number, or taps **"Not sure? 🤔"** to see the answer.
- The icons pop in one at a time with a little bounce (and a soft tick
  sound), so watching them appear reinforces counting rhythmically,
  1-2-3‑style, rather than just showing a static pile.
- Counting 1–20 is tracked number-by-number with the same 0–5 mastery
  "box" system as Romi's app (correct moves it up, a miss moves it down,
  "not sure" moves it down two), and a number counts as **known** once its
  box reaches 3+.
- **10 levels**, unlocked two numbers at a time: Level 1 is just 1 and 2,
  Level 2 adds 3 and 4, and so on up to Level 10 (19 and 20). Only numbers
  from unlocked levels are ever asked, and completing a level (both its
  numbers known) unlocks the next with a celebration.
- **A global progress bar**, always visible at the top, shows exactly how
  close she is to finishing her current level (e.g. "Level 4 of 10 — 1/2
  known — So close! 🌟").
- Within what's unlocked, questions are mixed **about 2/3 from numbers
  she's expected to know** (spaced repetition — longer since last seen
  means more likely to come up again) and **about 1/3 from numbers she's
  still learning**, so practice stays mostly encouraging while steadily
  reinforcing weak spots.
- Correct answers earn a star, a streak, confetti, and a cheerful message;
  a miss or "not sure" is always gentle — it just reveals the number and
  quietly queues it for more practice.
- Star milestones unlock stickers for a sticker book, and distinct sound
  fanfares mark a sticker, a level-up, and finishing all 10 levels (sound
  can be turned off in settings).
- A progress screen shows a level-by-level checklist and a 1–20 number
  grid (locked / new / learning / known / mastered), plus totals and best
  streak.
- A lightweight settings screen (behind a simple grown-up addition check)
  lets you toggle sound or reset progress.

All progress is saved locally in the browser via `localStorage`.

### Running it on the Mac

Same as Romi's app — it's an offline web app, not a compiled `.app`.

1. Double-click **`Start Counting App.command`** inside the `counting-app`
   folder (right-click → **Open** the first time, to get past Gatekeeper —
   or just double-click `index.html` directly to skip the launcher
   entirely).
2. It opens in Safari. Use **File → Add to Dock** there to give it its own
   Dock icon and window.

### Files

```
counting-app/
  index.html                  the app UI
  style.css                   styling/animations
  app.js                      game logic: number tracking, selection, rewards
  Start Counting App.command  double-click launcher
```
