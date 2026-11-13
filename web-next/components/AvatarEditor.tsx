'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// "Choose Your Avatar" and "Customize Avatar" (port of anon-inbox/public/hy-avatar-ui.js). Every avatar
// is painted: Choose shows the 46 featured looks plus your own painted avatar; Customize builds one
// trait by trait (Style, Hair, Face, Accessories, Background), each choice showing the real painting.
// Male profiles only see male options, female profiles only female; non-binary profiles see all.
import { useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { state } from '@/lib/state';
import { BACKGROUNDS, SKINS, HAIR, BEARD, EYEWEAR, OUTFITS, portraitsFor, modernPreset, paintDefault, normalize, pictureOf } from '@/lib/avatar-core.js';
import { cachedAvatar, setCachedAvatar } from '@/lib/avatars';
import { Icon, Logo } from './ui';
import { openSheet, toast } from './overlay';

const kindOf = () => (state.profile && state.profile.gender === 'female' ? 'f' : state.profile && state.profile.gender === 'male' ? 'm' : 'x');
const same = (a: any, b: any) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
function Face({ cfg, xl = false }: { cfg: any; xl?: boolean }) {
  const c = normalize(cfg);
  return (
    <span className="av-face">
      <span className={`av-svg av-modern av-bg-${c.b}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pictureOf(c, xl ? 640 : 256)} alt="" loading="lazy" decoding="async" draggable={false} />
      </span>
    </span>
  );
}

// Open pages, so saving closes them all.
const open = new Set<() => void>();
function page(build: (close: () => void) => ReactNode, label: string) {
  const h = openSheet(build, { label, raw: true, onClose: () => { open.delete(h.close); } });
  open.add(h.close);
}

async function save(cfg: any) {
  const kind = kindOf();
  const clean = normalize(cfg);
  if (kind !== 'x' && clean.k !== kind) { toast('Pick an avatar that matches your profile', 'x'); return; }
  try {
    await api.setMyAvatar(clean);
    setCachedAvatar(state.profile.handle, clean);
    toast('Avatar saved', 'check');
    [...open].forEach((c) => c());
    open.clear();
  } catch (e) { toast(api.friendly(e), 'x'); }
}

// Where Customize starts: your painted avatar, or a painted one matching your profile.
function paintStart(cfg: any) {
  const kind = kindOf();
  const c = cfg ? normalize(cfg) : null;
  if (c && c.st === 'paint') return c;
  return paintDefault(c ? c.k : kind === 'm' ? 'm' : 'f', c ? c.b : 'pink');
}

// ---- Choose Your Avatar ------------------------------------------------------------------------
export function openAvatarPicker() { page((close) => <Picker close={close} />, 'Choose Your Avatar'); }
function Picker({ close }: { close: () => void }) {
  const kind = kindOf();
  const [filter, setFilter] = useState<string>(kind === 'x' ? 'all' : kind);
  const mine = cachedAvatar(state.profile.handle);
  const myPaint = mine && normalize(mine).st === 'paint' ? normalize(mine) : null;
  const [current, setCurrent] = useState<any>(() => (mine ? normalize(mine) : modernPreset(portraitsFor(kind === 'x' ? 'all' : kind)[0])));
  const tile = (cfg: any, label: string, key: string) => (
    <button key={key} className={`av-tile ${same(cfg, current) ? 'on' : ''}`} aria-label={label} aria-pressed={same(cfg, current)} onClick={() => setCurrent(normalize(cfg))}><Face cfg={cfg} /></button>
  );
  return (
    <section className="av-page av-choose" role="dialog" aria-modal="true" aria-label="Choose Your Avatar">
      <div className="av-top"><button className="plain-btn" aria-label="Back" onClick={close}><Icon name="back" /></button><Logo /><span /></div>
      <div className="av-head"><h1>Choose Your Avatar</h1><p>Create a unique look for your treehouse profile.</p></div>
      <div className="av-preview"><Face cfg={current} xl /></div>
      {kind === 'x' ? (
        <div className="cr-pills av-pills">{[['all', 'All'], ['m', '♂ Male'], ['f', '♀ Female']].map(([id, label]) => (
          <button key={id} className={`cr-pill ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>))}</div>
      ) : null}
      <div className="av-grid">
        {myPaint && (filter === 'all' || filter === myPaint.k) ? tile(myPaint, 'Your custom avatar', 'mine') : null}
        {portraitsFor(filter).map((p: string) => tile(modernPreset(p), 'Choose this avatar', p))}
      </div>
      <div className="av-actions">
        <button className="btn btn-soft btn-block" onClick={() => save(current)}>Use this avatar</button>
        <button className="av-cta" onClick={() => openAvatarEditor(current)}><Icon name="sparkles" cls="sm" />Customize Avatar</button>
      </div>
    </section>
  );
}

