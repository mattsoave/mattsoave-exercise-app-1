# Exercise score

A small offline web app (PWA) that reads a FitNotes CSV export and scores cardio and strength with smooth, decaying discounts instead of weekly buckets. All parsing and scoring happens in the browser; the CSV is kept in this device's localStorage and never uploaded.

- `engine.js`: the scoring model. All tunable numbers are in `DEFAULTS` at the top.
- `app.js`, `index.html`: the page.
- `sw.js`, `manifest.webmanifest`: offline support, install, and share-to-app for CSV files.
- `test/run.js`: `node test/run.js path/to/FitNotes_Export.csv` runs checks and prints a summary. Keep CSVs out of this repo (`.gitignore` already skips `*.csv`).

Hosting: static files only. Serve from any https static host (GitHub Pages works). Bump `CACHE` in `sw.js` when you change any file so installed copies update.
