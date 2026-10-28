// Controlled experiment: send one prompt and watch, second by second, what the
// page actually does. Prints visibility, composer content and the text diff, so
// "the site never answered" can be told apart from "the driver read the wrong
// element".
//
//   node lib/send-probe.mjs qwen "question" [--seconds 90] [--click]

import { connect, evaluate, listTargets, sleep } from './cdp.mjs';
import { MEASURE_INSTALL } from './answer-diff.mjs';
import { activate, clickSend, focusComposer, forceVisible, pressKey, typeInto } from './drive.mjs';
import { page as pageContract, site } from './sites.mjs';

const argv = process.argv.slice(2);
const key = argv[0];
const prompt = argv[1];
const secIdx = argv.indexOf('--seconds');
const seconds = secIdx >= 0 ? Number(argv[secIdx + 1]) : 90;
const useClick = argv.includes('--click');
if (!key || !prompt) { process.stderr.write('usage: send-probe.mjs <site> "<q>" [--seconds n] [--click]\n'); process.exit(2); }

const s = site(key);
const page = pageContract(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
const session = await connect(tab);

const state = `(() => {
  const el = document.querySelector(${JSON.stringify(page.composer)});
  return {
    vis: document.visibilityState,
    composer: el ? String(el.value !== undefined && el.value !== null ? el.value : el.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 40) : 'NO_COMPOSER',
    bodyLen: document.body.innerText.replace(/\\s+/g,' ').trim().length,
  };
})()`;

try {
  await activate(session);
  console.log('visibility    :', await forceVisible(session));
  await evaluate(session, MEASURE_INSTALL);
  await evaluate(session, 'window.__dshMeasure()');
  console.log('baseline state:', JSON.stringify(await evaluate(session, state)));

  await focusComposer(session, page.composer);
  await typeInto(session, prompt);
  const typed = await evaluate(session, state);
  console.log('after typing  :', JSON.stringify(typed));

  if (useClick || page.submit === 'click') {
    const clicked = await clickSend(session, page.send);
    console.log('clicked send  :', clicked);
    if (!clicked) await pressKey(session, 'Enter', 'Enter', 13);
  } else {
    await pressKey(session, 'Enter', 'Enter', 13);
    console.log('pressed Enter');
  }

  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    await sleep(10000);
    const st = await evaluate(session, state);
    const diff = await evaluate(session, 'window.__dshDiff()');
    const top = diff.length ? diff[0] : null;
    console.log(
      `t+${String(Math.round((Date.now() - start) / 1000)).padStart(3)}s`,
      `vis=${st.vis}`,
      `body=${st.bodyLen}`,
      `composer=${JSON.stringify(st.composer)}`,
      top ? `| grewBy=${top.grew} len=${top.len} key=${top.key.slice(0, 50)} text=${JSON.stringify(top.text.slice(-60))}` : '| NO TEXT CHANGE',
    );
  }
} finally {
  session.close();
}
