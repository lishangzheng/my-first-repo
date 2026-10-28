// Read the newest answer that is ALREADY on a site's page. Sends nothing,
// types nothing.
//
// Why this exists: when a slow model (Kimi with reasoning on) misses its budget,
// the answer is usually still on screen -- finished, or still filling in. The
// tempting reaction is to ask again, which duplicates the question in the user's
// chat history and makes the next comparison ambiguous. Reading the page again is
// cheap, silent and exact.
//
//   node lib/read-last.mjs kimi
//   node lib/read-last.mjs kimi --json
//   node lib/read-last.mjs kimi --wait 120     # keep polling up to 120s
//   node lib/read-last.mjs kimi --chars 12000  # do not truncate the answer
//
// exit 0 = text read, 1 = no answer on the page yet, 2 = usage/port problem.

import { connect, evaluate, sleep } from './cdp.mjs';
import { findTab, isStreaming } from './drive.mjs';
import { lastAnswerExpr } from './answer.mjs';
import { page as pageContract, SITES, site } from './sites.mjs';

const argv = process.argv.slice(2);
const key = argv[0];
if (!key || !SITES[key]) {
  process.stderr.write('usage: read-last.mjs <' + Object.keys(SITES).join('|') + '>'
    + ' [--json] [--chars N] [--wait SEC]\n');
  process.exit(2);
}

const num = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const asJson = argv.includes('--json');
const maxChars = num('--chars', 4000);
const waitSec = num('--wait', 0);

const s = site(key);
const page = pageContract(key);
const started = Date.now();

const tab = await findTab(s);
if (!tab) {
  process.stderr.write('no ' + key + ' tab on 127.0.0.1:' + s.port + ' -- is the channel up? (bridge\\status.ps1)\n');
  process.exit(2);
}

const session = await connect(tab);
try {
  // Deliberately NO Page.bringToFront and NO visibility emulation: those exist so
  // a *send* is accepted (the Qianwen client refuses to submit while hidden).
  // Reading needs neither, and skipping them keeps this tool from stealing focus
  // or disturbing a run that another session may be driving in the same tab.
  const readExpr = lastAnswerExpr(page.answers, { scrollBottom: true });
  const deadline = started + waitSec * 1000;
  const quietMs = page.quietMs ?? 2500;

  let text = '';
  let stableSince = 0;
  let lastBeat = Date.now();

  // One read is enough unless --wait was given: this tool reports, it does not
  // silently sit on the user's terminal.
  while (true) {
    const now = await evaluate(session, readExpr);
    if (now && now === text) {
      if (!stableSince) stableSince = Date.now();
      const generating = await isStreaming(session, page.streaming);
      if (!generating && Date.now() - stableSince >= quietMs) break;
      if (Date.now() - stableSince >= (page.staleBreakMs ?? quietMs * 4)) break;
    } else {
      text = now || '';
      stableSince = 0;
    }

    if (Date.now() >= deadline) break;
    if (Date.now() - lastBeat > 15000) {
      lastBeat = Date.now();
      process.stderr.write('[' + key + '] still reading, ' + Math.round((Date.now() - started) / 1000)
        + 's, ' + text.length + ' chars so far\n');
    }
    await sleep(1500);
  }

  const generating = await isStreaming(session, page.streaming);
  const answer = text || '';
  const payload = {
    site: s.key,
    label: s.label,
    url: await evaluate(session, 'location.href'),
    chars: answer.length,
    truncated: answer.length > maxChars,
    generating,
    elapsedMs: Date.now() - started,
    answer: answer.length > maxChars ? answer.slice(0, maxChars) + '\n...[truncated, use --chars]' : answer,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write('site     : ' + payload.site + ' (' + payload.label + ')\n');
    process.stdout.write('url      : ' + payload.url + '\n');
    process.stdout.write('chars    : ' + payload.chars + (payload.truncated ? ' (truncated)' : '') + '\n');
    process.stdout.write('generating: ' + payload.generating + '\n');
    process.stdout.write('--- answer on page ---\n' + (answer ? payload.answer : '(nothing yet)') + '\n');
  }

  process.exitCode = answer ? 0 : 1;
} finally {
  session.close();
}
