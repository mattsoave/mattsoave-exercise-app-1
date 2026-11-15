// Body-weight helpers. Pure functions, no DOM, runs in the browser and in Node.
// Input: the text of a FitNotes body tracker CSV (Date, Time, Measurement, Value, Unit, Comment).
(function (root) {
  'use strict';

  // Every tunable number lives here.
  const DEFAULTS = {
    span: 0.40,        // LOESS bandwidth: fraction of the visible readings used in each local fit.
    degree: 2,         // LOESS polynomial degree (1 or 2).
    defaultRange: '3m',
  };

  // Date ranges offered on the page. `months` counts back from today.
  const RANGES = [
    { key: '1y', label: 'Last year', months: 12 },
    { key: '6m', label: 'Last 6 months', months: 6 },
    { key: '3m', label: 'Last 3 months', months: 3 },
    { key: '1m', label: 'Last month', months: 1 },
  ];

  // True if the CSV looks like a FitNotes body tracker export (has a Measurement column).
  function isWeightCsv(text) {
    const head = String(text).slice(0, 400).split(/\r?\n/)[0] || '';
    return /(^|,)\s*"?Measurement"?\s*(,|$)/.test(head) && /(^|,)\s*"?Value"?\s*(,|$)/.test(head);
  }

  // Minimal CSV parser. Handles quoted fields.
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
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
  }

  // Returns readings sorted by time: [{ t: epoch ms (local time), pounds }].
  // Keeps every "Bodyweight" reading (no per-day averaging). Kilograms are converted to pounds.
  function parseWeights(text) {
    const points = [];
    for (const r of parseCsv(text)) {
      if ((r.Measurement || '').trim() !== 'Bodyweight') continue;
      const d = /^(\d{4})-(\d{2})-(\d{2})/.exec((r.Date || '').trim());
      let v = Number(r.Value);
      if (!d || !(v > 0)) continue;
      if (/kg/i.test(r.Unit || '')) v *= 2.2046226218;
      const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((r.Time || '').trim());
      const t = new Date(+d[1], +d[2] - 1, +d[3], tm ? +tm[1] : 0, tm ? +tm[2] : 0, tm && tm[3] ? +tm[3] : 0).getTime();
      points.push({ t, pounds: Math.round(v * 10) / 10 });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
  }

  // Keep readings from `months` months before `now` up to `now`.
  function filterRange(points, months, now) {
    const start = new Date(now);
    start.setMonth(start.getMonth() - months);
    return { start: start.getTime(), end: now, points: points.filter((p) => p.t >= start.getTime() && p.t <= now) };
  }

  // ---- LOESS (locally weighted regression) ----
  // For each point, fit a low-degree polynomial to the nearest `span` fraction of points,
  // weighted by the tricube kernel. Same method as the running app's weight chart.
  const tricube = (d) => { const a = Math.abs(d); if (a >= 1) return 0; const t = 1 - a * a * a; return t * t * t; };

  // Gaussian elimination with partial pivoting. Returns null if singular.
  function solve(a, b) {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      if (Math.abs(m[pivot][col]) < 1e-12) return null;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      for (let r = col + 1; r < n; r++) {
        const f = m[r][col] / m[col][col];
        for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = m[i][n];
      for (let c = i + 1; c < n; c++) s -= m[i][c] * x[c];
      x[i] = s / m[i][i];
    }
    return x;
  }

  // points: [{ x, y }] sorted by x. Returns the smoothed y for each point.
  function loess(points, span, degree) {
    const n = points.length;
    if (!n) return [];
    degree = degree || DEFAULTS.degree;
    const win = Math.min(Math.max(Math.ceil(Math.min(Math.max(span, 0), 1) * n), degree + 1), n);
    const p = degree + 1;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const x0 = points[i].x;
      // Grow a window of `win` neighbours, always taking the closer side next.
      let lo = i, hi = i + 1;
      while (hi - lo < win) {
        if (lo === 0) hi++;
        else if (hi === n) lo--;
        else if (x0 - points[lo - 1].x <= points[hi].x - x0) lo--;
        else hi++;
      }
      let maxDist = 0;
      for (let j = lo; j < hi; j++) maxDist = Math.max(maxDist, Math.abs(points[j].x - x0));
      if (maxDist === 0) maxDist = 1;

      const ata = Array.from({ length: p }, () => new Array(p).fill(0));
      const atb = new Array(p).fill(0);
      let wsum = 0, ysum = 0;
      for (let j = lo; j < hi; j++) {
        const w = tricube((points[j].x - x0) / maxDist);
        if (w <= 0) continue;
        wsum += w; ysum += w * points[j].y;
        const dx = points[j].x - x0;
        const pw = [1];
        for (let k = 1; k < p; k++) pw[k] = pw[k - 1] * dx;
        for (let r = 0; r < p; r++) {
          for (let c = 0; c < p; c++) ata[r][c] += w * pw[r] * pw[c];
          atb[r] += w * pw[r] * points[j].y;
        }
      }
      const co = solve(ata, atb);
      // The fit is centered on x0, so the intercept is the smoothed value.
      out[i] = co ? co[0] : (wsum > 0 ? ysum / wsum : points[i].y);
    }
    return out;
  }

  const api = { DEFAULTS, RANGES, isWeightCsv, parseCsv, parseWeights, filterRange, loess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Weight = api;
})(typeof self !== 'undefined' ? self : this);
