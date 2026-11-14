/** "Add to Bag" fly-to-bag: a ghost of the product image arcs into the bag icon. Web Animations API, no library. */
export function flyToBag(from: Element | DOMRect | null | undefined, imageUrl?: string | null) {
  const bag = document.querySelector('[data-bag-button]');
  if (!bag || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return pulse(bag);
  const a = from instanceof Element ? from.getBoundingClientRect() : from;
  const b = bag.getBoundingClientRect();
  const size = Math.min(120, a.width);
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${a.left + a.width / 2 - size / 2}px`, top: `${a.top + a.height / 2 - size / 2}px`, width: `${size}px`, height: `${size * 1.25}px`,
    borderRadius: '12px', zIndex: '90', pointerEvents: 'none', background: imageUrl ? `center/cover url("${imageUrl}")` : 'var(--c-maroon)',
    boxShadow: '0 10px 30px -10px rgba(58,31,20,.45)',
  });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 80}px) scale(.55)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0.2 },
  ], { duration: 750, easing: 'cubic-bezier(.5,0,.3,1)' });
  anim.onfinish = () => { ghost.remove(); pulse(bag); };
}

function pulse(el: Element | null) {
  el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
}
