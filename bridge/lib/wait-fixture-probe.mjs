// Drive the local fixture page through the SAME wait policy the real driver uses.
//
//   node lib/wait-fixture-probe.mjs <scenario> [--quiet 1000] [--stale 3000] [--budget 20000]
//
// Why: Kimi is rate-limited and Qianwen queues, so a live run cannot exercise the
// "keeps waiting" branches on demand. This fixture needs no site, no login and no
// network -- it opens its own tab, plays a scripted timeline, and reports which
// branch ended the wait. (Qianwen's review P0-1.)

import { connect, evaluate, sleep } from './cdp.mjs';
import { initialWaitState, nextWait } from './wait-policy.mjs';

const argv = process.argv.slice(2);
const scenario = argv[0] || 'earlystop';
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const quietMs = num('--quiet', 1000);
const staleBreakMs = num('--stale', 3000);
const budgetMs = num('--budget', 20000);
const host = '127.0.0.1:9222';

const here = new URL('./fixture/wait-fixture.html', import.meta.url).href;
const url = here + '?scenario=' + encodeURIComponent(scenario);

const res = await fetch('http://' + host + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
if (!res.ok) {
  process.stderr.write('could not open fixture tab: HTTP ' + res.status + '\n');
  process.exit(2);
}
const target = await res.json();
const session = await connect(target);

const startedAt = performance.now();
let state = initialWaitState();
let endReason = 'budget';
let lastText = '';

try {
  await sleep(400);
  while (performance.now() - startedAt < budgetMs) {
    const snap = await evaluate(session, `(() => ({
      text: (document.getElementById('answer') || {}).textContent || '',
      generating: !!((document.getElementById('gen') || {}).textContent || '').trim(),
    }))()`);
    lastText = snap.text;
    const decision = nextWait(state, {
      now: performance.now() - startedAt,
      text: snap.text,
      generating: snap.generating,
      quietMs,
      staleBreakMs,
    });
    state = decision.state;
    if (decision.action === 'done') { endReason = decision.reason; break; }
    await sleep(150);
  }
  const elapsed = Math.round(performance.now() - startedAt);
  const generating = await evaluate(session, "!!((document.getElementById('gen') || {}).textContent || '').trim()");
  process.stdout.write(JSON.stringify({
    scenario,
    config: { quietMs, staleBreakMs, budgetMs },
    endReason,
    elapsedMs: elapsed,
    chars: state.best.length,
    stillGenerating: generating,
    tail: lastText.slice(-40),
  }, null, 1) + '\n');
  process.exitCode = endReason === 'budget' ? 1 : 0;
} finally {
  session.close();
  try { await fetch('http://' + host + '/json/close/' + target.id); } catch {}
}
