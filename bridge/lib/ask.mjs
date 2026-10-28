// Ask one site a question through its already-logged-in web session.
//
//   node lib/ask.mjs deepseek "question text" [--timeout 180] [--json]
//   node lib/ask.mjs qwen "question text"
//   node lib/ask.mjs kimi "question text" [--new-chat]
//
// Prints the site's raw answer as JSON on stdout. Exit code 0 means an answer
// was really read back from the page; non-zero means it was not, with a coded
// reason, never a silent empty result.
//
// Design notes:
//   * The answer is located by ANCHORING on the prompt text inside the page and
//     only accepting non-empty answer blocks that begin after it, so a stale
//     reply already on screen, a virtualised list re-order, or an appended empty
//     placeholder can never be mistaken for this turn's answer.
//   * Waits for the text to stop growing (quiet period) rather than a fixed
//     sleep, so partial answers are not returned as complete.
//   * Never injects scripts into the page; the composer is driven with real
//     key events so the site's own state machine sees a genuine send.

import { connect, evaluate, sleep } from './cdp.mjs';
import {
  activate, clickComposer, clickSend, findTab, focusComposer, forceVisible,
  insertTextViaEditor, isStreaming, listTabs, pressEnter, pressKey, typeByKeys, typeInto,
} from './drive.mjs';
import { page as pageContract, site } from './sites.mjs';
// Reading "which block is the answer" now lives in answer.mjs: ask.mjs and the
// recovery tool (read-last.mjs) must agree on it, so there is one owner.
import { lastAnswerExpr } from './answer.mjs';
// The "is it settled?" decision is a pure function so it can be table-tested
// without a browser (lib/wait-policy.test.mjs). Qianwen's review asked for exactly
// this: prove the quiet/stale semantics on synthetic timelines, not by one run.
import { initialWaitState, nextWait } from './wait-policy.mjs';


