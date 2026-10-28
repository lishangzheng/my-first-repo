// "Which answer is the new answer" -- one owner.
//
// Both the driver (ask.mjs) and the recovery tool (read-last.mjs) must read the
// same block, or a recovered answer would disagree with a freshly driven one.
// The rules here were each earned on a live page:
//
//   * Read the LAST non-empty answer in DOM order. Both sites render messages
//     chronologically, so before a send this is the previous turn and after it is
//     whatever replaced it.
//   * Skip blocks whose own class or parent class looks like thinking:
//     chat.qianwen.com renders its chain-of-thought into div.thinking-content-*,
//     and Kimi renders a "toolcall"/step block that ALSO contains a .markdown
//     node (measured: "Simple answer." right next to the real answer).
//   * Optionally scroll to the bottom first: chat.qianwen.com virtualises its
//     message list, so off-screen cards have height 0 and no text at all.

export function lastAnswerExpr(answerSelector, { scrollBottom = false } = {}) {
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
      // 'toolcall' is Kimi's step-by-step/tool block: it also contains a
      // .markdown node (measured: "Simple answer."), so it must be skipped even
      // if a loose selector ever matches it.
      if (/think|reason|chain|toolcall/i.test(cls)) continue;
      const t = norm(nodes[i].innerText || '');
      if (t) return t;
    }
    return '';
  })()`;
}
