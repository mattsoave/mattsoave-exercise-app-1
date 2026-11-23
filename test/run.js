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
const commaRows = E.parseCsv('Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n2026-03-13,Push-ups, Decline,Chest,0.0,lbs,20,,,,"a, b"\n');
check('an unquoted comma in an exercise name stays in the name, and later columns line up',
  commaRows.length === 1 && commaRows[0].Exercise === 'Push-ups, Decline' && commaRows[0].Category === 'Chest' && commaRows[0].Reps === '20' && commaRows[0].Comment === 'a, b');
const C = E.DEFAULTS.cardio;
check('pace factor is exactly 1 at easy pace', Math.abs(E.paceFactor(C.easyMph, C) - 1) < 1e-12);
check('pace factor keeps rising with speed, including past 100% heart-rate reserve',
  [5, 6, 7, 8, 9, 10, 11].every((v, i, a) => i === 0 || E.paceFactor(v, C) > E.paceFactor(a[i - 1], C)));
check('pace factor has no jumps (0.1 mph step changes it by less than 0.1)',
  [5, 6.5, 8, 8.8, 9.5, 10.5].every((v) => Math.abs(E.paceFactor(v + 0.05, C) - E.paceFactor(v - 0.05, C)) < 0.1));
check('8 mph is worth 1.5 to 1.9 easy miles per mile', E.paceFactor(8, C) > 1.5 && E.paceFactor(8, C) < 1.9);
check('10 mph is worth 2.5 to 3.1 easy miles per mile', E.paceFactor(10, C) > 2.5 && E.paceFactor(10, C) < 3.1);
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

// Strength
const S = E.DEFAULTS.strength;
const SH = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n';
const sets = (n, c = '') => new Array(n).fill(c);
check('one plain set counts exactly 1', Math.abs(E.effectiveSets(sets(1), S) - 1) < 1e-12);
check('sets past the third count less, but every set still adds something (no cap)',
  [3, 4, 5, 10, 20, 40].every((n, i, a) => i === 0 || (E.effectiveSets(sets(n), S) > E.effectiveSets(sets(a[i - 1]), S) && E.effectiveSets(sets(n), S) < n)));
check('ten sets of one exercise count as 5.5 to 7.5', E.effectiveSets(sets(10), S) > 5.5 && E.effectiveSets(sets(10), S) < 7.5);
check('the first three sets of an exercise count fully, and the fourth counts less',
  [1, 2, 3].every((n) => Math.abs(E.effectiveSets(sets(n), S) - n) < 1e-12) && E.effectiveSets(sets(4), S) - 3 < 1);
check('one set of two exercises earns the same as two sets of one exercise', (() => {
  const day = (rows) => E.score(SH + rows).entries.find((e) => e.kind === 'strength').raw;
  return Math.abs(day('2026-01-01,Dumbbell Curl,Biceps,20,lbs,10,,,,\n2026-01-01,Push-ups,Chest,0,lbs,10,,,,\n') -
    day('2026-01-01,Dumbbell Curl,Biceps,20,lbs,10,,,,\n2026-01-01,Dumbbell Curl,Biceps,20,lbs,10,,,,\n')) < 1e-12;
})());
check('the set curve has no jump or kink at the taper point',
  Math.abs((E.setCurve(3.001, S) - E.setCurve(3, S)) / 0.001 - 1) < 1e-3 && Math.abs((E.setCurve(3, S) - E.setCurve(2.999, S)) / 0.001 - 1) < 1e-3);
check('per-set credits add up to the day credit', E.score(SH + '2026-01-01,Dumbbell Curl,Biceps,20,lbs,10,,,,x\n'.repeat(5) + '2026-01-01,Push-ups,Chest,0,lbs,10,,,,\n')
  .entries.filter((e) => e.kind === 'strength').every((e) => Math.abs(e.setList.reduce((a, s) => a + s.credit, 0) - e.credit) < 1e-9));
check('x earns more than ~x, which earns more than no mark', E.effectiveSets(['X'], S) > E.effectiveSets(['~x'], S) && E.effectiveSets(['~x'], S) > E.effectiveSets([''], S));
check('effort marks: x, X, -x, ~x, ,~x', E.effortWeight('X', S) === 1 + S.failBonus && E.effortWeight('-x', S) === 1 + S.failBonus &&
  E.effortWeight('~x', S) === 1 + S.nearBonus && E.effortWeight(',~x', S) === 1 + S.nearBonus && E.effortWeight('box', S) === 1);
check('splitting a strength day within the day gives the same credit',
  Math.abs(E.strengthCredit(1, 2, 3, S) - (E.strengthCredit(1, 2, 1, S) + E.strengthCredit(2, 3, 2, S))) < 1e-9);
