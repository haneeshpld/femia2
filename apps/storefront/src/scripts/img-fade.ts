/**
 * Photos fade in over their placeholder colour instead of popping in. Only lazy images in the page content are
 * held, and only once this script runs (html.img-fade), so nothing is hidden if scripts fail.
 */
import { onPage } from '../lib/lifecycle.ts';

const done = (img: HTMLImageElement) => img.classList.add('is-loaded');
document.documentElement.classList.add('img-fade');

onPage(() => {
  const imgs = document.querySelectorAll<HTMLImageElement>('main img[loading="lazy"]:not(.is-loaded)');
  imgs.forEach((img) => {
    if (img.complete) { done(img); return; }
    img.addEventListener('load', () => done(img), { once: true });
    img.addEventListener('error', () => done(img), { once: true });
  });
  // never leave a photo hidden: reveal anything still pending after a few seconds
  const t = setTimeout(() => imgs.forEach(done), 4000);
  return () => clearTimeout(t);
});
