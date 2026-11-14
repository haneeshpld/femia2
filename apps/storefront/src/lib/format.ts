export { formatINR, percentOff } from '@femia/contracts';
import type { MediaRef } from '@femia/contracts';

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
