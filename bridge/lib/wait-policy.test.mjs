// Table-driven tests for the wait policy, in the shape Qianwen's review asked
// for: each scenario is a synthetic timeline, each expects exactly ONE ending.
//
//   node lib/wait-policy.test.mjs
//
// No browser, no network, no site. Runs in milliseconds and pins down the
// semantics that a live run only samples by luck.

import { initialWaitState, nextWait } from './wait-policy.mjs';

const KIMI = { quietMs: 8000, staleBreakMs: 90000, deadlineMs: 420000, stepMs: 1000 };
const FAST = { quietMs: 2500, staleBreakMs: 10000, deadlineMs: 180000, stepMs: 1000 };

// Run a timeline: fn(t) -> { text, generating }. Returns the ending.
function runTimeline(cfg, durationMs, fn) {
  let state = initialWaitState();
  for (let t = 0; t <= durationMs; t += cfg.stepMs) {
    if (t >= cfg.deadlineMs) return { reason: 'budget', t: cfg.deadlineMs };
    const sample = fn(t);
    const r = nextWait(state, { now: t, text: sample.text, generating: sample.generating,
      baseline: cfg.baseline || '', quietMs: cfg.quietMs, staleBreakMs: cfg.staleBreakMs });
    state = r.state;
    if (r.action === 'done') return { reason: r.reason, t: t };
  }
  return { reason: 'exhausted', t: durationMs };
}

const cases = [];
const test = (name, fn) => cases.push({ name: name, fn: fn });
const rep = (ch, n) => new Array(Math.max(0, n) + 1).join(ch);

// --- the six timelines from the review ------------------------------------
test('slowstart: 30s of silence then streaming must NOT be cut early', () => {
  const end = runTimeline(KIMI, 60000, (t) => ({
    // grows 10 chars/tick from 30s, last change at 40s
    text: t < 30000 ? '' : rep('x', (Math.min(t, 40000) - 30000) * 10),
    generating: t >= 30000 && t < 40000,
  }));
  return { ok: end.reason === 'quiet' && end.t >= 47000 && end.t <= 51000, detail: end.reason + '@' + end.t };
});

test('longpause: internal pause while still generating -> stale, not quiet', () => {
  const end = runTimeline(KIMI, 250000, (t) => ({
    text: t < 1000 ? '' : 'partial answer',
    generating: true,
  }));
  return { ok: end.reason === 'stale' && end.t >= 89000 && end.t <= 92000, detail: end.reason + '@' + end.t };
});

test('stuckflag: indicator never clears, text frozen -> stale at the cap', () => {
  const end = runTimeline(FAST, 60000, (t) => ({ text: t < 1000 ? '' : 'frozen', generating: true }));
  return { ok: end.reason === 'stale' && end.t >= 9000 && end.t <= 12000, detail: end.reason + '@' + end.t };
});

test('earlystop: text settles and indicator clears -> quiet at the window', () => {
  const end = runTimeline(KIMI, 30000, (t) => ({ text: t < 1000 ? '' : 'done text', generating: false }));
  return { ok: end.reason === 'quiet' && end.t >= 7000 && end.t <= 10000, detail: end.reason + '@' + end.t };
});

test('blinkflag: indicator flickers while text grows -> no premature end', () => {
  const end = runTimeline(KIMI, 60000, (t) => ({
    // 1 char per tick, last change at 29s, then frozen
    text: t < 2000 ? '' : rep('y', t < 30000 ? Math.floor(t / 1000) : 29),
    generating: t < 30000 ? (t % 2000 === 0) : false,
  }));
  return { ok: end.reason === 'quiet' && end.t >= 37000, detail: end.reason + '@' + end.t };
});

test('rerender: same length, different content -> never mistaken for settled', () => {
  const end = runTimeline(KIMI, 120000, (t) => ({ text: 'v' + (t % 1000), generating: true }));
  return { ok: end.reason === 'stale' || end.reason === 'exhausted', detail: end.reason + '@' + end.t };
});

// --- budget and baseline ---------------------------------------------------
test('budget: never any text -> budget, never a fake answer', () => {
  const end = runTimeline(KIMI, 500000, () => ({ text: '', generating: true }));
  return { ok: end.reason === 'budget', detail: end.reason + '@' + end.t };
});

test('baseline: previous answer still on screen is not this turn answer', () => {
  const cfg = { quietMs: 8000, staleBreakMs: 90000, deadlineMs: 420000, stepMs: 1000,
    baseline: 'old answer from last turn' };
  const end = runTimeline(cfg, 60000, () => ({ text: 'old answer from last turn', generating: false }));
  return { ok: end.reason === 'exhausted', detail: end.reason + '@' + end.t };
});

let failed = 0;
for (const c of cases) {
  let res;
  try { res = c.fn(); } catch (e) { res = { ok: false, detail: 'threw: ' + e.message }; }
  if (res.ok) console.log('PASS  ' + c.name + '   (' + res.detail + ')');
  else { failed++; console.log('FAIL  ' + c.name + '   (' + res.detail + ')'); }
}
console.log('');
console.log(failed === 0 ? ('all ' + cases.length + ' scenarios passed') : (failed + ' of ' + cases.length + ' FAILED'));
process.exitCode = failed === 0 ? 0 : 1;