const sameDay = E.strengthCredit(0, 0, 3, S);
const twoDays = E.strengthCredit(0, 0, 1.5, S) + E.strengthCredit(1.5 * Math.exp(-1 / S.tagTau), 1.5 * Math.exp(-1 / S.allTau), 1.5, S);
check('half on each of two days earns slightly more than all on one day', twoDays > sameDay && twoDays < sameDay * 1.05);
check('strength credit with no load is close to face value for a small amount', Math.abs(E.strengthCredit(0, 0, 0.01, S) - 0.01) < 1e-4);

// Weight vest
check('vest parsing: calories/vfeet/vest', E.vestFromComment('?/261/20') === 20 && E.vestFromComment('?//20') === 20 && E.vestFromComment('84/155/12.5') === 12.5);
check('vest parsing: none without a third number', ['?/261', '84/155', '', 'x'].every((c) => E.vestFromComment(c) === 0));
check('climb still parses with a vest number after it', Math.abs(E.climbFromComment('?/261/20', 1, 0.5) - 261 / 5280) < 1e-9);
check('a vest walk earns more, and more than 14% for 20 lb at 150 lb', E.walkPoints(60, 3, 0, W, 20) > 1.14 * E.walkPoints(60, 3, 0, W, 0));
check('weeks start on Monday', E.weekly([{ date: '2026-11-14', kind: 'cardio', credit: 1, miles: 1 }])[0].week === '2026-11-09');

// Running goal (same counting rules as the mattsoav-running-tracking dashboard)
const R = require('../running.js');
const hdr = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n';
const runRows = E.parseCsv(hdr + '2026-01-01,Running (Outdoor),Cardio,,,,3,mi,0:30:00,\n2026-01-02,Home Treadmill,Cardio,,,,1,mi,0:20:00,\n' +
  '2026-01-02,Home Treadmill,Cardio,,,,2,mi,0:30:00,\n2026-01-03,Treadmill (Walking),Cardio,,,,2,mi,0:40:00,\n2025-12-31,Running (Outdoor),Cardio,,,,5,mi,0:50:00,\n');
const rs = R.yearSeries(runRows, 2026, '2026-01-03');
check('running goal: counts outdoor runs and treadmill runs at 3.5 mph or faster, skips walks and other years', rs.total === 5);
check('running goal: goal line is miles per day times day of year', rs.daily[2].goal === 6 && rs.aheadBy === -1);
check('running goal: today is clamped to the year', R.yearSeries(runRows, 2026, '2027-03-01').dayOfYear === 365);

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

const yr = R.yearSeries(E.parseCsv(fs.readFileSync(file, 'utf8')), Number(last.slice(0, 4)), last);
console.log(`\nRunning goal through ${last}: ${f(yr.total)} mi, ${f(yr.aheadBy)} vs goal pace, ${yr.active} run days, projected ${Math.round(yr.projected)} of ${yr.goalTotal}`);

console.log('\nWhat a few sessions would earn on the day after the last one:');
const next = E.isoFromDay(E.dayNumber(last) + 1);
for (const [label, p] of [
  ['3 mi easy (6.3 mph)', E.previewRun(result, next, 3, 6.3, true)],
  ['3 mi fast (7.5 mph)', E.previewRun(result, next, 3, 7.5, true)],
  ['3 mi hard (8.0 mph)', E.previewRun(result, next, 3, 8.0, true)],
  ['0.5 mi at 10 mph',     E.previewRun(result, next, 0.5, 10, true)],
  ['2 mi at 10 mph',       E.previewRun(result, next, 2, 10, true)],
  ['7 mi easy (6.2 mph)', E.previewRun(result, next, 7, 6.2, true)],
  ['14 mi outdoor', E.previewRun(result, next, 14, 6.6, false)],
  ['walk 60 min, 2 mph', E.previewWalk(result, next, 60, 2, 0)],
  ['walk 60 min, 3 mph', E.previewWalk(result, next, 60, 3, 0)],
  ['walk 60 min, 3.5 mph', E.previewWalk(result, next, 60, 3.5, 0)],
  ['walk 45 min, 3 mph 10%', E.previewWalk(result, next, 45, 3, 10)],
  ['walk 60 min, 3.5, 20 lb', E.previewWalk(result, next, 60, 3.5, 0, 20)],
  ['3 mi easy, 2% incline', E.previewRun(result, next, 3, 6.3, true, 2)],
  ['upper, 8 sets / 3 ex', E.previewStrength(result, next, 'upper', 8, 3)],
  ['lower, 8 sets / 3 ex', E.previewStrength(result, next, 'lower', 8, 3)],
  ['upper, 10 sets / 1 ex', E.previewStrength(result, next, 'upper', 10, 1)],
]) console.log(`${label.padEnd(22)} face ${f(p.raw).padStart(5)}  credit ${f(p.credit).padStart(5)}`);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
