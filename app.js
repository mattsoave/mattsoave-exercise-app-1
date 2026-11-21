const VERSION = 16;
const $ = (id) => document.getElementById(id);

// Segmented button sets have no .value, so give each one a value (the selected button's data-value) and a change event.
// The set announces a selection before it clears the previously selected button, so read the new choice from the event.
function segmented(id) {
  const el = $(id);
  const buttons = () => [...el.querySelectorAll('md-outlined-segmented-button')];
  let chosen = null;
  Object.defineProperty(el, 'value', {
    get() { const b = chosen || buttons().find((x) => x.selected); return b ? b.dataset.value : ''; },
    set(v) { chosen = buttons().find((x) => x.dataset.value === v) || null; buttons().forEach((x) => { x.selected = x === chosen; }); },
  });
  el.addEventListener('segmented-button-set-selection', (e) => {
    chosen = e.detail.button;
    el.dispatchEvent(new Event('change'));
  });
}
['type', 'where', 'tag', 'wRange', 'decayView', 'decayRange', 'toolMode'].forEach(segmented);
$('ver').textContent = VERSION;

// ---- Tabs ----
const TABS = ['credit', 'running', 'tools', 'weight'];
function showTab(name) {
  TABS.forEach((t) => { $(`tab-${t}`).hidden = t !== name; });
  localStorage.setItem('tab', name);
}
customElements.whenDefined('md-tabs').then(() => {
  const saved = TABS.indexOf(localStorage.getItem('tab'));
  $('tabs').activeTabIndex = saved < 0 ? 0 : saved;
  showTab(TABS[$('tabs').activeTabIndex]);
});
$('tabs').addEventListener('change', () => showTab(TABS[$('tabs').activeTabIndex]));

// ---- Status, install ----
function setNet() {
  $('net').textContent = navigator.onLine ? 'online' : 'offline';
}
addEventListener('online', setNet);
addEventListener('offline', setNet);
setNet();
if (matchMedia('(display-mode: standalone)').matches) $('mode').textContent = 'installed app';

let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('install').hidden = true;
});

// ---- Data ----
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let result = null;
const f1 = (x) => x.toFixed(1);

function importCsv(text, name) {
  if (Weight.isWeightCsv(text)) return importWeight(text, name);
  const r = Engine.score(text);
  if (!r.entries.length) {
    $('importNote').textContent = `${name}: no cardio or strength rows found. Is this a FitNotes export?`;
    return;
  }
  localStorage.setItem('csv', text);
  localStorage.setItem('csvName', name);
  localStorage.setItem('csvAt', new Date().toISOString());
  load();
}

function importWeight(text, name) {
  if (!Weight.parseWeights(text).length) {
    $('importNote').textContent = `${name}: no Bodyweight rows found in this body tracker export.`;
    return;
  }
  localStorage.setItem('weightCsv', text);
  localStorage.setItem('weightCsvName', name);
  localStorage.setItem('weightCsvAt', new Date().toISOString());
  loadWeight();
  load(); // the weight vest uses the latest body weight
  $('importNote').textContent = `${name}: ${weights.length} weight readings imported.`;
}

// Latest body weight in pounds, for the weight vest. Undefined without a body tracker import.
function latestPounds() {
  if (!weights.length) return undefined;
  return weights.reduce((a, b) => (b.t > a.t ? b : a)).pounds;
}

function load() {
  const text = localStorage.getItem('csv');
  if (!text) return;
  const lb = latestPounds();
  result = Engine.score(text, lb ? { cardio: { bodyLb: lb } } : undefined);
  const last = result.entries[result.entries.length - 1].date;
  const at = (localStorage.getItem('csvAt') || '').slice(0, 10);
  $('importNote').textContent =
    `${localStorage.getItem('csvName') || 'CSV'}: ${result.entries.length} sessions, latest ${last}, imported ${at}.` +
    (result.unmapped.length ? ` Not scored (unknown muscle group): ${result.unmapped.join(', ')}.` : '');
  $('data').hidden = false;
  $('noData').hidden = true;
  renderRunning(text);
  if (!$('when').value) $('when').value = todayIso();
  render();
}

