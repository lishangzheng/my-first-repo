// Site registry for the local two-model bridge.
//
// Each entry describes one already-logged-in web model the bridge can drive:
// how to reach its debugging endpoint, which tab is the conversation, and how
// to read/fill/submit in its composer. Composer details are filled in from
// live DOM probes rather than guessed, and can be refined per site without
// touching the driver.

export const SITES = {
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek 网页版',
    port: 9222,
    newChatUrl: 'https://chat.deepseek.com/',
    // A conversation tab, or the landing page.
    match: (t) => t.type === 'page' && /chat\.deepseek\.com/.test(t.url),
    reply: {
      // The streaming answer bubble.
      selector: 'div.ds-markdown',
      containerSelector: null,
    },
  },
  qwen: {
    key: 'qwen',
    label: '千问客户端',
    port: 9223,
    newChatUrl: 'https://www.qianwen.com/chat',
    match: (t) => t.type === 'page' && /qianwen\.com\/chat/.test(t.url),
    reply: {
      // Scoped deliberately: on chat.qianwen.com a bare `div.qk-markdown` also
      // matches the THINKING process (inside div.thinking-content-*) and empty
      // placeholders. Only div.answer-common-card holds the final answer.
      // Verified against the live DOM: answer chain is
      //   div.qk-markdown < div.markdown-pc-special-class < div.answer-common-card
      // while thinking is
      //   div.qk-markdown < div.markdown-pc-special-class < div.thinking-content-tIwPU3
      selector: 'div.answer-common-card div.qk-markdown',
      containerSelector: 'div.answer-common-card',
    },
  },
};

export function site(key) {
  const s = SITES[key];
  if (!s) throw new Error(`unknown site "${key}" (known: ${Object.keys(SITES).join(', ')})`);
  return s;
}