// ---- Customize Avatar --------------------------------------------------------------------------
const TABS = [['style', 'Style', 'user'], ['hair', 'Hair', 'sparkles'], ['face', 'Face', 'smile'], ['acc', 'Accessories', 'eye'], ['bg', 'Background', 'image']] as const;

export function openAvatarEditor(start?: any) { page((close) => <Editor start={start} close={close} />, 'Customize Avatar'); }
function Editor({ start, close }: { start?: any; close: () => void }) {
  const kind = kindOf();
  const [cfg, setCfg] = useState<any>(() => {
    let c = paintStart(start || cachedAvatar(state.profile.handle));
    if (kind !== 'x' && c.k !== kind) c = paintDefault(kind, c.b);
    return c;
  });
  const [tab, setTab] = useState<string>('style');
  const set = (next: any) => setCfg(normalize(next));
  const row = (title: string, key: string, list: string[][]) => (
    <section className="av-sec" key={title}><h3>{title}</h3>
      <div className="av-row">{list.map(([v, label]) => {
        const next = normalize({ ...cfg, [key]: v });
        return <button key={v} className={`av-opt ${cfg[key] === v ? 'on' : ''}`} aria-label={label} aria-pressed={cfg[key] === v} onClick={() => set(next)}><Face cfg={next} /><span>{label}</span></button>;
      })}</div></section>
  );
  const swatches = (title: string, key: string, list: string[][], bg: (c: string[]) => string) => (
    <section className="av-sec" key={title}><h3>{title}</h3>
      <div className="av-swatches">{list.map((item) => (
        <button key={item[0]} className={`av-swatch ${cfg[key] === item[0] ? 'on' : ''}`} aria-label={item[1] || item[0]} aria-pressed={cfg[key] === item[0]}
          style={{ background: bg(item) }} onClick={() => set({ ...cfg, [key]: item[0] })} />))}</div></section>
  );
  const parts: Record<string, ReactNode[]> = {
    style: [row('Outfit', 'o', OUTFITS),
      kind === 'x' ? (
        <section className="av-sec" key="type"><h3>Avatar type</h3>
          <div className="cr-pills">{[['m', 'Masculine'], ['f', 'Feminine']].map(([v, label]) => (
            <button key={v} className={`cr-pill ${cfg.k === v ? 'on' : ''}`} onClick={() => set({ ...paintDefault(v, cfg.b), s: cfg.s, g: cfg.g, o: cfg.o })}>{label}</button>))}</div></section>
      ) : null],
    hair: [row('Hairstyle', 'h', (HAIR as any)[cfg.k])],
    face: [swatches('Skin tone', 's', SKINS, (c) => c[2]), cfg.k === 'm' ? row('Facial hair', 'fh', BEARD) : null],
    acc: [row('Eyewear', 'g', EYEWEAR)],
    bg: [swatches('Background', 'b', BACKGROUNDS, (c) => `linear-gradient(135deg, ${c[1]}, ${c[2]})`)],
  };
  return (
    <section className="av-page av-edit" role="dialog" aria-modal="true" aria-label="Customize Avatar">
      <div className="av-top">
        <button className="plain-btn" aria-label="Back" onClick={close}><Icon name="back" /></button>
        <h1>Customize Avatar</h1>
        <button className="av-save" onClick={() => save(cfg)}>Save</button>
      </div>
      <div className="av-preview big"><Face cfg={cfg} xl /><span className="av-pencil"><Icon name="edit" cls="sm" /></span></div>
      <div className="av-tabs" role="tablist">{TABS.map(([id, label, ico]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon name={ico} /><span>{label}</span></button>))}</div>
      <div className="av-body">{parts[tab]}</div>
    </section>
  );
}