// ---- Rendering ----
function render() {
  const today = todayIso();
  const year = today.slice(0, 4);
  const t = Engine.totals(result.entries, `${year}-01-01`, `${year}-12-31`);
  $('yearTitle').textContent = `${year} so far`;
  $('yearTotal').textContent = `${f1(t.total)} credit`;
  const share = t.total ? (100 * t.cardio) / t.total : 0;
  const pct = (v) => (t.total ? (100 * v) / t.total : 0);
  $('splitC').style.width = `${share}%`;
  $('splitU').style.width = `${pct(t.upper)}%`;
  $('splitL').style.width = `${pct(t.lower)}%`;
  $('splitK').style.width = `${pct(t.core)}%`;
  $('keyC').textContent = `Cardio ${f1(t.cardio)} (${f1(t.miles)} mi run` + (t.walkMiles ? `, ${f1(t.walkMiles)} mi walked` : '') + `, ${t.cardioDays} days)`;
  $('keyU').textContent = `Upper ${f1(t.upper)}`;
  $('keyL').textContent = `Lower ${f1(t.lower)}`;
  $('keyK').textContent = `Core ${f1(t.core)} (strength total ${f1(t.strength)} over ${t.strengthDays} days)`;

  // Last 12 calendar weeks, including empty ones
  const byWeek = new Map(Engine.weekly(result.entries).map((w) => [w.week, w]));
  const mondayOf = (iso) => Engine.isoFromDay(Engine.dayNumber(iso) - ((Engine.dayNumber(iso) + 3) % 7));
  const thisMonday = Engine.dayNumber(mondayOf(today));
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const k = Engine.isoFromDay(thisMonday - 7 * i);
    weeks.push(byWeek.get(k) || { week: k, cardio: 0, strength: 0, upper: 0, lower: 0, core: 0 });
  }
  const max = Math.max(1, ...weeks.map((w) => w.cardio + w.strength));
  $('weeks').innerHTML = weeks.map((w) =>
    `<div class="w" title="${w.week}: ${f1(w.cardio + w.strength)}">` +
    ['cardio', 'upper', 'lower', 'core'].map((k) => `<span class="c-${k}" style="height:${(100 * w[k]) / max}%"></span>`).join('') + '</div>').join('');
  $('weekLabels').innerHTML = weeks.map((w) => `<span>${w.week.slice(5)}</span>`).join('');

  renderFresh();
  renderDecay();
  renderPreview();
}

const DECAY_LINES = [
  ['Cardio', 'cardio', 'var(--md-sys-color-primary)'],
  ['Upper', 'upper', 'var(--md-sys-color-tertiary)'],
  ['Lower', 'lower', 'var(--chart-lower)'],
  ['Core', 'core', 'var(--chart-core)'],
];
const DECAY_AHEAD = 7; // days of projection after today
const DECAY_RANGES = { '2w': 14, '1m': 30, '3m': 90, '1y': 365 }; // days shown before today

// One line chart as SVG markup. `lines` are [label, key, color]; `top` is the y-axis maximum (0 to 1).
function decaySvg(series, lines, top, W, H, small, back) {
  const L = small ? 28 : 34, R = 8, T = 8, B = 20;
  const x = (i) => L + (i * (W - L - R)) / (series.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ti = back;
  let svg = '';
  for (const g of [0, top / 2, top]) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text class="lbl" x="${L - 4}" y="${y(g) + 3}" text-anchor="end">${Math.round(g * 100)}%</text>`;
  svg += `<rect class="future" x="${x(ti)}" y="${T}" width="${W - R - x(ti)}" height="${H - T - B}"/>`;
  svg += `<line class="today" x1="${x(ti)}" x2="${x(ti)}" y1="${T}" y2="${H - B}"/>`;
  const base = Math.max(7, Math.round(series.length / 4 / 7) * 7); // label spacing in days, about four labels
  const step = small ? base * 2 : base;
  for (let i = 0; i < series.length; i += step) {
    svg += `<text class="lbl" x="${x(i)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i + step >= series.length ? 'end' : 'middle'}">${series[i].date.slice(5)}</text>`;
  }
  if (!small) svg += `<text class="lbl" x="${x(ti) - 4}" y="${H - B - 4}" text-anchor="end">today</text>`;
  for (const [, k, color] of lines) {
    const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`);
    svg += `<polyline class="ln" style="stroke:${color}" points="${pts.slice(0, ti + 1).join(' ')}"/>`;
    svg += `<polyline class="ln proj" style="stroke:${color}" points="${pts.slice(ti).join(' ')}"/>`;
    svg += `<circle cx="${x(ti)}" cy="${y(series[ti][k])}" r="3.5" style="fill:${color}"/>`;
  }
  return svg;
}

