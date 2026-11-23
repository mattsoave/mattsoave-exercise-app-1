// Timers: a stopwatch, an EMOM (every minute on the minute) timer, and a lifting tempo metronome.
// Beeps are scheduled ahead on the Web Audio clock so they stay on time even when the page is busy.
// Every timer starts after a 3-second countdown.
(function () {
  const $ = (id) => document.getElementById(id);
  const COUNTDOWN = 3;      // seconds before the timer starts
  const LOOKAHEAD = 1.5;    // seconds of beeps scheduled ahead of the audio clock
  const TONE = { tick: 880, go: 1320, end: 440, up: 1047, top: 784, down: 523, bottom: 392 };

  let ctx = null;           // AudioContext, created on the first Start tap (browsers require a tap)
  let run = null;           // the running timer, or null
  let pending = [];         // scheduled oscillators, so Stop can silence them
  let wake = null;          // screen wake lock while a timer runs
  let swElapsed = 0;        // stopwatch seconds banked from earlier runs

  function beep(at, freq, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.02);
    pending.push(o);
    o.onended = () => { pending = pending.filter((x) => x !== o); };
  }

  const num = (id, fallback) => { const v = parseFloat($(id).value); return v >= 0 ? v : fallback; };
  const fmt = (s, tenths) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), r = s - 60 * m;
    return `${m}:${String(Math.floor(r)).padStart(2, '0')}` + (tenths ? `.${Math.floor((r % 1) * 10)}` : '');
  };
  const countdownBeeps = (s) => [[s - 3, TONE.tick, 0.12], [s - 2, TONE.tick, 0.12], [s - 1, TONE.tick, 0.12], [s, TONE.go, 0.3]];

  // Each mode returns { beeps(from, to) -> [[time, freq, dur]], show(now) -> [clock, status, done] }. `s` is when counting starts.
  const MODES = {
    stopwatch(s) {
      const list = countdownBeeps(s);
      return {
        beeps: (a, b) => list.filter(([t]) => t >= a && t < b),
        show: (now) => [fmt(swElapsed + Math.max(0, now - s), true), now < s ? `Starting in ${Math.ceil(s - now)}` : 'Running'],
      };
    },
    // With a hold time, each round is a hold then a rest (hold 20 in a 60-second round = 20 on, 40 off).
    emom(s) {
      const rounds = Math.max(1, Math.round(num('emomRounds', 10))), len = Math.max(5, num('emomSecs', 60));
      const hold = Math.min(len - 1, num('emomHold', 0));
      const list = countdownBeeps(s);
      for (let k = 1; k <= rounds; k++) {
        if (hold > 0) { // three short beeps, then a low beep when the hold ends and the rest starts
          const start = s + (k - 1) * len, r = start + hold;
          list.push(...[3, 2, 1].map((d) => [r - d, TONE.tick, 0.12]).filter(([t]) => t > start + 0.5), [r, TONE.end, 0.4]);
        }
        const t = s + k * len;
        if (k < rounds) list.push(...countdownBeeps(t));
        else list.push([t - 3, TONE.tick, 0.12], [t - 2, TONE.tick, 0.12], [t - 1, TONE.tick, 0.12], [t, TONE.end, 0.8]);
      }
      return {
        beeps: (a, b) => list.filter(([t]) => t >= a && t < b),
        show: (now) => {
          if (now < s) return [fmt(hold > 0 ? hold : len), `Starting in ${Math.ceil(s - now)}`];
          const k = Math.floor((now - s) / len);
          if (k >= rounds) return [fmt(0), `Done: ${rounds} rounds`, true];
          const into = now - s - k * len;
          if (hold > 0) return into < hold ? [fmt(hold - into), `Round ${k + 1} of ${rounds}: hold`] : [fmt(len - into), `Round ${k + 1} of ${rounds}: rest`];
          return [fmt(len - into), `Round ${k + 1} of ${rounds}`];
        },
      };
    },
    tempo(s) {
      const phases = [['Up', num('tUp', 1), TONE.up], ['Pause', num('tTop', 0), TONE.top], ['Down', num('tDown', 3), TONE.down], ['Hold', num('tBottom', 1), TONE.bottom]]
        .filter((p) => p[1] > 0);
      const cycle = phases.reduce((a, p) => a + p[1], 0) || 1;
      return {
        beeps: (a, b) => {
          const out = countdownBeeps(s).slice(0, 3).filter(([t]) => t >= a && t < b);
          for (let n = Math.max(0, Math.floor((a - s) / cycle)); s + n * cycle < b; n++) {
            let t = s + n * cycle;
            for (const [, d, f] of phases) { if (t >= a && t < b) out.push([t, f, 0.15]); t += d; }
          }
          return out;
        },
        show: (now) => {
          if (now < s) return ['Ready', `Starting in ${Math.ceil(s - now)}`];
          const n = Math.floor((now - s) / cycle);
          let t = s + n * cycle;
          for (const [name, d] of phases) { if (now < t + d) return [name, `Rep ${n + 1}`]; t += d; }
          return ['', `Rep ${n + 1}`];
        },
      };
    },
  };

  async function lockScreen() {
    try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed now */ }
  }
  document.addEventListener('visibilitychange', () => { if (run && document.visibilityState === 'visible') lockScreen(); });

  function tick() {
    if (!run) return;
    const now = ctx.currentTime;
    for (const [t, f, d] of run.mode.beeps(run.scheduled, now + LOOKAHEAD)) beep(Math.max(t, now), f, d);
    run.scheduled = now + LOOKAHEAD;
    const [clock, status, done] = run.mode.show(now);
    $('tClock').textContent = clock;
    $('tStatus').textContent = status;
    if (done) stop(false);
  }

  function start() {
    if (run) return;
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    const s = ctx.currentTime + COUNTDOWN;
    run = { kind: $('toolMode').value, s, scheduled: ctx.currentTime, mode: MODES[$('toolMode').value](s) };
    run.timer = setInterval(tick, 100);
    const frame = () => { if (run) { tick(); requestAnimationFrame(frame); } };
    requestAnimationFrame(frame);
    $('tStart').disabled = true;
    $('tStop').disabled = false;
    lockScreen();
  }

  // Stop silences anything scheduled. The stopwatch keeps its time so Start resumes it; the others reset.
  function stop(silence = true) {
    if (!run) return;
    const now = ctx.currentTime;
    if (silence) { pending.forEach((o) => { try { o.stop(); } catch (e) { /* already stopped */ } }); pending = []; }
    if (run.kind === 'stopwatch') {
      swElapsed += Math.max(0, now - run.s);
      $('tClock').textContent = fmt(swElapsed, true);
      $('tStatus').textContent = 'Stopped';
    }
    clearInterval(run.timer);
    run = null;
    if (wake) { wake.release(); wake = null; }
    $('tStart').disabled = false;
    $('tStop').disabled = true;
  }

  function reset() {
    stop();
    swElapsed = 0;
    show();
  }

  // Idle display for the selected mode.
  function show() {
    const m = $('toolMode').value;
    $('emomInputs').hidden = m !== 'emom';
    $('tempoInputs').hidden = m !== 'tempo';
    $('tClock').textContent = m === 'emom' ? fmt(num('emomHold', 0) > 0 ? num('emomHold', 0) : num('emomSecs', 60)) : m === 'tempo' ? 'Ready' : fmt(swElapsed, true);
    $('tStatus').innerHTML = '&nbsp;';
    $('tHint').textContent = {
      stopwatch: 'Counts up after a 3-second countdown. Stop pauses it; Start resumes after another countdown.',
      emom: 'Beeps at the start of each round, with three short beeps before it. With a hold time, a low beep ends each hold and the rest of the round is rest. A long low beep ends the last round.',
      tempo: 'A different tone starts each phase: high for up, low for down. Set a phase to 0 to skip it.',
    }[m] + ' Keep the app open and the screen on; Android may stop the beeps if you switch apps.';
  }

  $('tStart').addEventListener('click', start);
  $('tStop').addEventListener('click', () => stop());
  $('tReset').addEventListener('click', reset);
  $('toolMode').addEventListener('change', () => { stop(); show(); });
  ['emomSecs', 'emomHold'].forEach((id) => $(id).addEventListener('input', () => { if (!run) show(); }));
  show();
})();
