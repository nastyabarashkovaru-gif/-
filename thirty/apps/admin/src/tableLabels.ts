/**
 * На телефоне таблицы показываются карточками (см. styles.css): каждой ячейке нужна подпись из заголовка столбца.
 * Подписи проставляются автоматически для всех таблиц, в том числе появившихся после загрузки данных.
 */
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
  if (!heads.length) return;
  for (const tr of table.querySelectorAll('tbody tr')) {
    [...tr.children].forEach((td, i) => {
      const h = heads[i];
      if (h && td.getAttribute('data-label') !== h) td.setAttribute('data-label', h);
    });
  }
}

export function startTableLabels() {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll('table').forEach((t) => label(t as HTMLTableElement));
  };
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(run);
    }
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
