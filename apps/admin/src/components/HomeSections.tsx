import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { HomeSection } from '@femia/contracts/home';
import { Icon } from './Icon.tsx';
import { SectionSketch } from './SectionSketch.tsx';
import { Sheet } from './ui.tsx';

export type Block = {
  type: string; label: string; description?: string; note?: string; single?: boolean; pinned?: 'first';
  defaults?: Record<string, unknown>;
  fields: { id: string; type: string; label: string; itemLabel?: string; options?: { value: string; label: string }[] }[];
};

const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 7)}`;
const plain = (s: unknown) => (typeof s === 'string' ? s.replace(/\*/g, '').trim() : '');

/** One line saying what's in a section, in the owner's words: its heading and how much it shows. */
function summary(b: Block, s: HomeSection) {
  const d = s.data;
  const heading = s.type === 'hero' ? [plain(d.title), plain(d.titleAccent)].filter(Boolean).join(' ') : plain(d.heading);
  const bits: string[] = [];
  if (s.type === 'products') {
    const n = Number(d.count) || 4;
    bits.push(d.source === 'collection' ? `${n} from a collection` : d.source === 'category' ? `${n} from a category` : d.source === 'popular' ? `${n} most popular` : `${n} newest arrivals`);
  }
  if (s.type === 'categories' && !(d.items?.length)) bits.push('every category');
  for (const f of b.fields) {
    if (f.type !== 'list' || !Array.isArray(d[f.id]) || !d[f.id].length) continue;
    const n = d[f.id].length, w = (f.itemLabel ?? 'item').toLowerCase();
    bits.push(`${n} ${w}${n === 1 ? '' : 's'}`);
  }
  return [heading, ...bits].filter(Boolean).join(' · ');
}

/**
 * Home page builder: the owner's list of sections, top to bottom. Show or hide, reorder, edit, duplicate,
 * remove, add. Pinned sections (the main banner) stay first and can't be removed; single ones can't be added twice.
 */
export function HomeSections({ blocks, sections, onChange, errors, renderFields }: {
  blocks: Block[];
  sections: HomeSection[];
  onChange: (next: HomeSection[], focusId?: string) => void;
  errors: Record<string, string>;
  renderFields: (block: Block, index: number) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const byType = new Map(blocks.map((b) => [b.type, b]));

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length || byType.get(sections[j]!.type)?.pinned) return;
    const next = [...sections]; [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next);
  };
  const set = (i: number, patch: Partial<HomeSection>) => onChange(sections.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => { if (confirm(`Remove "${byType.get(sections[i]!.type)?.label}" from the home page? To keep its content but not show it, switch it off instead.`)) onChange(sections.filter((_, k) => k !== i)); };
  const duplicate = (i: number) => {
    const copy = { ...structuredClone(sections[i]!), id: newId(sections[i]!.type) };
    const next = [...sections]; next.splice(i + 1, 0, copy); onChange(next, copy.id); setOpen(copy.id);
  };
  const add = (b: Block) => {
    const s: HomeSection = { id: newId(b.type), type: b.type, enabled: true, data: structuredClone(b.defaults ?? {}) };
    onChange([...sections, s], s.id); setOpen(s.id); setAdding(false);
    setTimeout(() => document.getElementById(`hs-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const hasErr = (i: number) => Object.keys(errors).some((k) => k.startsWith(`home.sections.${i}.`) || k === `home.sections.${i}`);

  return (
    <div className="stack">
      <div className="row hs-head">
        <p className="muted">Your home page, top to bottom. Tap a section to change its words and photos. Switch one off to hide it without losing anything.</p>
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> Add a section</button>
      </div>
      <ol className="hs-list">
        {sections.map((s, i) => {
          const b = byType.get(s.type);
          if (!b) return null;
          const isOpen = open === s.id;
          const sum = summary(b, s);
          return (
            <li key={s.id} id={`hs-${s.id}`} className={`hs-item${s.enabled ? '' : ' is-hidden'}${isOpen ? ' is-open' : ''}`}>
              <div className="hs-row">
                <button className="hs-title" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  <SectionSketch type={s.type} />
                  <span className="hs-title__text">
                    <strong>{b.label}{!s.enabled && <span className="hs-off"> · hidden</span>}</strong>
                    {sum && <span className="muted small">{sum}</span>}
                  </span>
                </button>
                {hasErr(i) && <span className="badge badge--bad">Check fields</span>}
                <label className="hs-switch" title={b.pinned ? 'The main banner is always shown' : s.enabled ? 'Shown on the website' : 'Hidden from the website'}>
                  <input type="checkbox" checked={s.enabled} disabled={!!b.pinned} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label={`Show ${b.label} on the home page`} />
                  <span aria-hidden="true" />
                </label>
                {!b.pinned && (
                  <span className="hs-moves">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0 || !!byType.get(sections[i - 1]?.type ?? '')?.pinned} aria-label={`Move ${b.label} up`}><Icon name="chevronLeft" className="rot90" /></button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label={`Move ${b.label} down`}><Icon name="chevronRight" className="rot90" /></button>
                  </span>
                )}
                <button className="btn btn--quiet hs-edit" onClick={() => setOpen(isOpen ? null : s.id)} aria-label={isOpen ? `Close ${b.label}` : `Edit ${b.label}`}>
                  <Icon name={isOpen ? 'close' : 'edit'} size={18} /><span>{isOpen ? 'Close' : 'Edit'}</span>
                </button>
              </div>
              {isOpen && (
                <div className="hs-body stack">
                  {b.description && <p className="muted small">{b.description}</p>}
                  {b.note && <p className="hs-note small"><Icon name="settings" size={16} /><span>{b.note}</span>{b.note.includes('Settings') && <Link to="/settings">Open Settings</Link>}</p>}
                  {renderFields(b, i)}
                  <div className="row hs-foot">
                    <button className="btn btn--quiet" onClick={() => setOpen(null)}>Done</button>
                    {!b.pinned && !b.single && <button className="btn btn--ghost" onClick={() => duplicate(i)}><Icon name="copy" /> Duplicate</button>}
                    <span className="spacer" />
                    {!b.pinned && <button className="btn btn--danger" onClick={() => remove(i)}><Icon name="trash" /> Remove section</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {adding && (
        <Sheet title="Add a section" onClose={() => setAdding(false)}>
          <div className="hs-picker">
            {blocks.filter((b) => !b.pinned).map((b) => {
              const taken = !!b.single && sections.some((s) => s.type === b.type);
              return (
                <button key={b.type} className="hs-pick" disabled={taken} onClick={() => add(b)}>
                  <SectionSketch type={b.type} />
                  <span><strong>{b.label}</strong><span className="muted small">{taken ? 'Already on your home page' : b.description}</span></span>
                </button>
              );
            })}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>A new section goes at the bottom; move it with the arrows. Nothing changes on the website until you publish.</p>
        </Sheet>
      )}
    </div>
  );
}
