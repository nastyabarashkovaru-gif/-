/**
 * Типографика: короткие предлоги и союзы («с», «в», «на», «и»…) не остаются в конце строки —
 * пробел после них заменяется неразрывным; число тоже не отрывается от следующего слова. Работает для всего текста на экране, кроме полей ввода.
 */
const SHORT = /(^|[\s «(—-])(в|с|к|и|а|о|у|я|на|не|за|по|до|от|из|об|во|со|ко|без|для|при|про|что|как|ты|мы|но|же|ни|ли)( )(?=\S)/giu;

/** «30 дней», «3 месяца»: число не отрывается от слова */
const NUM = /(\d) (?=[а-яё₽]|\d{3}(?!\d))/giu;

function fix(text: string): string {
  let prev = text.replace(NUM, '$1\u00a0');
  for (;;) {
    const next = prev.replace(SHORT, (_, a: string, w: string) => `${a}${w} `);
    if (next === prev) return next;
    prev = next;
  }
}

function skip(node: Node) {
  const el = node.parentElement;
  return !el || el.closest('textarea, input, [contenteditable], script, style') !== null;
}

function fixNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (skip(node) || !node.nodeValue || !node.nodeValue.includes(' ')) return;
    const v = fix(node.nodeValue);
    if (v !== node.nodeValue) node.nodeValue = v;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) fixNode(n);
}

export function startTypography(root: HTMLElement) {
  fixNode(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixNode(m.target);
      else m.addedNodes.forEach(fixNode);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true });
}
