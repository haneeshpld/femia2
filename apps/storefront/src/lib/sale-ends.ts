/**
 * "Sale ends in 5h 20m" under prices. Pages are edge-cached, so the countdown is worked out in the browser
 * from the end time, and only shown in the last three days of a sale.
 */
const SOON = 3 * 24 * 3600_000;
let timer: ReturnType<typeof setInterval> | undefined;

function text(ms: number) {
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `Sale ends in ${d}d ${h % 24}h`;
  if (h >= 1) return `Sale ends in ${h}h ${m % 60}m`;
  return `Sale ends in ${Math.max(1, m)} min`;
}

function tick() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-sale-ends]').forEach((el) => {
    const left = Date.parse(el.dataset.saleEnds!) - now;
    const show = left > 0 && left < SOON;
    el.hidden = !show;
    if (show) el.textContent = text(left);
  });
}

export function showSaleEnds() {
  tick();
  clearInterval(timer);
  if (document.querySelector('[data-sale-ends]')) timer = setInterval(tick, 30_000);
}
