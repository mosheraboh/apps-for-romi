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
- Questions are picked so that **about 2/3 come from facts she's expected to
  know** (reviewed with spaced repetition — the longer since she last saw
  one, the more likely it's picked, to keep it fresh) and **about 1/3 from
  facts she's still learning** (weighted toward the ones she struggles with
  most). This keeps practice mostly encouraging while steadily working on
  weak spots.
- Correct answers earn a star, a streak counter, a burst of confetti, and a
  cheerful message. Getting something wrong or skipping is always gentle —
  it just shows the right answer and quietly queues that fact for more
  practice, no penalty beyond that.
- Star milestones unlock stickers for a growing "sticker book."
- A progress screen shows a color-coded 10×10 grid of every fact (new /
  learning / known / mastered), plus totals and best streak.
- A lightweight settings screen (behind a simple grown-up math check) lets
  you change the table range (5, 10, or 12), toggle sound, or reset progress.

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