function parseArgs(argv) {
  const positional = [];
  // timeout stays null unless the caller forces one: each site declares its own
  // budget in sites.mjs, because one number cannot fit both a 6-second answer
  // and a model that thinks for minutes.
  const flags = { timeout: null, json: false, newChat: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') flags.timeout = Number(argv[++i]);
    else if (a === '--json') flags.json = true;
    else if (a === '--new-chat') flags.newChat = true;
    else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [siteKey, prompt] = positional;

if (!siteKey || !prompt) {
  process.stderr.write('usage: ask.mjs <deepseek|qwen|kimi> "<question>" [--timeout <sec>] [--new-chat]\n');
  process.stderr.write('       --timeout defaults to the site budget declared in sites.mjs (kimi is the patient one)\n');
  process.exit(2);
}

const s = site(siteKey);
// The page contract lives in sites.mjs; asking for it here fails loudly for a
// site that was only half added.
const page = pageContract(siteKey);

// Wait budget: --timeout wins when given, otherwise the site's own default.
// Kimi is deliberately patient (its reasoning is slow); the short models keep a
// short budget so a real failure is still reported quickly.
const DEFAULT_TIMEOUT_SEC = 180;
const budgetSec = flags.timeout ?? s.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
const started = Date.now();
const result = {
  site: s.key,
  label: s.label,
  prompt,
  answer: '',
  answerChars: 0,
  elapsedMs: 0,
  acceptedSend: false,
  timeoutSec: budgetSec,
  error: null,
};

function fail(code, detail) {
  result.error = detail ? `${code}: ${detail}` : code;
  result.elapsedMs = Date.now() - started;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
}

const tab = await findTab(s);
if (!tab) {
  const tabs = await listTabs(s);
  fail('NO_TAB', `no ${s.key} tab on 127.0.0.1:${s.port}. tabs: ${tabs.map((t) => t.url).join(' | ')}`);
}

const session = await connect(tab);
try {
  await activate(session);

  // Must happen for every new CDP session: the Qianwen client's chat view
  // reports visibilityState "hidden" even when its window is on screen and
  // focused, and while hidden its composer accepts text but never submits it.
  // The emulation does not persist across sessions, so it is applied here.
  result.visibility = await forceVisible(session);

  // Guard: a visible login form means the session is gone; say so loudly.
  // 这里不需要填账号密码：桥接只检测登录页，绝不代填任何凭据。
  //
  // A site that keeps its composer while logged out (Kimi does: the whole web
  // app renders, only the account button says 登录) supplies its own expression,
  // because the generic "login form and no composer" test can never fire there.
  const loggedOutExpr = page.loggedOut
    ? page.loggedOut
    : `(() => {
    const t = document.body.innerText;
    return /发送验证码|扫码登录|密码登录/.test(t) && !document.querySelector(${JSON.stringify(page.composer)});
  })()`;
  const loggedOut = await evaluate(session, loggedOutExpr);
  if (loggedOut) fail('NEED_LOGIN', 'the page shows a login form instead of the chat composer');

  if (flags.newChat) {
    // A site with a stable handle for "new chat" uses it; the rest fall back to
    // matching the button's label.
    const newChatExpr = page.newChat
      ? `(() => { const b = document.querySelector(${JSON.stringify(page.newChat)}); if (!b) return false; b.click(); return true; })()`
      : `(() => {
      const btn = [...document.querySelectorAll('div[role=button],button')]
        .find((b) => /开启新对话|新建对话|新对话|新建任务/.test(b.innerText || ''));
      if (btn) btn.click();
      return !!btn;
    })()`;
    result.newChatClicked = await evaluate(session, newChatExpr);
    await sleep(1200);
  }

  // Baseline: the answer text on screen BEFORE this turn. Everything the driver
  // reports afterwards must differ from it, which is what makes a stale reply
  // impossible to mistake for this turn's answer.
  const baselineAnswer = await evaluate(session, lastAnswerExpr(page.answers));

  const focusOnce = async () => {
    if (page.composerFocus === 'click') await clickComposer(session, page.composer);
    else await focusComposer(session, page.composer);
  };

  await focusOnce();
  await typeInto(session, prompt);

  // Confirm the text really landed in the composer before submitting. A fresh
  // chat view can re-render and steal focus, in which case insertText goes
  // nowhere; retry once with a fresh focus before giving up.
  const readComposer = `(() => {
    const el = document.querySelector(${JSON.stringify(page.composer)});
    if (!el) return '';
    return String((el.value !== undefined && el.value !== null) ? el.value : el.innerText || '');
  })()`;

  // Escalating attempts, because the two sites need different input paths:
  // insertText suits DeepSeek's textarea, while Qianwen's Slate editor ignores
  // insertText and real key events alike and only accepts the editing command.
  let typed = await evaluate(session, readComposer);
  if (!typed || typed.trim().length === 0) {
    await sleep(600);
    await focusOnce();
    await typeInto(session, prompt);
    typed = await evaluate(session, readComposer);
  }
  if (!typed || typed.trim().length === 0) {
    await focusOnce();
    await insertTextViaEditor(session, page.composer, prompt);
    typed = await evaluate(session, readComposer);
  }
  if (!typed || typed.trim().length === 0) {
    await focusOnce();
    await typeByKeys(session, prompt);
    typed = await evaluate(session, readComposer);
  }
  if (!typed || typed.trim().length === 0) {
    fail('PROMPT_WRITE_STALLED',
      'composer stayed empty after insertText, the editing command and real key events');
  }

  if (page.submit === 'enter') {
    // Full key sequence (keyDown + char + keyUp): chatglm.cn ignores keydown alone.
    await pressEnter(session);
  } else {
    const clicked = await clickSend(session, page.send);
    if (!clicked) await pressKey(session, 'Enter', 'Enter', 13);
  }

  // The site accepted the send once the composer clears AND the filled text is
  // gone. Checking emptiness alone is not enough: an untouched composer is also
  // empty, which would report success for a message that was never sent.
  const sendDeadline = Date.now() + 15000;
  while (Date.now() < sendDeadline) {
    const now = await evaluate(session, readComposer);
    if (String(now || '').trim().length === 0) { result.acceptedSend = true; break; }
    await sleep(400);
  }
  if (!result.acceptedSend) {
    fail('SEND_REJECTED', 'composer still holds the prompt after Enter/click; the site did not accept the send');
  }

  // Poll for the answer. The reply is whatever replaces the last non-empty
  // answer text that was on screen before the send; an unchanged read means
  // "not yet", never "answered with the previous turn's text".
  //
  // MONOTONIC clock on purpose: Date.now() jumps across sleep/wake, and a
  // suspend mid-wait would look like a 30-minute "quiet" period and trip the
  // stale cap. performance.now() only moves forward. (Qianwen's review flagged
  // exactly this; it is the kind of bug that only appears after a coffee break.)
  const mono = () => performance.now();
  const startedMono = mono();
  const deadlineMono = startedMono + budgetSec * 1000;
  const answerExpr = lastAnswerExpr(page.answers, { scrollBottom: true });

  // How long the text must stay byte-identical before the answer counts as
  // finished, and a hard cap for pages that keep claiming "still generating".
  // Kimi thinks for a long time and pauses mid-answer, so it declares a much
  // wider window than the two fast models (sites.mjs).
  const quietMs = page.quietMs ?? 2500;
  const staleBreakMs = page.staleBreakMs ?? quietMs * 4;

  let waitState = initialWaitState();
  let endReason = 'budget';
  let lastGenerating = false;

  // Progress goes to stderr so stdout stays pure JSON. Without this a slow model
  // looks like a hang, which is exactly what tempts a caller into re-sending the
  // question (duplicating it in the user's history).
  let lastBeat = mono();

  while (mono() < deadlineMono) {
    // A site can refuse the turn outright: Kimi answers an over-quota or
    // peak-hour request by navigating to its membership page and keeping the
    // prompt in the composer. Checking here turns a silent wait (up to the full
    // 420s budget) into an immediate, coded failure that names the real cause.
    if (page.blocker) {
      const blocked = await evaluate(session, page.blocker);
      if (blocked) {
        const code = String(blocked).split(':')[0].trim();
        const detail = String(blocked).slice(String(blocked).indexOf(':') + 1).trim();
        fail(code, detail);
      }
    }

    if (mono() - lastBeat > 15000) {
      lastBeat = mono();
      const waited = Math.round((mono() - startedMono) / 1000);
      process.stderr.write('[' + s.key + '] waiting ' + waited + 's/' + budgetSec + 's'
        + ' (answer so far: ' + waitState.best.length + ' chars, generating: ' + lastGenerating + ')\n');
    }

    const text = await evaluate(session, answerExpr);
    // Only pay for the "still generating" probe when the text has settled; that
    // is the only moment the answer depends on it.
    if (text && text === waitState.best) {
      lastGenerating = await isStreaming(session, page.streaming);
    }

    const decision = nextWait(waitState, {
      now: mono(),
      text,
      generating: lastGenerating,
      baseline: baselineAnswer,
      quietMs,
      staleBreakMs,
    });
    waitState = decision.state;
    if (decision.action === 'done') { endReason = decision.reason; break; }

    await sleep(800);
  }

  const best = waitState.best;
  result.endReason = endReason;
  // A budget ending means the text we have may be half-written; say so instead of
  // returning it as a complete answer. (Qianwen's review P1-1: only 'did it
  // finish' counts, not 'did text appear'.)
  result.truncated = endReason === 'budget';
  result.staleCut = endReason === 'stale';

  if (!best.trim()) {
    // The message must point at the recovery path, not invite a re-send: a
    // re-send duplicates the question in the user's history.
    fail('WEB_NO_PROGRESS',
      `no new answer text within ${budgetSec}s`
      + (baselineAnswer ? ` (last pre-send answer was ${baselineAnswer.length} chars)` : '')
      + `; read the page again with read-last.mjs ${s.key} before re-sending`);
  }

  // The read can pick up trailing UI furniture that shares the answer container
  // (observed on chat.qianwen.com: "好的，交给工作助理模式继续完成"). It is a
  // fixed set of phrases, so trim only exact known tails rather than guessing.
  const UI_TAILS = [
    '好的，交给工作助理模式继续完成',
    '内容由AI生成，可能不准确，请注意核实',
  ];
  let cleaned = best.trim();
  for (const tail of UI_TAILS) {
    if (cleaned.endsWith(tail)) cleaned = cleaned.slice(0, -tail.length).trim();
  }

  // A queue/overload notice is not an answer. Length matters: a real reply can
  // legitimately QUOTE these phrases (e.g. explaining HTTP 429), so only a short
  // reply is treated as the notice itself.
  if (page.busyPattern && cleaned.length < 200 && new RegExp(page.busyPattern).test(cleaned)) {
    fail('BUSY_QUEUE', 'the site replied with a queue/overload notice instead of an answer: '
      + cleaned.slice(0, 80));
  }

  // A reply identical to the previous turn's is legitimate (repeated question),
  // so this is reported rather than treated as failure.
  result.sameAsPrevious = cleaned === baselineAnswer;

  result.answer = cleaned;
  result.answerChars = cleaned.length;
  result.elapsedMs = Date.now() - started;

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (err) {
  fail('DRIVER_ERROR', err.message);
} finally {
  session.close();
}
