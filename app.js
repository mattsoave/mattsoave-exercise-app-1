const VERSION = 3;
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
  $('keyC').textContent = `Cardio ${f1(t.cardio)} (${f1(t.miles)} mi, ${t.cardioDays} days)`;
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
  if ($('type').value === 'run') {
    const miles = parseFloat($('miles').value), mph = parseFloat($('mph').value);
    if (!(miles > 0) || !(mph > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewRun(result, date, miles, mph, $('where').value === 'tm');
    label = `${miles} mi at ${mph} mph`;
  } else {
    const sets = parseFloat($('sets').value);
    if (!(sets > 0)) { $('preview').textContent = ''; return; }
    p = Engine.previewStrength(result, date, $('tag').value, sets);
    label = `${sets} sets, ${$('tag').value}`;
  }
  $('preview').textContent = `${label}: face value ${f1(p.raw)}, credit ${f1(p.credit)} (${Math.round((100 * p.credit) / p.raw)}%)`;
}

['type', 'when', 'miles', 'mph', 'where', 'tag', 'sets'].forEach((id) => ['input', 'change'].forEach((ev) => $(id).addEventListener(ev, () => {
  if (id === 'type') { $('runInputs').hidden = $('type').value !== 'run'; $('strInputs').hidden = $('type').value === 'run'; }
  renderPreview();
})));

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
takeSharedFile();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