function renderDecay() {
  const today = todayIso();
  const n0 = Engine.dayNumber(today);
  const back = DECAY_RANGES[$('decayRange').value] || DECAY_RANGES['1m'];
  // "Kept up" is the opposite of the first-mile value: 0% with no recent work, rising as the load builds.
  const raw = Engine.freshnessSeries(result, Engine.isoFromDay(n0 - back), Engine.isoFromDay(n0 + DECAY_AHEAD));
  const series = raw.map((p) => ({ date: p.date, cardio: 1 - p.cardio, upper: 1 - p.upper, lower: 1 - p.lower, core: 1 - p.core }));
  const niceTop = (keys) => Math.max(0.2, Math.ceil(Math.max(...series.flatMap((p) => keys.map((k) => p[k]))) * 10) / 10);
  // A year is too busy for one chart, so 1 yr always shows four charts, one per row.
  const year = $('decayRange').value === '1y';
  const grid = year || $('decayView').value === 'grid';
  $('decayView').querySelectorAll('md-outlined-segmented-button').forEach((b) => { b.disabled = year; });
  $('dGrid').classList.toggle('one', year);
  $('dChart').toggleAttribute('hidden', grid); // SVG elements have no .hidden property
  $('dGrid').hidden = !grid;
  if (grid) {
    // Each small chart has its own scale so strength is readable next to cardio.
    $('dGrid').innerHTML = DECAY_LINES.map(([label, k, color]) =>
      `<div><div class="md-typescale-label-large"><span class="dot" style="background:${color}"></span>${label} ${Math.round(series[back][k] * 100)}% now</div>` +
      `<svg class="dchart" viewBox="0 0 ${year ? '360 130' : '180 120'}" role="img" aria-label="${label}: recent work carried over time">${decaySvg(series, [[label, k, color]], niceTop([k]), year ? 360 : 180, year ? 130 : 120, !year, back)}</svg></div>`).join('');
  } else {
    $('dChart').setAttribute('viewBox', '0 0 360 170');
    $('dChart').innerHTML = decaySvg(series, DECAY_LINES, niceTop(DECAY_LINES.map((l) => l[1])), 360, 170, false, back);
  }
  $('dLegend').hidden = grid;
  $('dLegend').innerHTML = DECAY_LINES.map(([label, k, color]) =>
    `<span><span class="dot" style="background:${color}"></span>${label} ${Math.round(series[back][k] * 100)}% now, ${Math.round(series[series.length - 1][k] * 100)}% in ${DECAY_AHEAD} days</span>`).join('');
  $('dNote').textContent = grid
    ? 'Each small chart has its own scale, so the heights are not comparable between them. Dashed and shaded means you log nothing new.'
    : 'Each line is how much recent work you are carrying in that category. A session pushes it up, and it fades while you rest. The higher the line, the less a new session of that kind would earn. Dashed and shaded means you log nothing new.';
}

