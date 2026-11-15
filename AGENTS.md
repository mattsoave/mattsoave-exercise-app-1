# AGENTS.md

Guidance for AI agents working in this repo. Read this before editing.

## What this is

A small installable web app (PWA) that reads a FitNotes CSV export and scores cardio and strength. It runs entirely in the browser with no backend. The CSV is kept in the device's `localStorage` and never leaves the device. The owner uses it on an Android phone and publishes it on GitHub Pages from a public repo (`mattsoave/mattsoave-exercise-app-1`).

## Files

- `engine.js`: the scoring model. Pure functions, no DOM. Runs in the browser (`window.Engine`) and in Node (`require`). All tunable numbers are in `DEFAULTS` at the top.
- `app.js`, `index.html`: the page. Material 3 web components, plain JavaScript, no build step.
- `sw.js`, `manifest.webmanifest`: offline cache, install, and the share target that lets FitNotes share a CSV straight to the app.
- `vendor/material.js`: a prebuilt bundle of `@material/web` 2.5.0 (Apache 2.0, license beside it). Not hand-edited. See "Rebuilding the Material bundle".
- `weight.js`: the body weight card (reads a FitNotes body tracker CSV and draws a LOESS trend line). Checked by `test/weight.js`.
- `test/run.js`: sanity checks plus a printed summary. Run `node test/run.js <path to a FitNotes CSV>`.

## How scoring works

- Each day's cardio is summed into run-equivalent miles. Treadmill running is weighted per mile by intensity, TRIMP-style (Banister): heart-rate reserve is estimated from speed with a straight line through `easyMph`/`easyHRR` and `hardMph`/`hardHRR`, extrapolated past 100% for sprints, and each mile's TRIMP is divided by an easy mile's. An easy mile is exactly 1; faster miles are worth steeply more, slower treadmill miles a bit less. There is no cap or threshold. Outdoor runs are scored as easy pace because their logged times may be elapsed time instead of moving time.
- Walks (`Treadmill (Walking)` and `Walking (Outside)`) are scored by effort, not distance. Effort comes from the ACSM walking formula (speed and grade), minus a baseline of about 2 METs that is ramped in smoothly (no cutoff), divided by the effort of one easy run-mile. A slow stroll earns a little; a brisk or steep walk earns a lot. Walks use the same cardio load and diminishing returns as runs.
- Incline and elevation: the grade is vertical feet divided by distance in feet, read from the Comment field. Accepted formats: `calories/vfeet` (`84/155`), `?/555`, `/555`, `307 cal, 105 vfeet`, `555 vfeet`, or `3% incline`. For outdoor activities the number is Strava's total elevation gain. Climbing adds to both walk and run effort (`elevationScale` scales it). Missing means flat.
- Strength is grouped per day into upper, lower, and core from FitNotes categories (a few exercises are overridden by name in `NAME_TAG`). Points scale with sets, up to `maxPoints` at `setsForMax`.
- Credit is face value minus a discount for recent work of the same kind. Recent load decays continuously (exponential decay), so there are no weekly buckets. Weekly grouping exists only for the chart.
- Cardio credit is `K * ln((K + L + p) / (K + L))`, which makes the total independent of how a day is split into segments. Keep that property.
- The panel "value of the first mile or set today" shows the marginal rate. The preview percentage is the average over the whole session, so it is lower. Both are intended.

## Conventions

- No build step, no framework, no dependencies to install. Keep it that way unless the owner asks.
- Plain JavaScript. Keep `engine.js` free of DOM access so it stays testable in Node.
- Use Material 3 components and the `--md-sys-color-*` theme variables in `index.html`. Use segmented buttons (not dropdowns) for choices with two to five short options; `segmented()` in `app.js` gives each set a `.value` and a `change` event. Do not hardcode colors outside that theme block.
- Put new tunable numbers in `DEFAULTS`, not inline.
- When changing scoring, run `node test/run.js` against a real CSV and compare the totals before and after.

## Things that are easy to get wrong

- **Bump the version once per release, when you commit a change to any shipped file.** Do not bump it on every edit while iterating. Change `CACHE` in `sw.js` (for example `exercise-score-v3` to `v4`) and `VERSION` in `app.js`. Without the cache bump, installed copies keep serving old files. If you add a file the page needs, add it to `SHELL` in `sw.js`.
- `sw.js` installs with `cache: 'reload'` on purpose, so a new version never fills its cache from stale browser or CDN copies. Do not change that to a plain `addAll`.
- The share target accepts `text/*`, `application/*`, and `.csv` on purpose. FitNotes exports with a MIME type that a short CSV-only list did not match. Android registers share targets at install time, so a manifest change needs a reinstall to show up.
- Pages sits behind a CDN that can serve old files for about 10 minutes after a push. After deploying, hard reload once (Shift-Cmd-R), then reload normally.
- Never commit CSV or other personal exercise data. The repo is public and `.gitignore` skips `*.csv`. Check `git status` before committing.
- Walk and run times should be moving time (running or walking time only, no rests). Outdoor entries logged before Nov 2026 are a mix of moving and elapsed time.
- Outdoor run times in the owner's data are mixed: some are Strava moving time, some elapsed time. Do not use outdoor pace for scoring without asking.

## Rebuilding the Material bundle

`vendor/material.js` is built outside this repo. To change which components are included, make a scratch folder and run:

```
npm install @material/web@2.5.0 esbuild --registry=https://registry.npmjs.org/
npx esbuild entry.js --bundle --minify --format=esm --outfile=material.js
```

`entry.js` imports the components in use (filled-button, filled-tonal-button, outlined-text-field, outlined-select, select-option, linear-progress, and the labs outlined-segmented-button and outlined-segmented-button-set, imported from `@material/web/labs/segmentedbutton/outlined-segmented-button.js` and `@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js`) and adds the typescale styles with `document.adoptedStyleSheets.push(styles.styleSheet)`. Copy the output to `vendor/material.js`, then bump the cache version.

## Git and publishing

- This repo uses a personal GitHub identity set locally in `.git/config` (a noreply email). Do not change the global git config.
- The default branch is `main`. Check `git branch --show-current` and `git status --short` before editing.
- Do not commit, push, or deploy unless the owner asks. Each is a separate request. When asked to commit, use a short subject line and explain what and why in the body.
- Publishing is the owner pushing to GitHub; Pages builds from `main` at the repo root.
- If a build step (`npm run build`) is ever added, deploy it with a GitHub Actions workflow (Settings -> Pages -> Source: GitHub Actions) that builds and publishes the output folder. Do not commit built output. Remember the project-site base path (`/mattsoave-exercise-app-1/`) in the bundler config. Don't add a build step unless the owner asks.
