// Structural-agnostic answer reader: snapshot every text-bearing block, then
// diff. Instead of guessing class names (which failed repeatedly on
// chat.qianwen.com, whose answers are not where its own class names suggest),
// this keys blocks by their Nth occurrence of tag+class and reports which one
// changed the most. The reply is whatever grew, wherever it lives.
//
//   window.__dshMeasure()  -> { keys: [...], texts: [...] }
//   window.__dshDiff()     -> [{ key, grew, len, text }] sorted by growth

export const MEASURE_INSTALL = `(() => {
  if (typeof window.__dshKeys === 'undefined') {
    window.__dshKeys = [];
    window.__dshEls = [];
    window.__dshTexts = [];
  }
  window.__dshMeasure = function () {
    const seen = new Map();
    const keys = [], els = [], texts = [];
    const all = document.body.querySelectorAll('*');
    for (const el of all) {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;
      let hasOwnText = false;
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.textContent && node.textContent.trim()) { hasOwnText = true; break; }
      }
      if (!hasOwnText) continue;
      const base = tag + '.' + String(el.className || '') + '#' + (el.id || '');
      const idx = seen.get(base) || 0;
      seen.set(base, idx + 1);
      let text = '';
      try { text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); } catch (e) { text = ''; }
      keys.push(base + '~' + idx);
      els.push(el);
      texts.push(text);
    }
    window.__dshKeys = keys;
    window.__dshEls = els;
    window.__dshTexts = texts;
    return { blocks: keys.length };
  };
  window.__dshDiff = function () {
    const out = [];
    if (!window.__dshEls) return out;
    for (let i = 0; i < window.__dshEls.length; i++) {
      const el = window.__dshEls[i];
      let now = '';
      try { now = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); } catch (e) { now = ''; }
      const before = window.__dshTexts[i] || '';
      const grew = now.length - before.length;
      if (grew > 0) out.push({ key: window.__dshKeys[i], grew, len: now.length, before: before.length, text: now });
    }
    out.sort((a, b) => b.grew - a.grew);
    return out.slice(0, 8);
  };
  return true;
})()`;
