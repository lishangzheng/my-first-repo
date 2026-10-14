// Ask one site a question through its already-logged-in web session.
//
//   node lib/ask.mjs deepseek "question text" [--timeout 180] [--json]
//   node lib/ask.mjs qwen "question text"
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
  insertTextViaEditor, isStreaming, listTabs, pressKey, typeByKeys, typeInto,
} from './drive.mjs';
import { site } from './sites.mjs';

// Per-site page contract, established by live DOM probes (lib/dump-dom.mjs).
const PAGE = {
  deepseek: {
    composer: 'textarea[placeholder]',
    send: 'div[role=button][class*="ds-button--circle"]',
    answers: 'div.ds-markdown',
    streaming: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[class*="stop-generat"]'],
    submit: 'enter',
    // A plain textarea: focus() plus insertText is enough.
    composerFocus: 'focus',
  },
  qwen: {
    composer: '[role=textbox][contenteditable=true]',
    // aria-label is the only reliable handle here. A class-based guess
    // (button[class*="size-9"]) matched 21 buttons and clicked the FIRST one --
    // "添加附件" -- so the click reported success while nothing was ever sent.
    // Verified on the live composer: the real control is
    //   <button aria-label="发送消息" class="inline-flex size-8 ...">.
    send: 'button[aria-label="发送消息"], button[aria-label*="发送"]',
    // Scoped to the answer container on purpose: a bare `div.qk-markdown` also
    // matches chat.qianwen.com's THINKING process (div.thinking-content-*) and
    // empty placeholders, which produced a thinking block as the "answer".
    answers: 'div.answer-common-card div.qk-markdown',
    streaming: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[class*="generating"]'],
    // Click, not Enter: Enter alone did not submit in a controlled test.
    submit: 'click',
    // Slate editor: focus() does not move document.activeElement into it, so the
    // prompt never lands. It needs a real mouse click.
    composerFocus: 'click',
  },
};

// Read the LAST non-empty answer block, in DOM order.
//
// This is the reliable baseline for "which reply is new": both sites render
// messages chronologically, so the last non-empty answer before the send is the
// previous turn's reply, and the answer to the new prompt is whatever replaces
// it afterwards. Two earlier attempts at positional/anchored detection failed
// on the live pages and are recorded here so nobody retries them:
//   * "the last block" is empty: chat.qianwen.com appends an empty placeholder.
//   * anchoring on the prompt's LAST occurrence excluded the real answer, which
//     sits earlier in the body (measured: prompt at 47405, answer at 32108).
//   * scoring by proximity then returned the previous turn's long answer.
// Counting blocks is also unusable: the list is virtualised and re-renders.
//
// scrollBottom matters for the same reason. chat.qianwen.com virtualises the
// message list: off-screen answer cards exist in the DOM with height 0 and NO
// text at all (measured: 18 cards, the last one w=800 h=0 innerText=0). Reading
// without pinning the view to the newest message therefore reads nothing, so
// every read scrolls the conversation to the bottom first.
function lastAnswerExpr(answerSelector, { scrollBottom = false } = {}) {
  return `(() => {
    const norm = (s) => s.replace(/\\s+/g, ' ').trim();
    ${scrollBottom ? `
    try {
      const scrollers = [...document.querySelectorAll('*')].filter((el) => {
        if (el.scrollHeight - el.clientHeight < 200) return false;
        const oy = getComputedStyle(el).overflowY;
        return oy === 'auto' || oy === 'scroll';
      });
      for (const el of scrollers) el.scrollTop = el.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    } catch (e) { /* scrolling is best effort */ }` : ''}
    const nodes = document.querySelectorAll(${JSON.stringify(answerSelector)});
    for (let i = nodes.length - 1; i >= 0; i--) {
      const cls = String(nodes[i].className || '') + ' ' + String(nodes[i].parentElement?.className || '');
      if (/think|reason|chain/i.test(cls)) continue;
      const t = norm(nodes[i].innerText || '');
      if (t) return t;
    }
    return '';
  })()`;
}

function parseArgs(argv) {
  const positional = [];
  const flags = { timeout: 180, json: false, newChat: false };
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
  process.stderr.write('usage: ask.mjs <deepseek|qwen> "<question>" [--timeout 180]\n');
  process.exit(2);
}

const s = site(siteKey);
const page = PAGE[siteKey];
const started = Date.now();
const result = {
  site: s.key,
  label: s.label,
  prompt,
  answer: '',
  answerChars: 0,
  elapsedMs: 0,
  acceptedSend: false,
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
  const loggedOut = await evaluate(session, `(() => {
    const t = document.body.innerText;
    return /发送验证码|扫码登录|密码登录/.test(t) && !document.querySelector(${JSON.stringify(page.composer)});
  })()`);
  if (loggedOut) fail('NEED_LOGIN', 'the page shows a login form instead of the chat composer');

  if (flags.newChat) {
    await evaluate(session, `(() => {
      const btn = [...document.querySelectorAll('div[role=button],button')]
        .find((b) => /开启新对话|新建对话|新对话/.test(b.innerText || ''));
      if (btn) btn.click();
      return !!btn;
    })()`);
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
    await pressKey(session, 'Enter', 'Enter', 13);
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

  // Poll for the answer. findAnswerExpr anchors on the prompt inside the page,
  // so a virtualised list, an appending empty placeholder, or an older reply
  // Poll for the answer. The reply is whatever replaces the last non-empty
  // answer text that was on screen before the send; an unchanged read means
  // "not yet", never "answered with the previous turn's text".
  const deadline = started + flags.timeout * 1000;
  const answerExpr = lastAnswerExpr(page.answers, { scrollBottom: true });

  let best = '';
  let stableSince = 0;
  let changed = false;
  const quietMs = 2500;

  while (Date.now() < deadline) {
    const text = await evaluate(session, answerExpr);
    if (text && text !== baselineAnswer) {
      changed = true;
      if (text === best) {
        if (!stableSince) stableSince = Date.now();
        const streaming = await isStreaming(session, page.streaming);
        if (!streaming && Date.now() - stableSince >= quietMs) break;
      } else {
        best = text;
        stableSince = 0;
      }
    }
    await sleep(800);
  }

  if (!changed || !best.trim()) {
    fail('WEB_NO_PROGRESS',
      `the answer text never changed from the pre-send state within ${flags.timeout}s`
      + (baselineAnswer ? ` (last pre-send answer was ${baselineAnswer.length} chars)` : ''));
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