function renderFresh() {
  const { multipliers } = Engine.freshness(result, todayIso());
  const rows = [['Cardio', 'cardio'], ['Upper', 'upper'], ['Lower', 'lower'], ['Core', 'core']];
  $('fresh').innerHTML = rows.map(([label, k]) => {
    const pct = Math.round(multipliers[k] * 100);
    return `<span>${label}</span><md-linear-progress class="c-${k}" value="${multipliers[k]}" max="1"></md-linear-progress><span>${pct}%</span>`;
  }).join('');
  const best = rows.reduce((a, b) => (multipliers[b[1]] > multipliers[a[1]] ? b : a));
  $('bestMove').textContent = `How much of face value the first mile or set would earn if you did it today. ${best[0]} is the freshest.`;
}

function renderPreview() {
  if (!result) return;
  const date = $('when').value || todayIso();
  let p, label;
  const type = $('type').value;
  if (type === 'run') {
    const miles = parseFloat($('miles').value), mph = parseFloat($('mph').value), grade = parseFloat($('rgrade').value) || 0;
    if (!(miles > 0) || !(mph > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewRun(result, date, miles, mph, $('where').value === 'tm', grade);
    label = `${miles} mi at ${mph} mph` + (grade ? `, ${grade}% incline` : '');
  } else if (type === 'walk') {
    const min = parseFloat($('wmin').value), mph = parseFloat($('wmph').value), grade = parseFloat($('wgrade').value) || 0, vest = parseFloat($('wvest').value) || 0;
    if (!(min > 0) || !(mph > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewWalk(result, date, min, mph, grade, vest);
    label = `Walk ${min} min at ${mph} mph` + (grade ? `, ${grade}% incline` : '') + (vest ? `, ${vest} lb vest` : '');
  } else {
    const sets = parseFloat($('sets').value), ex = parseFloat($('exercises').value) || 1;
    if (!(sets > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewStrength(result, date, $('tag').value, sets, ex);
    label = `${sets} sets of ${Math.round(ex)} exercise${Math.round(ex) === 1 ? '' : 's'}, ${$('tag').value}`;
  }
  $('preview').textContent = `${label}: face value ${f1(p.raw)}, credit ${f1(p.credit)} (${Math.round((100 * p.credit) / p.raw)}%)`;
}

['type', 'when', 'miles', 'mph', 'rgrade', 'where', 'wmin', 'wmph', 'wgrade', 'wvest', 'tag', 'sets', 'exercises'].forEach((id) => ['input', 'change'].forEach((ev) => $(id).addEventListener(ev, () => {
  if (id === 'type') {
    const t = $('type').value;
    $('runInputs').hidden = t !== 'run';
    $('walkInputs').hidden = t !== 'walk';
    $('strInputs').hidden = t !== 'strength';
  }
  renderPreview();
})));

// ---- Running goal ----
function renderRunning(text) {
  const year = todayIso().slice(0, 4);
  const s = Running.yearSeries(Engine.parseCsv(text), Number(year), todayIso());
  $('noRun').hidden = true;
  $('runCard').hidden = false;
  $('runTitle').textContent = `${year} miles vs. ${Running.DEFAULTS.milesPerDay} mi/day goal`;
  $('runTotal').textContent = `${f1(s.total)} mi`;
  $('runAhead').textContent = `${f1(Math.abs(s.aheadBy))} mi ${s.aheadBy >= 0 ? 'ahead of' : 'behind'} goal pace`;
  $('runStats').textContent = `${s.active} run days. At this pace you'd finish the year at ${Math.round(s.projected)} of ${s.goalTotal} mi. ` +
    (s.neededPerDay > 0 ? `To reach the goal, average ${s.neededPerDay.toFixed(2)} mi a day from here.` : 'The goal is reached.');

  const W = 360, H = 220, L = 34, R = 8, T = 8, B = 20;
  const n = s.daily.length;
  const top = Math.max(s.daily[n - 1].miles, s.daily[n - 1].goal) * 1.05 || 1;
  const x = (i) => L + (n > 1 ? (i * (W - L - R)) / (n - 1) : 0);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const step = [50, 100, 200, 250, 500].find((v) => top / v <= 5) || 1000;
  let svg = '';
  for (let v = 0; v <= top; v += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="lbl" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  svg += monthLabels(s.daily, x, H);
  const pts = (k) => s.daily.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  svg += `<polyline class="goal" points="${pts('goal')}"/><polyline class="run" points="${pts('miles')}"/>`;
  svg += `<circle cx="${x(n - 1)}" cy="${y(s.daily[n - 1].miles)}" r="3.5" style="fill:var(--md-sys-color-primary)"/>`;
  $('runChart').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('runChart').innerHTML = svg;
  renderDelta(s.daily);
}

// Month names along the bottom of a running chart; every other month when the range is long.
function monthLabels(daily, x, H) {
  const months = daily.map((d, i) => [d.date, i]).filter(([d]) => d.endsWith('-01'));
  const every = months.length > 6 ? 2 : 1;
  return months.filter((_, k) => !(k % every)).map(([d, i]) =>
    `<text class="lbl" x="${x(i)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : 'middle'}">${new Date(`${d}T12:00`).toLocaleDateString('en-US', { month: 'short' })}</text>`).join('');
}

// Miles ahead (positive) or behind (negative) goal pace, as an area against a zero line.
function renderDelta(daily) {
  $('deltaCard').hidden = false;
  const W = 360, H = 200, L = 34, R = 8, T = 8, B = 20;
  const n = daily.length;
  const d = daily.map((p) => p.miles - p.goal);
  const span = Math.max(1, ...d.map(Math.abs));
  const step = [5, 10, 20, 25, 50, 100].find((v) => (2 * span) / v <= 6) || 200;
  const hi = Math.max(step, Math.ceil(Math.max(0, ...d) / step) * step);
  const lo = Math.min(-step, Math.floor(Math.min(0, ...d) / step) * step);
  const x = (i) => L + (n > 1 ? (i * (W - L - R)) / (n - 1) : 0);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  let svg = '';
  for (let v = lo; v <= hi; v += step) {
    svg += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="lbl" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? '+' : ''}${v}</text>`;
  }
  svg += monthLabels(daily, x, H);
  const line = d.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  svg += `<polygon class="area" points="${x(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)}"/>`;
  svg += `<polyline class="run" points="${line}"/>`;
  svg += `<circle cx="${x(n - 1)}" cy="${y(d[n - 1])}" r="3.5" style="fill:var(--md-sys-color-primary)"/>`;
  $('deltaChart').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('deltaChart').innerHTML = svg;
}

// ---- Body weight ----
let weights = [];
const DAY_MS = 86400000;

function loadWeight() {
  const text = localStorage.getItem('weightCsv');
  weights = text ? Weight.parseWeights(text) : [];
  $('weightCard').hidden = !weights.length;
  $('noWeight').hidden = !!weights.length;
  if (weights.length) renderWeight();
}

function renderWeight() {
  const range = Weight.RANGES.find((r) => r.key === $('wRange').value) || Weight.RANGES.find((r) => r.key === Weight.DEFAULTS.defaultRange);
  const span = parseFloat($('wSpan').value);
  $('wSpanOut').textContent = span.toFixed(2);
  const { start, end, points } = Weight.filterRange(weights, range.months, Date.now());
  const svg = $('wChart');
  if (!points.length) {
    svg.innerHTML = '';
    $('wSummary').textContent = `No readings in the ${range.label.toLowerCase()}.`;
    $('wNote').textContent = '';
    return;
  }
  // x is in days so the local fits stay well conditioned
  const smooth = Weight.loess(points.map((p) => ({ x: p.t / DAY_MS, y: p.pounds })), span);
  const first = smooth[0], last = smooth[smooth.length - 1];
  const delta = last - first;
  $('wSummary').textContent = `Trend ${f1(last)} lb, ${delta >= 0 ? '+' : '-'}${f1(Math.abs(delta))} over the range`;
  const at = (localStorage.getItem('weightCsvAt') || '').slice(0, 10);
  $('wNote').textContent = `${points.length} readings shown. ${localStorage.getItem('weightCsvName') || 'Body tracker CSV'}, imported ${at}.`;

  // Chart geometry
  const W = 520, H = 260, pad = { t: 10, r: 12, b: 26, l: 40 };
  const ys = points.map((p) => p.pounds).concat(smooth);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = (hi - lo || 1) * 0.08;
  lo = Math.floor(lo - padY); hi = Math.ceil(hi + padY);
  const sx = (t) => pad.l + ((t - start) / (end - start)) * (W - pad.l - pad.r);
  const sy = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const rawStep = (hi - lo) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = mag * ([1, 2, 5, 10].find((m) => m * mag >= rawStep) || 10);
  let out = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    out += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${sy(v)}" y2="${sy(v)}"/>` +
           `<text class="lbl" x="${pad.l - 6}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`;
  }
  // Month labels along the bottom; thin them out on long ranges
  const everyN = Math.max(1, Math.round(range.months / 6));
  const m = new Date(start);
  m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() + 1);
  for (let i = 0; m.getTime() <= end; m.setMonth(m.getMonth() + 1), i++) {
    if (i % everyN) continue;
    const label = m.toLocaleDateString('en-US', { month: 'short', year: range.months > 12 ? '2-digit' : undefined });
    out += `<line class="grid" x1="${sx(m.getTime())}" x2="${sx(m.getTime())}" y1="${pad.t}" y2="${H - pad.b}"/>` +
           `<text class="lbl" x="${sx(m.getTime())}" y="${H - pad.b + 14}" text-anchor="middle">${label}</text>`;
  }
  out += points.map((p) => `<circle class="pt" cx="${sx(p.t).toFixed(1)}" cy="${sy(p.pounds).toFixed(1)}" r="2.5"/>`).join('');
  out += `<path class="trend" d="${points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(smooth[i]).toFixed(1)}`).join(' ')}"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out;
}

$('wRange').addEventListener('change', renderWeight);
$('decayView').value = localStorage.getItem('decayView') || 'one';
$('decayView').addEventListener('change', () => { localStorage.setItem('decayView', $('decayView').value); if (result) renderDecay(); });
$('decayRange').value = localStorage.getItem('decayRange') || '1m';
$('decayRange').addEventListener('change', () => { localStorage.setItem('decayRange', $('decayRange').value); if (result) renderDecay(); });
$('wSpan').addEventListener('input', renderWeight);

// ---- Feedback for Kiro ----
// Kept in localStorage so it survives reloads and app restarts. Export adds the version and date so Kiro knows which build it's about.
const fb = $('feedback');
fb.value = localStorage.getItem('feedback') || '';
fb.addEventListener('input', () => localStorage.setItem('feedback', fb.value));
const fbText = () => `Exercise score feedback (version ${VERSION}, ${todayIso()})\n\n${fb.value.trim()}\n`;
const fbSay = (msg) => { $('fbNote').textContent = msg; };
if (navigator.share) $('fbShare').hidden = false;
$('fbShare').addEventListener('click', async () => {
  if (!fb.value.trim()) return fbSay('Nothing to share yet.');
  try { await navigator.share({ title: 'Exercise score feedback', text: fbText() }); } catch (e) { /* closed the share sheet */ }
});
$('fbCopy').addEventListener('click', async () => {
  if (!fb.value.trim()) return fbSay('Nothing to copy yet.');
  try { await navigator.clipboard.writeText(fbText()); fbSay('Copied. Paste it into a Kiro chat.'); }
  catch (e) { fbSay('Copy failed. Select the text and copy it by hand.'); }
});
$('fbClear').addEventListener('click', () => {
  if (!fb.value || !confirm('Clear all feedback? Export it first if you still need it.')) return;
  fb.value = '';
  localStorage.removeItem('feedback');
  fbSay('Cleared.');
});

// ---- Import paths ----
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) importCsv(await file.text(), file.name);
});

async function takeSharedFile() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  const cache = await caches.open('shared-files');
  const res = await cache.match('shared-file');
  history.replaceState(null, '', location.pathname);
  if (!res) { $('importNote').textContent = 'Something was shared, but no file arrived.'; return; }
  importCsv(await res.text(), res.headers.get('x-file-name') || 'shared file');
  await cache.delete('shared-file');
}

loadWeight();
load();
takeSharedFile();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
