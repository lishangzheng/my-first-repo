// Shared automation primitives for driving a logged-in web model through CDP.
// Everything here works on whatever page the browser already shows; nothing is
// injected into the page and no page script is trusted.

import { connect, evaluate, listTargets, sleep } from './cdp.mjs';

/**
 * Find the conversation tab for a site, or undefined.
 *
 * A site may keep several tabs on one endpoint (Kimi has both a landing page and
 * /chat/<id> open in the shared browser). An optional `rank` on the site entry
 * orders the matches so the real conversation wins over the landing page --
 * otherwise the tab the driver picks would depend on Chrome's internal order.
 */
export async function findTab(s) {
  const targets = await listTargets(`127.0.0.1:${s.port}`);
  const matches = targets.filter(s.match);
  if (matches.length > 1 && typeof s.rank === 'function') {
    matches.sort((a, b) => s.rank(a) - s.rank(b));
  }
  return matches[0];
}

/** List every tab the bridge browser exposes, for diagnostics. */
export async function listTabs(s) {
  return listTargets(`127.0.0.1:${s.port}`);
}

/** Bring the page to the front of its window, so the user can watch. */
export async function activate(session) {
  try { await session.send('Page.bringToFront'); } catch { /* optional */ }
}

/**
 * Force the page into a visible, focused state for THIS CDP session.
 *
 * Required for the Qianwen client: its chat view reports
 * document.visibilityState === "hidden" even when the window is on screen and
 * is the foreground window (verified: GetForegroundWindow returned qianwen).
 * While hidden, the composer accepts text and the send button reports a click,
 * but the message is never submitted and the composer keeps its text -- a
 * controlled experiment showed no change for 70 seconds.
 *
 * The emulation is per-CDP-session, so every new connection must reapply it;
 * that is exactly why this lives here and is called on connect rather than once
 * at startup.
 */
export async function forceVisible(session, { width = 1270, height = 800 } = {}) {
  try {
    await session.send('Emulation.setVisibleSize', { width, height });
  } catch { /* not all targets support it */ }
  try {
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch { /* not all targets support it */ }
  try {
    return await session.send('Runtime.evaluate', {
      expression: 'document.visibilityState',
      returnByValue: true,
    }).then((r) => r?.result?.value ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * Focus the composer with a REAL mouse click at its centre.
 *
 * el.focus() is not enough on chat.qianwen.com: its composer is a Slate editor
 * (data-slate-editor="true") that manages its own selection, and focus() leaves
 * document.activeElement on an unrelated input, so Input.insertText has nowhere
 * to go and the prompt silently never lands. A trusted mouse event both focuses
 * the editor and lets Slate set up its selection.
 */
export async function clickComposer(session, composerSelector) {
  const box = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(composerSelector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`cannot click composer: ${composerSelector} not visible`);

  const base = { x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
  await sleep(200);
}

/** Focus the composer element. Returns a descriptor or throws. */
export async function focusComposer(session, composerSelector) {
  const ok = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(composerSelector)});
    if (!el) return { ok: false, reason: 'composer not found' };
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.selectionStart = el.selectionEnd = el.value.length;
    }
    return { ok: true, tag: el.tagName.toLowerCase(), placeholder: el.getAttribute('placeholder') || '' };
  })()`);
  if (!ok?.ok) throw new Error(`cannot focus composer: ${ok?.reason ?? 'unknown'}`);
  return ok;
}

/**
 * Type text into the focused composer using real key events.
 * React/Vue controlled inputs ignore value assignment, so this inserts text
 * through the browser's own input pipeline instead.
 */
export async function typeInto(session, text) {
  await session.send('Input.insertText', { text });
  await sleep(150);
}

/**
 * Insert text through the browser's own editing command.
 *
 * This is the path that works on chat.qianwen.com's Slate editor. A controlled
 * experiment ruled out the alternatives one by one, all of which reported a
 * click/focus success while the composer stayed empty:
 *   * Input.insertText           -> nothing landed
 *   * focus() + Input.insertText -> nothing landed
 *   * real mouse click at the composer centre -> nothing landed
 *   * per-character keyDown/char/keyUp -> nothing landed
 * execCommand('insertText') goes through the editing pipeline that fires
 * beforeinput/input, which is what Slate actually listens to.
 */
export async function insertTextViaEditor(session, composerSelector, text) {
  return evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(composerSelector)});
    if (!el) return { ok: false, reason: 'composer not found' };
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* selection setup is best effort */ }
    let ok = false;
    try { ok = document.execCommand('insertText', false, ${JSON.stringify(text)}); } catch (e) { ok = false; }
    const now = String(el.innerText || el.textContent || '');
    return { ok, len: now.replace(/\\s+/g, ' ').trim().length };
  })()`);
}
/**
 * Type text as per-character key events. Kept as the last-resort fallback for
 * editors that ignore both insertText and the editing command.
 */
export async function typeByKeys(session, text, { perCharDelayMs = 0 } = {}) {
  for (const ch of text) {
    if (ch === '\n') {
      await pressKey(session, 'Enter', 'Enter', 13);
      continue;
    }
    const code = ch.charCodeAt(0);
    const base = {
      key: ch,
      code: /[a-zA-Z0-9]/.test(ch) ? `Key${ch.toUpperCase()}` : '',
      text: ch,
      unmodifiedText: ch,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    };
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await session.send('Input.dispatchKeyEvent', { type: 'char', ...base });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    if (perCharDelayMs) await sleep(perCharDelayMs);
  }
  await sleep(200);
}

/** Click the send button if one is enabled; returns whether it clicked. */
export async function clickSend(session, sendSelector) {
  return evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(sendSelector)});
    if (!el) return false;
    const disabled = el.getAttribute('aria-disabled') === 'true'
      || el.hasAttribute('disabled')
      || /disabled/.test(String(el.className));
    if (disabled) return false;
    el.click();
    return true;
  })()`);
}

/**
 * Press Enter exactly as a keyboard does: keyDown, then char, then keyUp.
 *
 * chatglm.cn needs all three: keyDown+keyUp alone did nothing, while the full
 * sequence submitted the message. Sites that only look at keydown or keyup are
 * unaffected by the extra char event.
 */
export async function pressEnter(session) {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await session.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(150);
}

/** Press a real key via CDP (works even when no element reports focus). */
export async function pressKey(session, key, code, keyCode) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** Read N newest answer blocks and report their text. */
export async function readAnswers(session, answerSelector, limit = 4) {
  return evaluate(session, `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(answerSelector)})].slice(-${limit});
    return nodes.map((n) => ({ text: (n.innerText || '').trim(), len: (n.innerText || '').trim().length }));
  })()`);
}

/** Is the site currently producing output? */
export async function isStreaming(session, streamingSelectors) {
  const list = JSON.stringify(streamingSelectors);
  return evaluate(session, `(() => {
    const sels = ${list};
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    }
    return false;
  })()`);
}

/** True once the composer is empty again, which means the site accepted the send. */
export async function composerIsEmpty(session, composerSelector) {
  return evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(composerSelector)});
    if (!el) return false;
    const v = (el.value !== undefined && el.value !== null) ? el.value : el.innerText;
    return String(v || '').trim().length === 0;
  })()`);
}

export { connect, evaluate, sleep };
