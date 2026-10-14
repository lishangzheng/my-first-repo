// Validate the text-diff reader against a live page.
//   node lib/diff-test.mjs qwen
// Prints the baseline block count, then what changed after a short wait.
// Used to prove the mechanism before wiring it into ask.mjs.

import { connect, evaluate, listTargets, sleep } from './cdp.mjs';
import { MEASURE_INSTALL } from './answer-diff.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
if (!key) { process.stderr.write('usage: diff-test.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
const session = await connect(tab);
try {
  console.log('install  :', await evaluate(session, MEASURE_INSTALL));
  console.log('baseline :', JSON.stringify(await evaluate(session, 'window.__dshMeasure()')));

  const before = await evaluate(session, `(() => {
    const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
    return { bodyLen: t.length, tail: t.slice(-160) };
  })()`);
  console.log('body     :', JSON.stringify(before));

  console.log('waiting 8s to see if anything streams...');
  await sleep(8000);
  const diff = await evaluate(session, 'window.__dshDiff()');
  console.log('diff     :', JSON.stringify(diff, null, 2));
} finally {
  session.close();
}
