// Usage: node test/weight.js path/to/FitNotes_BodyTracker_Export.csv
const fs = require('fs');
const W = require('../weight.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node test/weight.js <FitNotes body tracker CSV>'); process.exit(1); }
const text = fs.readFileSync(file, 'utf8');
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failed++; };

// LOESS sanity checks
const line = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 2 * i + 5 }));
check('loess reproduces a straight line', W.loess(line, 0.3, 2).every((y, i) => Math.abs(y - line[i].y) < 1e-6));
const noisy = Array.from({ length: 60 }, (_, i) => ({ x: i, y: 100 + (i % 2 ? 1 : -1) }));
const lo = W.loess(noisy, 0.5, 2);
check('loess smooths alternating noise toward 100', lo.slice(5, 55).every((y) => Math.abs(y - 100) < 0.5));
check('wider bandwidth is smoother', (() => {
  const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const jag = Array.from({ length: 80 }, (_, i) => ({ x: i, y: 150 + 5 * Math.sin(i / 2) + (i % 3) }));
  return sd(W.loess(jag, 0.6, 2)) < sd(W.loess(jag, 0.1, 2));
})());
check('empty input gives empty output', W.loess([], 0.3).length === 0);

// Real file
check('body tracker CSV is detected', W.isWeightCsv(text));
check('workout CSV is not detected as weight', !W.isWeightCsv('Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time\n2026-01-01,Bench,Chest,100,5,,,'));
const pts = W.parseWeights(text);
check('readings are sorted by time', pts.every((p, i) => !i || pts[i - 1].t <= p.t));
check('readings look like pounds', pts.every((p) => p.pounds > 50 && p.pounds < 500));
console.log(`\n${pts.length} readings, ${new Date(pts[0].t).toISOString().slice(0, 10)} to ${new Date(pts[pts.length - 1].t).toISOString().slice(0, 10)}`);

const now = pts[pts.length - 1].t;
for (const r of W.RANGES) {
  const { points } = W.filterRange(pts, r.months, now);
  if (!points.length) { console.log(`${r.label.padEnd(14)} no readings`); continue; }
  const sm = W.loess(points.map((p) => ({ x: p.t / 86400000, y: p.pounds })), W.DEFAULTS.span, W.DEFAULTS.degree);
  console.log(`${r.label.padEnd(14)} ${String(points.length).padStart(4)} readings, trend ${sm[0].toFixed(1)} -> ${sm[sm.length - 1].toFixed(1)} lb`);
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
