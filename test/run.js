// Usage: node test/run.js path/to/FitNotes_Export.csv
const fs = require('fs');
const E = require('../engine.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node test/run.js <FitNotes CSV>'); process.exit(1); }
const result = E.score(fs.readFileSync(file, 'utf8'));
const { entries } = result;
const f = (x) => x.toFixed(1);
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failed++; };

// Sanity checks
const K = E.DEFAULTS.cardio.K;
check('splitting a day into pieces gives the same credit',
  Math.abs(E.cardioCredit(5, 6, K) - (E.cardioCredit(5, 2, K) + E.cardioCredit(7, 4, K))) < 1e-9);
check('credit is below face value when load is high', E.cardioCredit(10, 5, K) < 5);
check('credit equals about face value when load is zero and amount is small', Math.abs(E.cardioCredit(0, 0.01, K) - 0.01) < 1e-3);
check('pace factor is 1 at or below start and max at full',
  E.paceFactor(6, E.DEFAULTS.cardio) === 1 && Math.abs(E.paceFactor(8.5, E.DEFAULTS.cardio) - 1.35) < 1e-9);
const W = E.DEFAULTS.cardio;
const hour = (mph, g) => E.walkPoints(60, mph, g, W);
check('walk credit rises with speed and with incline', hour(2, 0) < hour(3, 0) && hour(3, 0) < hour(3.5, 0) && hour(3, 0) < hour(3, 0.05) && hour(3, 0.05) < hour(3, 0.1));
check('3 mph flat walk for an hour is worth 0.7 to 1.2 run-miles', hour(3, 0) > 0.7 && hour(3, 0) < 1.2);
check('slow stroll is worth something but less than half a run-mile per hour', hour(2, 0) > 0.1 && hour(2, 0) < 0.5);
check('3 mph at 10% incline for an hour is worth 3 to 4.5 run-miles', hour(3, 0.1) > 3 && hour(3, 0.1) < 4.5);
check('walk credit has no jumps (0.1 mph step changes an hour by less than 0.1)', Math.abs(hour(2.55, 0) - hour(2.45, 0)) < 0.1);
check('walk credit is never negative', hour(0.5, 0) >= 0);
check('climb parsing: calories/vfeet', Math.abs(E.climbFromComment('84/155', 1, 0.15) - 155 / 5280) < 1e-9);
check('climb parsing: ?/555 and /555 and 555 vfeet', ['?/555', '/555', '555 vfeet', '555 vt feet', '307 cal, 555 vfeet'].every((c) => Math.abs(E.climbFromComment(c, 1, 0.5) - 555 / 5280) < 1e-9));
check('climb parsing: no climb for 0, calories only, or empty', ['229/0', '629 cal', ''].every((c) => E.climbFromComment(c, 2, 0.15) === 0));
check('climb parsing: percent incline fallback', Math.abs(E.climbFromComment('3% incline', 1, 0.15) - 0.03) < 1e-9);
check('climb is capped at maxGrade', E.climbFromComment('0/99999', 1, 0.15) === 0.15);
const base = E.score('Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n2026-01-01,Home Treadmill,Cardio,,,,3,mi,0:30:00,\n');
check('a run with climb earns more than the same run flat', E.previewRun(base, '2026-01-02', 3, 6, true, 3).raw > E.previewRun(base, '2026-01-02', 3, 6, true, 0).raw);
check('dates round-trip', E.isoFromDay(E.dayNumber('2026-03-24')) === '2026-03-24');
check('weeks start on Monday', E.weekly([{ date: '2026-11-14', kind: 'cardio', credit: 1, miles: 1 }])[0].week === '2026-11-09');

console.log(`\n${entries.length} sessions scored. Unmapped exercises: ${result.unmapped.join(', ') || 'none'}`);

console.log('\nTotals by year (credit; raw miles)');
for (const y of ['2020', '2023', '2025', '2026']) {
  const t = E.totals(entries, `${y}-01-01`, `${y}-12-31`);
  if (!t.total) continue;
  console.log(`${y}: total ${f(t.total)} = cardio ${f(t.cardio)} (${f(t.miles)} mi, ${t.cardioDays} days) + strength ${f(t.strength)} (${t.strengthDays} days); cardio share ${Math.round(100 * t.cardio / t.total)}%`);
}

console.log('\nLast 12 weeks (cardio / strength credit, miles)');
const weeks = E.weekly(entries).slice(-12);
for (const w of weeks) console.log(`${w.week}  cardio ${f(w.cardio).padStart(5)}  strength ${f(w.strength).padStart(5)}  total ${f(w.cardio + w.strength).padStart(5)}  (${f(w.miles)} mi)`);

const last = entries[entries.length - 1].date;
const fr = E.freshness(result, last);
console.log(`\nAs of ${last}, share of face value the next session would earn:`);
console.log(Object.entries(fr.multipliers).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('  '));

console.log('\nWhat a few sessions would earn on the day after the last one:');
const next = E.isoFromDay(E.dayNumber(last) + 1);
for (const [label, p] of [
  ['3 mi easy (6.3 mph)', E.previewRun(result, next, 3, 6.3, true)],
  ['3 mi fast (7.5 mph)', E.previewRun(result, next, 3, 7.5, true)],
  ['3 mi hard (8.0 mph)', E.previewRun(result, next, 3, 8.0, true)],
  ['7 mi easy (6.2 mph)', E.previewRun(result, next, 7, 6.2, true)],
  ['14 mi outdoor', E.previewRun(result, next, 14, 6.6, false)],
  ['walk 60 min, 2 mph', E.previewWalk(result, next, 60, 2, 0)],
  ['walk 60 min, 3 mph', E.previewWalk(result, next, 60, 3, 0)],
  ['walk 60 min, 3.5 mph', E.previewWalk(result, next, 60, 3.5, 0)],
  ['walk 45 min, 3 mph 10%', E.previewWalk(result, next, 45, 3, 10)],
  ['3 mi easy, 2% incline', E.previewRun(result, next, 3, 6.3, true, 2)],
  ['upper, 8 sets', E.previewStrength(result, next, 'upper', 8)],
  ['lower, 8 sets', E.previewStrength(result, next, 'lower', 8)],
]) console.log(`${label.padEnd(22)} face ${f(p.raw).padStart(5)}  credit ${f(p.credit).padStart(5)}`);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
