// Scoring engine. Pure functions, no DOM, runs in the browser and in Node.
// Input: the text of a FitNotes CSV export. Output: per-session credits and current "loads".
(function (root) {
  'use strict';

  // Every tunable number lives here.
  const DEFAULTS = {
    cardio: {
      tau: 6,            // days. How fast recent cardio load fades (load falls to ~37% after 6 days).
      K: 12,             // run-equivalent miles. How much recent load halves the value of the next mile.
      // Treadmill running is weighted by intensity, TRIMP-style (Banister): minutes x HRR x 0.64 x e^(1.92 x HRR),
      // where HRR is the fraction of heart-rate reserve. With no heart-rate data, HRR is estimated from speed with
      // a straight line through two of the owner's paces, and extrapolated past 100% for sprints.
      easyMph: 6.0,      // mph. An easy run; one mile here is worth exactly one run-mile.
      easyHRR: 0.65,     // estimated fraction of heart-rate reserve at easyMph.
      hardMph: 8.0,      // mph. A hard 3-mile effort.
      hardHRR: 0.90,     // estimated fraction of heart-rate reserve at hardMph.
      trimpK: 1.92,      // exponent from Banister's TRIMP (1.92 is the published value for men). Higher favors speed more.
      baseMET: 2,        // walking effort below about 2 METs (ordinary moving around) earns nothing, ramped in smoothly.
      baseSmooth: 0.25,  // METs. Width of that ramp. Larger means a softer corner.
      refMph: 6.5,       // an easy run-mile at this speed is the yardstick for walking effort.
      elevationScale: 1, // 1 = full climbing cost from the formula; 0 ignores incline and elevation.
      maxGrade: 0.15,    // average grades above this are treated as typos or GPS noise.
      bodyLb: 150,       // pounds. Used for the weight vest when no body tracker export is imported.
    },
    strength: {
      tagTau: 7,         // days. How fast recent work in one muscle group (upper/lower/core) fades.
      tagK: 10,          // points. Recent load in one group that halves credit for that group.
      allTau: 14,        // days. How fast overall strength load fades.
      allK: 25,          // points. Overall load that halves credit.
      pointsPerSet: 0.25, // points for one normal set.
      fullSets: 3,       // sets. The first 3 sets of one exercise in a day count fully; after that set n counts about 3/n, so ten sets count as about 6.6.
      failBonus: 0.15,   // extra for a set marked "x" in the comment (couldn't do another rep).
      nearBonus: 0.05,   // extra for a set marked "~x" (very close).
    },
  };

  const TREADMILL_RUN = { kind: 'run', treadmill: true };
  const CARDIO_EXERCISES = {
    'Home Treadmill': TREADMILL_RUN,
    'Running (Treadmill)': TREADMILL_RUN,
    'Treadmill 10mph': TREADMILL_RUN,
    'Treadmill HIIT': TREADMILL_RUN,
    'Treadmill Endurance': TREADMILL_RUN,
    'Running (Outdoor)': { kind: 'run', treadmill: false }, // outdoor times may be elapsed, so scored as easy pace
    'Treadmill (Walking)': { kind: 'walk', treadmill: true },
    'Walking (Outside)': { kind: 'walk', treadmill: false },
  };

  // FitNotes categories map to muscle groups; a few exercises are filed under odd categories.
  const NAME_TAG = {
    'Push-ups': 'upper',
    'Calf Raise': 'lower',
    'Leg Raises': 'core',
    'Hip Bridge': 'lower',
    'Glute Bridge': 'lower',
    'Glute Bridge Hold': 'lower',
    'Reverse Plank': 'core',
    'Lunge With Dumbbells': 'lower',
    'Bicep To Standing Shoulder Press': 'upper',
    'Standing Dumbbell Chop': 'core',
    'Wrist Barbell Curl (Supported)': 'upper',
    'Wrist Dumbbells': 'upper',
    'Wrist Twists': 'upper',
  };
  const CATEGORY_TAG = {
    legs: 'lower', hips: 'lower', abs: 'core',
    biceps: 'upper', triceps: 'upper', chest: 'upper', shoulders: 'upper', back: 'upper', forearms: 'upper', traps: 'upper',
  };
  const TAGS = ['upper', 'lower', 'core'];

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    // FitNotes does not quote an exercise name that contains a comma ("Push-ups, Decline"), so that row has
    // extra columns. Merge the extras back into the name. (Comments are quoted, so commas there are fine.)
    const ex = head.indexOf('Exercise');
    return rows.slice(1).map((r) => {
      const extra = r.length - head.length;
      if (ex >= 0 && extra > 0) r = [...r.slice(0, ex), r.slice(ex, ex + extra + 1).join(','), ...r.slice(ex + extra + 1)];
      return Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]]));
    });
  }

  // Climb in vertical feet from a FitNotes comment. Accepts "calories/vfeet" (84/155), "?/555", "/555",
  // "307 cal, 105 vfeet", and "555 vfeet". Falls back to "3% incline" as a direct grade.
  function climbFromComment(comment, miles, maxGrade) {
    const c = comment || '';
    let grade = null;
    let m = c.match(/^\s*(?:\d+|\?)?\s*\/\s*(\d+)/) || c.match(/(\d+)\s*v(?:t)?\s*(?:ft|feet)/i);
    if (m) grade = Number(m[1]) / (miles * 5280);
    else if ((m = c.match(/(\d+(?:\.\d+)?)\s*%/))) grade = Number(m[1]) / 100;
    return grade === null ? 0 : Math.min(maxGrade, Math.max(0, grade));
  }

  // Weight vest pounds from the third number of "calories/vfeet/vest" (for example "?/261/20" or "?//20").
  function vestFromComment(comment) {
    const m = String(comment || '').match(/^\s*(?:\d+|\?)?\s*\/\s*\d*\s*\/\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
  }

  // Effort mark on a strength set: "x" = couldn't do another rep, "~x" = very close.
  function effortWeight(comment, s) {
    const c = String(comment || '').trim().toLowerCase();
    if (/~\s*x\b/.test(c)) return 1 + s.nearBonus;
    if (/(^|[^a-z])x$/.test(c)) return 1 + s.failBonus;
    return 1;
  }

  function dayNumber(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function isoFromDay(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

  function seconds(t) {
    const p = String(t || '').split(':').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return 0;
    return p[0] * 3600 + p[1] * 60 + p[2];
  }

  function tagFor(row) {
    const name = row.Exercise.trim();
    if (NAME_TAG[name]) return NAME_TAG[name];
    return CATEGORY_TAG[row.Category.trim().toLowerCase()] || null;
  }

  // Group the raw rows into one cardio session and per-muscle-group strength sessions per day.
  function buildDays(rows) {
    const days = new Map();
    const unmapped = new Set();
    let setRow = 0;
    const get = (date) => {
      // sets[tag] maps each exercise name to its sets that day, in logged order.
      if (!days.has(date)) days.set(date, { date, segments: [], sets: { upper: new Map(), lower: new Map(), core: new Map() } });
      return days.get(date);
    };
    for (const r of rows) {
      const date = r.Date;
      if (!date) continue;
      const cardio = CARDIO_EXERCISES[r.Exercise.trim()];
      if (cardio) {
        const miles = parseFloat(r.Distance);
        const secs = seconds(r.Time);
        if (!(miles > 0) || !(secs > 0)) continue;
        const grade = climbFromComment(r.Comment, miles, DEFAULTS.cardio.maxGrade);
        get(date).segments.push({ miles, minutes: secs / 60, mph: miles / (secs / 3600), grade, vestLb: vestFromComment(r.Comment), ...cardio });
        continue;
      }
      if (r.Category.trim().toLowerCase() === 'cardio') continue; // e.g. rowing machine, not scored yet
      const tag = tagFor(r);
      if (!tag) { unmapped.add(r.Exercise.trim()); continue; }
      const byExercise = get(date).sets[tag];
      const name = r.Exercise.trim();
      if (!byExercise.has(name)) byExercise.set(name, []);
      byExercise.get(name).push({
        row: setRow++, exercise: name, comment: r.Comment, weight: r.Weight, unit: r['Weight Unit'], reps: r.Reps,
        distance: r.Distance, distanceUnit: r['Distance Unit'], time: r.Time,
      });
    }
    return { days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), unmapped: [...unmapped] };
  }

  // Estimated fraction of heart-rate reserve at a running speed.
  function hrrAt(mph, c) {
    return c.easyHRR + ((mph - c.easyMph) * (c.hardHRR - c.easyHRR)) / (c.hardMph - c.easyMph);
  }
  // TRIMP weight per minute.
  function trimpPerMinute(hrr, c) {
    const h = Math.max(0, hrr);
    return h * 0.64 * Math.exp(c.trimpK * h);
  }
  // Run-miles per mile at this speed: TRIMP per mile, relative to an easy mile. Exactly 1 at easyMph.
  function paceFactor(mph, c) {
    if (!(mph > 0)) return 1;
    const perMile = (v) => (60 / v) * trimpPerMinute(hrrAt(v, c), c);
    return perMile(mph) / perMile(c.easyMph);
  }

  // Oxygen-cost formulas (ACSM). Speed in meters per minute, grade as a fraction. 1 MET = 3.5 ml/kg/min.
  const MPH_TO_MPM = 26.8224;
  const walkMET = (mph, grade) => ((0.1 * mph * MPH_TO_MPM) + 1.8 * mph * MPH_TO_MPM * grade + 3.5) / 3.5;
  const runMET = (mph) => (0.2 * mph * MPH_TO_MPM + 3.5) / 3.5;
  const smoothPos = (x, w) => w * Math.log(1 + Math.exp(x / w)); // smooth version of max(0, x)

  // Run-miles of credit for a walk: effort above the baseline, in MET-minutes, divided by the
  // effort of one easy run-mile. A weight vest scales the walking cost by total carried weight over body weight.
  function walkPoints(minutes, mph, grade, c, vestLb) {
    const load = 1 + (vestLb || 0) / c.bodyLb;
    const effort = smoothPos(walkMET(mph, grade * c.elevationScale) * load - c.baseMET, c.baseSmooth);
    const perRunMile = (60 / c.refMph) * (runMET(c.refMph) - c.baseMET);
    return (effort * minutes) / perRunMile;
  }

  // Climbing adds 4.5 x grade to the net oxygen cost of running (0.9 x speed x grade against 0.2 x speed).
  const elevationFactor = (grade, c) => 1 + c.elevationScale * 4.5 * grade;

  // Run-equivalent miles for a set of segments: intensity weight for treadmill running, climb for runs, effort for walks.
  function cardioPoints(segments, c) {
    let p = 0;
    for (const s of segments) {
      if (s.kind === 'walk') p += walkPoints(s.minutes, s.mph, s.grade || 0, c, s.vestLb);
      else p += s.miles * (s.treadmill ? paceFactor(s.mph, c) : 1) * elevationFactor(s.grade || 0, c);
    }
    return p;
  }

  // Credit for p points on top of recent load L. Each extra point is worth less than the one before.
  // Integrating K/(K+L) over the added points makes the total independent of how a day is split up.
  function cardioCredit(L, p, K) {
    return K * Math.log((K + L + p) / (K + L));
  }

  // Cumulative effective sets after n sets of one exercise in a day. Equal to n up to fullSets, then
  // k(1 + ln(n/k)), so set n counts about k/n. The slope is 1 on both sides of k, so there is no kink or jump.
  function setCurve(n, s) {
    const k = s.fullSets;
    return n <= k ? n : k * (1 + Math.log(n / k));
  }

  // Effective sets for one exercise's sets in a day (a list of set objects or plain comments). Each set adds
  // its step on the curve, scaled by its own effort mark (x, ~x). Returns the total and each set's share.
  function setValues(sets, s) {
    return sets.map((set, i) => (setCurve(i + 1, s) - setCurve(i, s)) * effortWeight(typeof set === 'string' ? set : set.comment, s));
  }
  function effectiveSets(sets, s) {
    return setValues(sets, s).reduce((a, v) => a + v, 0);
  }

  // Points for one muscle group's day: the map from exercise name to its sets.
  function strengthPoints(byExercise, s) {
    let e = 0;
    for (const sets of byExercise.values()) e += effectiveSets(sets, s);
    return e * s.pointsPerSet;
  }

  // Credit for p strength points given the group's recent load Lt and the overall load La. The value of each
  // point is Kt/(Kt+Lt) x Ka/(Ka+La), and both loads rise as points are added. Integrating that over the points
  // makes the total the same however a day is split, so a day after a rest always earns at least as much.
  function strengthCredit(Lt, La, p, s) {
    const A = s.tagK + Lt, B = s.allK + La;
    if (!(p > 0)) return 0;
    if (Math.abs(B - A) < 1e-9) return (s.tagK * s.allK * p) / (A * (A + p));
    return ((s.tagK * s.allK) / (B - A)) * Math.log(((A + p) * B) / (A * (B + p)));
  }

  function freshState() {
    return { day: null, cardio: 0, upper: 0, lower: 0, core: 0, strength: 0 };
  }

  function decay(state, toDay, cfg) {
    if (state.day === null) return { ...state, day: toDay };
    const dt = Math.max(0, toDay - state.day);
    const ct = Math.exp(-dt / cfg.cardio.tau);
    const tt = Math.exp(-dt / cfg.strength.tagTau);
    const at = Math.exp(-dt / cfg.strength.allTau);
    return {
      day: toDay,
      cardio: state.cardio * ct,
      upper: state.upper * tt, lower: state.lower * tt, core: state.core * tt,
      strength: state.strength * at,
    };
  }

  function strengthMultiplier(state, tag, cfg) {
    const s = cfg.strength;
    return (1 / (1 + state[tag] / s.tagK)) * (1 / (1 + state.strength / s.allK));
  }

  function merge(base, over) {
    const out = {};
    for (const k of Object.keys(base)) out[k] = { ...base[k], ...((over && over[k]) || {}) };
    return out;
  }

  // Walk through every day in order and record the credit each session earned.
  function score(csvText, overrides) {
    const cfg = merge(DEFAULTS, overrides);
    const { days, unmapped } = buildDays(parseCsv(csvText));
    let state = freshState();
    const entries = [];
    const history = []; // the load state at the end of each day with activity, for the decay chart
    for (const d of days) {
      const n = dayNumber(d.date);
      state = decay(state, n, cfg);

      if (d.segments.length) {
        const p = cardioPoints(d.segments, cfg.cardio);
        const credit = cardioCredit(state.cardio, p, cfg.cardio.K);
        entries.push({
          date: d.date, kind: 'cardio', raw: p, credit,
          miles: d.segments.filter((s) => s.kind === 'run').reduce((a, s) => a + s.miles, 0),
          walkMiles: d.segments.filter((s) => s.kind === 'walk').reduce((a, s) => a + s.miles, 0),
          segments: d.segments.length,
        });
        state.cardio += p;
      }

      let total = 0;
      for (const tag of TAGS) {
        const byExercise = d.sets[tag];
        if (!byExercise.size) continue;
        const pts = strengthPoints(byExercise, cfg.strength);
        const credit = strengthCredit(state[tag], state.strength, pts, cfg.strength);
        const sets = [...byExercise.values()].reduce((a, c) => a + c.length, 0);
        // Split the group's credit across its sets in proportion to each set's face value.
        const setList = [];
        for (const list of byExercise.values()) {
          setValues(list, cfg.strength).forEach((v, i) => {
            const raw = v * cfg.strength.pointsPerSet;
            setList.push({ ...list[i], tag, raw, credit: pts > 0 ? (credit * raw) / pts : 0 });
          });
        }
        setList.sort((a, b) => a.row - b.row);
        entries.push({ date: d.date, kind: 'strength', tag, sets, raw: pts, credit, setList });
        state[tag] += pts;
        state.strength += pts; // each group adds to the overall load before the next group is scored
        total += pts;
      }
      history.push({ ...state });
    }
    return { entries, state, history, unmapped, cfg };
  }

  // What would a session earn if done on `dateIso`? (state comes from score().)
  function previewCardio(result, dateIso, segment) {
    const cfg = result.cfg;
    const st = decay(result.state, dayNumber(dateIso), cfg);
    const p = cardioPoints([segment], cfg.cardio);
    return { raw: p, credit: cardioCredit(st.cardio, p, cfg.cardio.K) };
  }
  function previewRun(result, dateIso, miles, mph, treadmill, gradePct) {
    return previewCardio(result, dateIso, { kind: 'run', miles, mph, treadmill, grade: (gradePct || 0) / 100 });
  }
  function previewWalk(result, dateIso, minutes, mph, gradePct, vestLb) {
    return previewCardio(result, dateIso, { kind: 'walk', miles: (mph * minutes) / 60, minutes, mph, grade: (gradePct || 0) / 100, vestLb: vestLb || 0 });
  }
  // A strength session of `sets` sets in one group, spread evenly over `exercises` exercises.
  function previewStrength(result, dateIso, tag, sets, exercises) {
    const cfg = result.cfg;
    const st = decay(result.state, dayNumber(dateIso), cfg);
    const k = Math.max(1, Math.round(exercises || 1));
    const byExercise = new Map();
    for (let i = 0; i < k; i++) byExercise.set(i, new Array(Math.floor(sets / k) + (i < sets % k ? 1 : 0)).fill(''));
    const pts = strengthPoints(byExercise, cfg.strength);
    return { raw: pts, credit: strengthCredit(st[tag], st.strength, pts, cfg.strength) };
  }

  // Value of the next session of each type (1 = fully rested) at the end of each day from startIso to endIso.
  // Days after the last import assume nothing new is logged.
  function freshnessSeries(result, startIso, endIso) {
    const cfg = result.cfg;
    const out = [];
    let i = -1;
    for (let n = dayNumber(startIso); n <= dayNumber(endIso); n++) {
      while (i + 1 < result.history.length && result.history[i + 1].day <= n) i++;
      const st = i < 0 ? freshState() : decay(result.history[i], n, cfg);
      const v = { date: isoFromDay(n), cardio: cfg.cardio.K / (cfg.cardio.K + st.cardio) };
      for (const t of TAGS) v[t] = strengthMultiplier(st, t, cfg);
      out.push(v);
    }
    return out;
  }

  // How much of face value the next session of each type would earn right now.
  function freshness(result, dateIso) {
    const cfg = result.cfg;
    const st = decay(result.state, dayNumber(dateIso), cfg);
    const out = { cardio: cfg.cardio.K / (cfg.cardio.K + st.cardio) };
    for (const t of TAGS) out[t] = strengthMultiplier(st, t, cfg);
    return { multipliers: out, loads: st };
  }

  function mondayOf(iso) {
    const n = dayNumber(iso);
    const dow = (n + 3) % 7; // 1970-01-01 was a Thursday; 0 = Monday
    return isoFromDay(n - dow);
  }

  // For display only: group credits by calendar week. The scoring itself has no week boundaries.
  function weekly(entries) {
    const w = new Map();
    for (const e of entries) {
      const k = mondayOf(e.date);
      if (!w.has(k)) w.set(k, { week: k, cardio: 0, strength: 0, upper: 0, lower: 0, core: 0, miles: 0 });
      const o = w.get(k);
      o[e.kind] += e.credit;
      if (e.kind === 'strength') o[e.tag] += e.credit;
      if (e.kind === 'cardio') o.miles += e.miles + e.walkMiles;
    }
    return [...w.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
  }

  function totals(entries, fromIso, toIso) {
    const t = { cardio: 0, strength: 0, upper: 0, lower: 0, core: 0, miles: 0, walkMiles: 0, cardioDays: 0, strengthDays: new Set() };
    for (const e of entries) {
      if (e.date < fromIso || e.date > toIso) continue;
      t[e.kind] += e.credit;
      if (e.kind === 'strength') t[e.tag] += e.credit;
      if (e.kind === 'cardio') { t.miles += e.miles; t.walkMiles += e.walkMiles; t.cardioDays++; } else t.strengthDays.add(e.date);
    }
    t.strengthDays = t.strengthDays.size;
    t.total = t.cardio + t.strength;
    return t;
  }

  const api = {
    DEFAULTS, TAGS, parseCsv, buildDays, score, previewRun, previewWalk, previewStrength, freshnessSeries, walkPoints, walkMET, climbFromComment, freshness, weekly, totals,
    cardioCredit, paceFactor, isoFromDay, dayNumber, vestFromComment, effortWeight, effectiveSets, setCurve, strengthCredit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
