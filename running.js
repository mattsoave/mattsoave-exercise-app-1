// Running goal: cumulative miles this year against a steady miles-per-day goal line.
// Ported from the mattsoav-running-tracking dashboard, using the same counting rules so the totals match.
// Pure functions, no DOM, runs in the browser (window.Running) and in Node (require).
(function (root) {
  'use strict';

  const DEFAULTS = {
    milesPerDay: 2,
    alwaysRunning: ['Running (Outdoor)'],
    // Exercises that only count when fast enough to be a run, not a walk: name -> minimum mph.
    speedGated: { 'Home Treadmill': 3.5 },
  };

  const seconds = (t) => {
    const p = String(t || '').trim().split(':').map(Number);
    if (p.some(isNaN)) return 0;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return p.length === 1 ? p[0] : 0;
  };
  const dayNumber = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const isoFromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

  // Miles per day (YYYY-MM-DD -> miles) for qualifying runs. `rows` are parsed CSV rows.
  function milesByDay(rows, cfg = DEFAULTS) {
    const out = new Map();
    for (const r of rows) {
      const ex = (r.Exercise || '').trim();
      const always = cfg.alwaysRunning.includes(ex);
      const gate = cfg.speedGated[ex];
      if (!always && gate === undefined) continue;
      const date = /^\d{4}-\d{2}-\d{2}/.exec((r.Date || '').trim());
      const miles = Number(r.Distance);
      if (!date || !(miles > 0)) continue;
      if (gate !== undefined) {
        const s = seconds(r.Time);
        if (!(s > 0) || miles / (s / 3600) < gate) continue;
      }
      out.set(date[0], (out.get(date[0]) || 0) + miles);
    }
    return out;
  }

  // Daily series for `year` from Jan 1 through `todayIso` (clamped to the year).
  function yearSeries(rows, year, todayIso, cfg = DEFAULTS) {
    const byDay = milesByDay(rows, cfg);
    const first = dayNumber(`${year}-01-01`), last = dayNumber(`${year}-12-31`);
    const today = Math.min(last, Math.max(first, dayNumber(todayIso)));
    const daily = [];
    let total = 0, active = 0;
    for (let n = first; n <= today; n++) {
      const iso = isoFromDay(n);
      const m = byDay.get(iso) || 0;
      total += m;
      if (m > 0) active++;
      daily.push({ date: iso, miles: total, goal: cfg.milesPerDay * (n - first + 1) });
    }
    const daysInYear = last - first + 1, dayOfYear = today - first + 1;
    const goalTotal = cfg.milesPerDay * daysInYear;
    const daysLeft = daysInYear - dayOfYear;
    return {
      daily, total, active, dayOfYear, daysInYear, goalTotal,
      aheadBy: total - cfg.milesPerDay * dayOfYear,
      projected: (total / dayOfYear) * daysInYear,
      neededPerDay: daysLeft > 0 ? Math.max(0, goalTotal - total) / daysLeft : 0,
    };
  }

  const api = { DEFAULTS, milesByDay, yearSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Running = api;
})(typeof self !== 'undefined' ? self : this);
