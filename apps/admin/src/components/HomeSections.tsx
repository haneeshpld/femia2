import { useState, type ReactNode } from 'react';
import type { HomeSection } from '@femia/contracts/home';
import { Icon } from './Icon.tsx';
import { Sheet } from './ui.tsx';

export type Block = {
  type: string; label: string; description?: string; single?: boolean; pinned?: 'first';
  defaults?: Record<string, unknown>; fields: { id: string; type: string; label: string }[];
};

const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 7)}`;
const plain = (s: unknown) => (typeof s === 'string' ? s.replace(/\*/g, '') : '');

/**
 * Home page builder: the owner's list of sections. Show/hide, reorder, edit, duplicate, remove, add.
 * Pinned sections (the hero) stay first and can't be removed; single sections can't be added twice.
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
  const remove = (i: number) => { if (confirm(`Remove "${byType.get(sections[i]!.type)?.label}" from the home page? Its content will be deleted when you save.`)) onChange(sections.filter((_, k) => k !== i)); };
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
    <div className="card stack">
      <div className="card__head" style={{ marginBottom: 0 }}>
        <div><h2>Home page sections</h2><p className="muted small">Top to bottom, as shoppers see them. Hidden sections keep their content.</p></div>
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> Add section</button>
      </div>
      <ol className="hs-list">
        {sections.map((s, i) => {
          const b = byType.get(s.type);
          if (!b) return null;
          const isOpen = open === s.id;
          const title = plain(s.data.heading ?? s.data.title) || b.label;
          return (
            <li key={s.id} id={`hs-${s.id}`} className={`hs-item${s.enabled ? '' : ' is-hidden'}${isOpen ? ' is-open' : ''}`}>
              <div className="hs-row">
                <span className="hs-num" aria-hidden="true">{i + 1}</span>
                <button className="hs-title" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  <strong>{title}</strong>
                  <span className="muted small">{b.label}{!s.enabled && ' · hidden'}</span>
                </button>
                {hasErr(i) && <span className="badge badge--bad">Check fields</span>}
                <label className="hs-switch" title={b.pinned ? 'The hero is always shown' : s.enabled ? 'Shown on the website' : 'Hidden from the website'}>
                  <input type="checkbox" checked={s.enabled} disabled={!!b.pinned} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label={`Show ${title} on the home page`} />
                  <span aria-hidden="true" />
                </label>
                {!b.pinned && (
                  <>
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0 || !!byType.get(sections[i - 1]?.type ?? '')?.pinned} aria-label="Move up"><Icon name="chevronLeft" className="rot90" /></button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Move down"><Icon name="chevronRight" className="rot90" /></button>
                  </>
                )}
                <button className="icon-btn" onClick={() => setOpen(isOpen ? null : s.id)} aria-label={isOpen ? 'Close' : 'Edit'}><Icon name={isOpen ? 'close' : 'edit'} /></button>
              </div>
              {isOpen && (
                <div className="hs-body stack">
                  {b.description && <p className="muted small">{b.description}</p>}
                  {renderFields(b, i)}
                  {!b.pinned && (
                    <div className="row">
                      {!b.single && <button className="btn btn--quiet" onClick={() => duplicate(i)}><Icon name="copy" /> Duplicate</button>}
                      <span className="spacer" />
                      <button className="btn btn--danger" onClick={() => remove(i)}><Icon name="trash" /> Remove section</button>
                    </div>
                  )}
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
                  <strong>{b.label}</strong>
                  <span className="muted small">{taken ? 'Already on the page' : b.description}</span>
                </button>
              );
            })}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>New sections are added at the bottom; move them with the arrows. Nothing goes live until you publish.</p>
        </Sheet>
      )}
    </div>
  );
}
