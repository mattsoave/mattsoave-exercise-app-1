const VERSION = 6;
const $ = (id) => document.getElementById(id);
$('ver').textContent = VERSION;

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
  $('importNote').textContent = `${name}: ${weights.length} weight readings imported.`;
}

function load() {
  const text = localStorage.getItem('csv');
  if (!text) return;
  result = Engine.score(text);
  const last = result.entries[result.entries.length - 1].date;
  const at = (localStorage.getItem('csvAt') || '').slice(0, 10);
  $('importNote').textContent =
    `${localStorage.getItem('csvName') || 'CSV'}: ${result.entries.length} sessions, latest ${last}, imported ${at}.` +
    (result.unmapped.length ? ` Not scored (unknown muscle group): ${result.unmapped.join(', ')}.` : '');
  $('data').hidden = false;
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
  $('splitC').style.width = `${share}%`;
  $('splitS').style.width = `${100 - share}%`;
  $('keyC').textContent = `Cardio ${f1(t.cardio)} (${f1(t.miles)} mi run` + (t.walkMiles ? `, ${f1(t.walkMiles)} mi walked` : '') + `, ${t.cardioDays} days)`;
  $('keyS').textContent = `Strength ${f1(t.strength)} (${t.strengthDays} days)`;

  // Last 12 calendar weeks, including empty ones
  const byWeek = new Map(Engine.weekly(result.entries).map((w) => [w.week, w]));
  const mondayOf = (iso) => Engine.isoFromDay(Engine.dayNumber(iso) - ((Engine.dayNumber(iso) + 3) % 7));
  const thisMonday = Engine.dayNumber(mondayOf(today));
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const k = Engine.isoFromDay(thisMonday - 7 * i);
    weeks.push(byWeek.get(k) || { week: k, cardio: 0, strength: 0 });
  }
  const max = Math.max(1, ...weeks.map((w) => w.cardio + w.strength));
  $('weeks').innerHTML = weeks.map((w) =>
    `<div class="w" title="${w.week}: ${f1(w.cardio + w.strength)}">` +
    `<span class="c" style="height:${(100 * w.cardio) / max}%"></span><span class="s" style="height:${(100 * w.strength) / max}%"></span></div>`).join('');
  $('weekLabels').innerHTML = weeks.map((w) => `<span>${w.week.slice(5)}</span>`).join('');

  renderFresh();
  renderPreview();
}

function renderFresh() {
  const { multipliers } = Engine.freshness(result, todayIso());
  const rows = [['Cardio', 'cardio'], ['Upper', 'upper'], ['Lower', 'lower'], ['Core', 'core']];
  $('fresh').innerHTML = rows.map(([label, k]) => {
    const pct = Math.round(multipliers[k] * 100);
    return `<span>${label}</span><md-linear-progress value="${multipliers[k]}" max="1"></md-linear-progress><span>${pct}%</span>`;
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
    const min = parseFloat($('wmin').value), mph = parseFloat($('wmph').value), grade = parseFloat($('wgrade').value) || 0;
    if (!(min > 0) || !(mph > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewWalk(result, date, min, mph, grade);
    label = `Walk ${min} min at ${mph} mph` + (grade ? `, ${grade}% incline` : '');
  } else {
    const sets = parseFloat($('sets').value);
    if (!(sets > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewStrength(result, date, $('tag').value, sets);
    label = `${sets} sets, ${$('tag').value}`;
  }
  $('preview').textContent = `${label}: face value ${f1(p.raw)}, credit ${f1(p.credit)} (${Math.round((100 * p.credit) / p.raw)}%)`;
}

['type', 'when', 'miles', 'mph', 'rgrade', 'where', 'wmin', 'wmph', 'wgrade', 'tag', 'sets'].forEach((id) => ['input', 'change'].forEach((ev) => $(id).addEventListener(ev, () => {
  if (id === 'type') {
    const t = $('type').value;
    $('runInputs').hidden = t !== 'run';
    $('walkInputs').hidden = t !== 'walk';
    $('strInputs').hidden = t !== 'strength';
  }
  renderPreview();
})));

// ---- Body weight ----
let weights = [];
const DAY_MS = 86400000;

function loadWeight() {
  const text = localStorage.getItem('weightCsv');
  weights = text ? Weight.parseWeights(text) : [];
  $('weightCard').hidden = !weights.length;
  if (weights.length) renderWeight();
}

function renderWeight() {
  const range = Weight.RANGES.find((r) => r.key === $('wRange').value) || Weight.RANGES[1];
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
$('wSpan').addEventListener('input', renderWeight);

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

load();
loadWeight();
takeSharedFile();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
