// Site registry for the local multi-model bridge.
//
// Each entry describes one already-logged-in model the bridge can drive: how to
// reach its debugging endpoint, which tab is the conversation, and how to
// read/fill/submit in its composer.
//
// This is the SINGLE owner of the per-site page contract. It used to be copied
// into ask.mjs / inspect-site.mjs / send-probe.mjs / clear-composer.mjs, which
// meant adding one model required four identical edits; adding Kimi is what
// finally collapsed them. Driver code reads `site(key).page` and never keeps
// its own copy.
//
// Every selector below was established by a live DOM probe (lib/dump-dom.mjs,
// lib/inspect-site.mjs), not by guessing: see the note on each site.

export const SITES = {
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek 网页版',
    port: 9222,
    newChatUrl: 'https://chat.deepseek.com/',
    // A conversation tab, or the landing page.
    match: (t) => t.type === 'page' && /chat\.deepseek\.com/.test(t.url),
    // Fast model. A short budget means a real failure is reported in ~3 minutes
    // instead of being hidden inside a long wait.
    timeoutSec: 180,
    page: {
      // A plain textarea: focus() plus insertText is enough.
      composer: 'textarea[placeholder]',
      send: 'div[role=button][class*="ds-button--circle"]',
      // The streaming answer bubble.
      answers: 'div.ds-markdown',
      streaming: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[class*="stop-generat"]'],
      submit: 'enter',
      composerFocus: 'focus',
    },
  },

  qwen: {
    key: 'qwen',
    label: '千问客户端',
    port: 9223,
    newChatUrl: 'https://www.qianwen.com/chat',
    match: (t) => t.type === 'page' && /qianwen\.com\/chat/.test(t.url),
    timeoutSec: 180,
    page: {
      // Slate editor inside the Qianwen client.
      composer: '[role=textbox][contenteditable=true]',
      // aria-label is the only reliable handle here. A class-based guess
      // (button[class*="size-9"]) matched 21 buttons and clicked the FIRST one --
      // "添加附件" -- so the click reported success while nothing was ever sent.
      send: 'button[aria-label="发送消息"], button[aria-label*="发送"]',
      // Scoped to the answer container on purpose: a bare `div.qk-markdown`
      // also matches chat.qianwen.com's THINKING process
      // (div.thinking-content-*) and empty placeholders, which produced a
      // thinking block as the "answer".
      answers: 'div.answer-common-card div.qk-markdown',
      streaming: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[class*="generating"]'],
      // Observed 2026-10-26: under load the client answers with a 25-character
      // notice ("当前访问人数过多，疯狂加服务器中，请稍后再试") and the driver read
      // it as a legitimate answer. Short + these phrases = not an answer.
      busyPattern: '访问人数过多|疯狂加服务器|稍后再试',
      // Click, not Enter: Enter alone did not submit in a controlled test.
      submit: 'click',
      // Slate: focus() does not move document.activeElement into it, so the
      // prompt never lands. It needs a real mouse click.
      composerFocus: 'click',
    },
  },

  kimi: {
    key: 'kimi',
    label: 'Kimi 网页版',
    // Shares the DeepSeek debug browser: one Chrome, two tabs. Kimi's own
    // desktop client CANNOT be bridged -- Kimi.exe refuses to start with any
    // debug switch and exits 1 with
    //   [kimi] refusing to start with debug switch present: --remote-debugging-port=...
    // (verified for --remote-debugging-port, --remote-debugging-pipe, --inspect
    // and --inspect-brk; the check lives in the binary, app.asar has no such
    // string). The web app is the same model, so this drives the web version.
    port: 9222,
    newChatUrl: 'https://www.kimi.com/',
    // www.kimi.com is a single-page app: a new conversation lands on
    // /chat/<uuid>, but the landing page stays "/?" -- so match the host, not a
    // path.
    match: (t) => t.type === 'page' && /(^|\/\/)(www\.)?kimi\.com([\/:?#]|$)/.test(t.url),
    // Prefer an actual conversation over the landing page when both are open.
    rank: (t) => (t.url.indexOf('/chat/') !== -1 ? 0 : 1),
    // Kimi is the slow one: with reasoning on it can think for minutes before the
    // answer block starts filling. 420s (7 min) is a ceiling, not an expectation
    // -- a normal reply arrives in 10-30s. Do NOT shorten this to "speed things
    // up": a premature timeout is what makes a caller re-ask and duplicate the
    // question in the user's history.
    timeoutSec: 420,
    page: {
      // A contenteditable div; insertText lands and a real mouse click focuses it.
      composer: '.chat-input-editor',
      // el.click() on this container submits. A real mouse click at its centre
      // did NOT submit in a controlled test (the event target is the inner
      // <svg>/<path>), while el.click() cleared the composer and opened a new
      // conversation every time.
      send: '.send-button-container',
      // Kimi renders the step-by-step "thinking / tool call" output into
      // .toolcall-content-text, and that block ALSO contains a .markdown node
      // (measured: len=7 "Simple answer." next to the real answer). Reading a
      // bare .markdown therefore returns the tool chatter; the :not() keeps only
      // the real answer block.
      answers: '.chat-content-item-assistant .markdown-container:not(.toolcall-content-text) .markdown',
      // Verified live: .current-model gains the "disabled" class as soon as the
      // turn starts and loses it when generation finishes. The send button's
      // own "disabled" class is NOT a generation signal -- it simply means the
      // composer is empty, and it stays on forever after an answer.
      streaming: ['.current-model.disabled'],
      submit: 'click',
      composerFocus: 'click',
      // Kimi pauses between chunks while it reasons, so "unchanged for 2.5s" (the
      // desk/DeepSeek assumption) is far too eager: it would cut a half-written
      // answer. 8s of silence is the new baseline here, and the hard cap that
      // ignores the "still generating" flag is 90s instead of 10s.
      quietMs: 8000,
      staleBreakMs: 90000,
      // Sidebar "new chat" control carries a stable data-testid.
      newChat: '[data-testid=sidebar-new-chat]',
      // Logged out, the sidebar shows a 登录 button; logged in it shows the
      // account name (e.g. 你的昵称 -- 这里只是举例，不要写真实账号). The composer
      // exists in BOTH states, so
      // the generic "login form and no composer" check cannot work here.
      loggedOut: "(() => { const u = document.querySelector('.user-info-container'); return !!u && /登录/.test(u.innerText || ''); })()",
      // Same shape as qianwen's queue notice; the blocker below catches the
      // redirect, this catches a bare busy reply that stayed on the page.
      busyPattern: '聊天的人太多|服务器繁忙',
      // Kimi answers a request over its free-tier limit by navigating to
      // /membership/pricing?from=okc_limit_notification and keeping the prompt
      // in the composer. Without this the driver would sit out its whole
      // timeout and report WEB_NO_PROGRESS, which hides the real cause.
      blocker: "(() => { if (location.href.indexOf('/membership/pricing') !== -1) return 'LIMIT_QUEUE: kimi redirected to the membership page (usage limit or peak-hour queue)'; const t = document.body.innerText || ''; if (/聊天的人太多|服务器繁忙/.test(t)) return 'LIMIT_QUEUE: kimi reports a busy queue'; return ''; })()",
    },
  },

  minimax: {
    key: 'minimax',
    label: 'MiniMax Code',
    // Third tab on the shared debug browser (9222).
    port: 9222,
    newChatUrl: 'https://agent.minimax.cn/',
    match: (t) => t.type === 'page' && /agent\.minimax\.(cn|io)/.test(t.url),
    // Prefer an open task over the landing page.
    rank: (t) => (t.url.indexOf('/mavis') !== -1 ? 0 : 1),
    // It is an agent: it may run tools and summarise for a minute or two.
    timeoutSec: 300,
    page: {
      composer: '[data-testid=message-textarea]',
      // A <div> that only becomes clickable when the composer has text; el.click()
      // submits (verified: URL moves to /mavis?id=... and the transcript grows).
      send: '[data-testid=send-button]',
      // The answer renders as markdown inside .matrix-markdown. Thinking/tool
      // output is separate (the transcript shows "共执行 N 秒"), and the last
      // .matrix-markdown is the answer.
      answers: '.matrix-markdown',
      // Present while the turn runs, gone when it ends (measured 0.5s..3.5s on a
      // short answer). [class*=streaming] is NOT usable: it stays on afterwards.
      streaming: ['[data-testid*=stop]', '[aria-label*=停止]'],
      submit: 'click',
      composerFocus: 'click',
      // Low credits surface as a banner near the composer; if it is ever read as
      // an answer it must not pass for one.
      busyPattern: '积分余额不足',
      quietMs: 3000,
      staleBreakMs: 30000,
    },
  },

  chatglm: {
    key: 'chatglm',
    label: '智谱清言',
    port: 9222,
    newChatUrl: 'https://chatglm.cn/main/alltoolsdetail',
    match: (t) => t.type === 'page' && /chatglm\.cn\//.test(t.url),
    rank: (t) => (t.url.indexOf('cid=') !== -1 ? 0 : 1),
    timeoutSec: 180,
    page: {
      composer: 'textarea',
      // Enter submits (verified: URL gains &cid=..., composer clears). Clicking the
      // .enter div does NOT submit -- that was tried first and did nothing.
      // NOTE: this site needs the full key sequence (keyDown + char + keyUp);
      // pressEnter() sends all three.
      submit: 'enter',
      composerFocus: 'click',
      // The answer lives in .answer-content-wrap; the "thinking" block above it
      // (.advance-thinking, text 思考结束) shares the outer .answer-content, so the
      // selector is scoped to the answer wrapper.
      answers: '.answer-content-wrap .markdown-body',
      // Verified live: .enter grows a "searching" class while streaming and loses
      // it when the reply is done. Without it the 2.5s quiet window would cut a
      // long pause mid-answer (measured: one reply sat at 7-21 chars for 5s
      // before jumping to 201).
      streaming: ['.enter.searching'],
      // Sidebar "新对话" is a div, not a button, so label matching missed it.
      newChat: '.new-session',
      // Same shape as the others: a short queue notice is not an answer.
      busyPattern: '访问人数过多|系统繁忙',
      quietMs: 3000,
      staleBreakMs: 30000,
    },
  },
};

export function site(key) {
  const s = SITES[key];
  if (!s) throw new Error(`unknown site "${key}" (known: ${Object.keys(SITES).join(', ')})`);
  return s;
}

/** The per-site page contract, validated so a half-added site fails loudly. */
export function page(key) {
  const s = site(key);
  if (!s.page) throw new Error(`site "${key}" has no page contract`);
  return s.page;
}

/** Every site the cross-check asks by default, in report order. */
export const DEFAULT_SITES = ['qwen', 'deepseek', 'kimi', 'chatglm', 'minimax'];
