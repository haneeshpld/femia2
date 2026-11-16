export { formatINR, percentOff } from '@femia/contracts';
import { formatINR as inr } from '@femia/contracts';
import type { MediaRef } from '@femia/contracts';
import { t } from '@femia/i18n';

/**
 * "Free shipping above ₹999", from the amount the owner set in Admin → Settings. Pages must never spell the amount
 * out themselves: once the owner changes it, the shop would be promising one thing and charging another.
 */
export const freeShippingText = (s: { freeShippingThreshold: number; flatFee: number }) =>
  s.flatFee === 0 || s.freeShippingThreshold === 0 ? t('shipping.freeAlways') : t('shipping.freeAbove', { amount: inr(s.freeShippingThreshold) });

/** srcset for a MediaRef: "/media/..480.webp 480w, ..." */
export const srcset = (m: MediaRef | null | undefined) =>
  m ? Object.entries(m.src).map(([w, u]) => `${u} ${w}w`).join(', ') : undefined;

export const src = (m: MediaRef | null | undefined, w: '480' | '960' | '1600' = '960') => m?.src[w] ?? m?.src['960'] ?? Object.values(m?.src ?? {})[0];

/** Very small, safe markdown → HTML for owner-edited rich text (headings, paragraphs, lists, bold, links, tables). */
export function richText(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\(((?:https?:\/\/|\/|mailto:|tel:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const blocks = md.replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (/^#{2,3} /.test(b)) { const lvl = b.startsWith('###') ? 3 : 2; return `<h${lvl}>${inline(b.replace(/^#{2,3} /, ''))}</h${lvl}>`; }
    if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    if (lines.length >= 2 && lines.every((l) => l.trim().startsWith('|')) && /^\|[\s:|-]+\|$/.test(lines[1]!.trim())) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...rows] = lines;
      return `<div class="table-wrap"><table><thead><tr>${cells(head!).map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

/** Owner headings may mark one italic accent with *asterisks*: "Just *landed*" → Just <em>landed</em>. */
/**
 * JSON for an inline <script> (JSON-LD, page data). Plain JSON.stringify would let a product title containing
 * "</script>" end the tag and run whatever follows; escaping < keeps it inert and still valid JSON.
 */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function emph(text: string | null | undefined): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text ?? '').replace(/\*(.+?)\*/g, '<em>$1</em>');
}
export const plain = (text: string | null | undefined) => (text ?? '').replace(/\*/g, '');
