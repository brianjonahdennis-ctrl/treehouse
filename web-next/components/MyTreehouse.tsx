'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// My Treehouse (Hydra, 15 Nov 2026): your invite link, how many people joined through you, and your
// network as a tree. /home/treehouse = the dashboard, /home/treehouse/tree = Your Tree (Tree / List).
// Everything comes from the database (my_treehouse, treehouse_nodes, treehouse_search): who invited
// whom is recorded and checked there. Members see nicknames, join dates and counts only.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { inviteUrl } from '@/lib/referral';
import { copyText } from '@/lib/util';
import { useAppState } from '@/lib/state';
import { Icon, Hero, Avatar, SkeletonList } from './ui';
import { openSheet, toast } from './overlay';
import { BellButton } from './Home';
import { chooseUsername } from './Username';

type TH = { code: string | null; needs_username: boolean; enabled: boolean; active: boolean; direct: number; network: number; total: number;
  levels: { level: number; people: number }[]; deepest: number; window_days: number; rewards: { enabled: boolean } };
type Node = { key: string; level: number; joined_at: string; hidden: boolean; handle: string | null; parent_handle?: string | null; direct: number; total: number; has_children: boolean };
type Page = { count: number; items: Node[] };

const INVITE_TEXT = 'Join me on Treehouse! Meet new people, connect and explore a different social experience. Use my link to sign up:';
const n0 = (n: number) => Number(n || 0).toLocaleString('en-NG');
const joined = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const short = (h: string) => h.replace(/\s+\d+$/, '');

let thCache: { at: number; d: TH | null } | null = null;
async function loadTH(force = false): Promise<TH | null> {
  if (!force && thCache && Date.now() - thCache.at < 30e3) return thCache.d;
  try { const d = await api.myTreehouse(); thCache = { at: Date.now(), d }; return d; } catch { return thCache ? thCache.d : null; }
}

/** The member's own invite link (choosing a username first if they don't have one). */
async function ensureCode(th: TH | null): Promise<string | null> {
  if (th && th.code) return th.code;
  if (th && th.needs_username) {
    if (!(await chooseUsername({ why: 'Your invite link uses your username, so choose one first.' }))) return null;
    const fresh = await loadTH(true);
    return fresh && fresh.code ? fresh.code : null;
  }
  return null;
}
async function shareInvite(code: string) {
  const url = inviteUrl(code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Treehouse', text: INVITE_TEXT, url }); return; } catch (e) { if (e && (e as Error).name === 'AbortError') return; }
  }
  if (await copyText(`${INVITE_TEXT} ${url}`)) toast('Invite message copied. Paste it anywhere to share.', 'copy');
  else toast(url, 'link');
}

export default function MyTreehouse({ sub }: { sub: string | null }) {
  return sub === 'tree' ? <TreeScreen /> : <Dashboard />;
}

// ---- Dashboard ----------------------------------------------------------------------------------
function Dashboard() {
  const s = useAppState();
  const [th, setTh] = useState<TH | null | undefined>(thCache ? thCache.d : undefined);
  useEffect(() => { loadTH(true).then(setTh); }, []);
  const withCode = async (fn: (code: string) => void) => { const c = await ensureCode(th || null); if (c) { fn(c); loadTH(true).then(setTh); } };
  const copy = () => withCode(async (c) => { if (await copyText(inviteUrl(c))) toast('Referral link copied!', 'copy'); else toast(inviteUrl(c), 'link'); });
  const off = th && (!th.enabled || !th.active);
  return (
    <div className="stack-lg mt">
      <Hero cls="mt-hero" me={false} top={
        <div className="ih-subtop">
          <button className="hero-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? window.history.back() : go(''))}><Icon name="back" /></button>
          <span className="mt-brand"><img src="/treehouse-mark.svg" alt="" width={26} height={26} />treehouse</span>
        </div>} actions={<><BellButton />{s.profile ? <button className="hero-me" aria-label="Your profile" onClick={() => go('profile')}><Avatar seed={s.profile.handle} cls="sm" /></button> : null}</>}>
        <h1 className="mt-title">My Treehouse</h1>
        <p className="ih-subline mt-sub">Invite people to Treehouse and grow your network. See everyone who joined through you.</p>
        <span className="mt-hero-art" aria-hidden="true">🌳</span>
      </Hero>

      <div className="below-hero stack-lg">
        {th === undefined ? <SkeletonList n={3} /> : th === null ? (
          <div className="card"><p className="muted">My Treehouse couldn’t load. Check your connection and try again.</p>
            <button className="btn btn-soft btn-sm" onClick={() => loadTH(true).then(setTh)}>Try again</button></div>
        ) : (
          <>
            <section className="mt-link card" aria-label="Your referral link">
              <div className="mt-link-top">
                <span className="mt-link-ico"><Icon name="link" /></span>
                <div className="grow">
                  <h2>Your Referral Link</h2>
                  {off ? <p className="tiny muted">Invites are paused right now. Your tree is still here.</p>
                    : th.code ? (
                      <button className="mt-url" onClick={copy} aria-label="Copy your referral link">
                        <span className="ellipsis">{inviteUrl(th.code).replace('https://', '')}</span><Icon name="copy" cls="sm" />
                      </button>
                    ) : <p className="tiny muted">Choose a username to get your link: treehouse.ng/r/yourname</p>}
                </div>
              </div>
              {off ? null : (
                <div className="mt-link-actions">
                  <button className="btn btn-coral" onClick={() => withCode(shareInvite)}><Icon name="share" cls="sm" />Invite People</button>
                  <button className="btn btn-ghost mt-qr-btn" onClick={() => withCode((c) => openQr(c))}><Icon name="qr" cls="sm" />Share QR</button>
                </div>
              )}
            </section>

            <div className="mt-stats">
              <Stat cls="total" icon="users" n={th.total} label="Total Referrals" />
              <Stat cls="direct" icon="layers" n={th.direct} label="Direct Referrals" sub="(Level 1)" />
              <Stat cls="network" icon="network" n={th.network} label="Network Referrals" sub="(Level 2+)" />
            </div>

            {th.total === 0 ? (
              <section className="mt-empty card">
                <span className="mt-empty-art" aria-hidden="true">🌱</span>
                <h2>Your Treehouse Starts Here!</h2>
                <p className="muted">Invite your first friend and watch your network grow.</p>
                {off ? null : <button className="btn btn-coral" onClick={() => withCode(shareInvite)}><Icon name="share" cls="sm" />Invite People</button>}
              </section>
            ) : null}

            <button className="mt-nav card" onClick={() => go('treehouse/tree')}>
              <span className="mt-nav-ico"><Icon name="network" /></span>
              <span className="grow"><b>Your Network Tree</b><span>A visual map of everyone you’ve referred and their network.</span></span>
              <Icon name="chev" />
            </button>

            <section className="mt-nav card mt-rewards" aria-label="Referral Rewards">
              <span className="mt-nav-ico"><Icon name="gift" /></span>
              <span className="grow"><b>Referral Rewards</b><span>Referral rewards are coming soon. Keep growing your Treehouse network.</span></span>
            </section>

            <section className="mt-how card" aria-label="How My Treehouse works">
              <div className="mt-how-head"><Icon name="info" /><h2>How My Treehouse Works</h2></div>
              <ol>
                <li>Share your referral link.</li>
                <li>Someone joins Treehouse using your link.</li>
                <li>They become part of your direct referral network.</li>
                <li>When they invite others, their referrals become part of your wider network.</li>
                <li>Watch your Treehouse grow.</li>
              </ol>
              <p className="tiny muted">{`A referral counts when the person creates their Treehouse profile within ${th.window_days} day${th.window_days === 1 ? '' : 's'} of signing up with your link. Link clicks don’t count, nobody is counted twice, and suspended accounts don’t count. Being in someone’s tree doesn’t make you friends or open a chat.`}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ cls, icon, n, label, sub }: { cls: string; icon: string; n: number; label: string; sub?: string }) {
  return (
    <div className={`mt-stat ${cls}`}>
      <Icon name={icon} />
      <b>{n0(n)}</b>
      <span>{label}{sub ? <><br />{sub}</> : null}</span>
    </div>
  );
}

// ---- QR code --------------------------------------------------------------------------------------
function qrSvg(text: string) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return { svg: q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }), q };
}
async function qrPng(text: string): Promise<Blob | null> {
  const { q } = qrSvg(text);
  const cells = q.getModuleCount(), cell = 10, margin = 4, size = (cells + margin * 2) * cell;
  const c = document.createElement('canvas');
  c.width = size; c.height = size + 70;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#090d2b';
  for (let r = 0; r < cells; r++) for (let col = 0; col < cells; col++) if (q.isDark(r, col)) x.fillRect((col + margin) * cell, (r + margin) * cell, cell, cell);
  x.font = 'bold 26px system-ui, sans-serif'; x.textAlign = 'center';
  x.fillText('Join me on treehouse', size / 2, size + 30);
  x.font = '20px system-ui, sans-serif'; x.fillStyle = '#6c7299';
  x.fillText(text.replace('https://', '').replace(/\?.*$/, ''), size / 2, size + 58);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
function openQr(code: string) {
  const url = `${inviteUrl(code)}?via=qr`;
  const { svg } = qrSvg(url);
  const save = async () => {
    const b = await qrPng(url);
    if (!b) return toast('Couldn’t make the picture on this phone', 'x');
    const file = new File([b], `treehouse-invite-${code}.png`, { type: 'image/png' });
    const nav: any = navigator;
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: 'Treehouse', text: `${INVITE_TEXT} ${inviteUrl(code)}` }); return; } catch (e) { if (e && (e as Error).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('QR code saved', 'check');
  };
  openSheet((close) => (
    <>
      <h2>Your invite QR code</h2>
      <p className="small muted">Anyone who scans it opens Treehouse with your invite. It stays the same unless you change your username.</p>
      {/* Our own generated markup (a QR code of our own link), never user text. */}
      <div className="mt-qr" role="img" aria-label="QR code for your referral link" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="tiny muted center">{inviteUrl(code).replace('https://', '')}</p>
      <div className="sheet-actions">
        <button className="btn btn-coral btn-block" onClick={save}><Icon name="share" cls="sm" />Share or save QR</button>
        <button className="btn btn-soft btn-block" onClick={close}>Done</button>
      </div>
    </>
  ), { label: 'Invite QR code' });
}

// ---- Your Tree ------------------------------------------------------------------------------------
// Pages already loaded stay here while you move between Tree and List view (and come back later).
const pages = new Map<string, Page>();          // `${parentKey}|${sort}` -> loaded children
let treePath: string[] = [];                    // Tree view: the open branch (keys from level 1 down)
let listOpen = new Set<string>();               // List view: expanded rows
let viewMode: 'tree' | 'list' = 'tree';
const pk = (parent: string | null, sort: string) => `${parent || 'me'}|${sort}`;

async function loadKids(parent: string | null, sort = 'joined', more = false): Promise<Page> {
  const k = pk(parent, sort);
  const had = pages.get(k);
  if (had && !more) return had;
  const off = more && had ? had.items.length : 0;
  const r: Page = await api.treehouseNodes(parent, sort, off, 30);
  const merged = { count: r.count, items: more && had ? [...had.items, ...r.items] : r.items };
  pages.set(k, merged);
  return merged;
}

function TreeScreen() {
  const s = useAppState();
  const [th, setTh] = useState<TH | null | undefined>(thCache ? thCache.d : undefined);
  const [mode, setMode] = useState<'tree' | 'list'>(viewMode);
  useEffect(() => { loadTH(true).then((d) => { if (thCache && d && thCache.d && d.total !== (thCache.d as TH).total) pages.clear(); setTh(d); }); }, []);
  const pick = (m: 'tree' | 'list') => { viewMode = m; setMode(m); };
  return (
    <div className="stack-lg mt mt-tree-page">
      <Hero cls="mt-hero mt-hero-sm" me={false} top={
        <div className="ih-subtop">
          <button className="hero-btn" aria-label="Back to My Treehouse" onClick={() => go('treehouse')}><Icon name="back" /></button>
          <h1>Your Tree</h1>
        </div>}>
        <div className="mt-seg" role="tablist" aria-label="How to show your tree">
          <button role="tab" aria-selected={mode === 'tree'} className={mode === 'tree' ? 'on' : ''} onClick={() => pick('tree')}><Icon name="network" cls="sm" />Tree View</button>
          <button role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => pick('list')}><Icon name="list" cls="sm" />List View</button>
        </div>
      </Hero>
      <div className="below-hero stack-lg">
        {th === undefined ? <SkeletonList n={3} /> : !th ? <div className="card"><p className="muted">Your tree couldn’t load. Try again in a moment.</p></div> : (
          <>
            {mode === 'tree' ? <TreeView th={th} me={s.profile?.handle || 'You'} /> : <ListView th={th} />}
            {th.total ? <Summary th={th} /> : null}
            {th.enabled && th.active ? <button className="btn btn-coral btn-block mt-more" onClick={async () => { const c = await ensureCode(th); if (c) shareInvite(c); }}><Icon name="share" cls="sm" />Invite More People</button> : null}
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ th }: { th: TH }) {
  return (
    <section className="card mt-summary" aria-label="Tree summary">
      <div className="mt-how-head"><Icon name="chart" /><h2>Tree Summary</h2></div>
      {th.levels.map((l) => (
        <div key={l.level} className="mt-sum-row"><i className={`lv lv${Math.min(l.level, 4)}`} aria-hidden="true" />
          <span className="grow">{l.level === 1 ? 'Level 1 – Direct Referrals' : `Level ${l.level} – ${l.level === 2 ? 'Their Referrals' : 'Wider Network'}`}</span><b>{n0(l.people)}</b></div>
      ))}
      <div className="mt-sum-row total"><span className="grow">Total Referrals</span><b>{n0(th.total)}</b></div>
    </section>
  );
}

function nodeSheet(n: Node, onExpand?: () => void) {
  openSheet((close) => (
    <div className="mt-node-sheet">
      {n.hidden ? <span className="avatar lg mt-locked"><Icon name="lock" /></span> : <Avatar seed={n.handle!} label={n.handle!} cls="lg" />}
      <h2>{n.hidden ? 'Member unavailable' : n.handle}</h2>
      {n.hidden ? <p className="tiny muted">This member’s profile isn’t available right now, so they don’t count in your totals. People they invited still do.</p> : null}
      <div className="mt-node-facts">
        <span><b>{`Level ${n.level}`}</b>{n.level === 1 ? 'Direct referral' : 'Network referral'}</span>
        <span><b>{joined(n.joined_at)}</b>Joined</span>
        <span><b>{n0(n.direct)}</b>Direct referrals</span>
        <span><b>{n0(n.total)}</b>Total network</span>
      </div>
      <p className="tiny muted">Being in your tree doesn’t make you friends or open a chat.</p>
      <div className="sheet-actions">
        {onExpand && n.has_children ? <button className="btn btn-primary btn-block" onClick={() => { close(); onExpand(); }}><Icon name="network" cls="sm" />Show their referrals</button> : null}
        <button className="btn btn-soft btn-block" onClick={close}>Close</button>
      </div>
    </div>
  ), { label: 'Referral details' });
}

function NodeBubble({ n, open, onOpen }: { n: Node; open: boolean; onOpen: () => void }) {
  return (
    <div className={`mt-node ${open ? 'open' : ''} ${n.hidden ? 'hidden' : ''}`}>
      <button className="mt-node-av" aria-label={`${n.hidden ? 'Member unavailable' : n.handle}: details`} onClick={() => nodeSheet(n, onOpen)}>
        {n.hidden ? <span className="avatar mt-locked"><Icon name="lock" /></span> : <Avatar seed={n.handle!} label={n.handle!} />}
      </button>
      <span className="mt-node-name ellipsis">{n.hidden ? 'Unavailable' : short(n.handle!)}</span>
      {n.has_children ? (
        <button className="mt-badge" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the ${n.total} people in their network`} onClick={onOpen}>
          <Icon name="users" cls="sm" />{n0(n.total)}<Icon name="chev" cls={`sm mt-chev ${open ? 'up' : ''}`} /></button>
      ) : <span className="mt-badge none"><Icon name="users" cls="sm" />0</span>}
    </div>
  );
}

// One row per level: level 1 is everyone you invited; opening someone shows their row below.
function TreeView({ th, me }: { th: TH; me: string }) {
  const [, setTick] = useState(0);
  const [rows, setRows] = useState<(Page | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: (Page | null)[] = [];
      try {
        out.push(await loadKids(null));
        for (const key of treePath) out.push(await loadKids(key));
      } catch { /* shown as empty */ }
      if (alive) setRows(out);
    })();
    return () => { alive = false; };
  }, [th.total]);
  const openAt = async (depth: number, key: string) => {
    if (busy) return;
    const isOpen = treePath[depth] === key;
    treePath = isOpen ? treePath.slice(0, depth) : [...treePath.slice(0, depth), key];
    if (isOpen) { setRows((r) => r.slice(0, depth + 1)); refresh(); return; }
    setBusy(true);
    try { const pg = await loadKids(key); setRows((r) => [...r.slice(0, depth + 1), pg]); }
    catch (e) { toast(api.friendly(e), 'x'); treePath = treePath.slice(0, depth); }
    finally { setBusy(false); }
  };
  const more = async (depth: number) => {
    const parent = depth === 0 ? null : treePath[depth - 1];
    try { const pg = await loadKids(parent, 'joined', true); setRows((r) => r.map((x, i) => (i === depth ? pg : x))); } catch (e) { toast(api.friendly(e), 'x'); }
  };
  return (
    <section className="mt-treeview" aria-label="Your tree">
      <div className="mt-root">
        <span className="mt-root-av"><Avatar seed={me} label={me} cls="lg" /></span>
        <span className="mt-you">You</span>
        <span className="mt-root-n">{`${n0(th.total)} Referral${th.total === 1 ? '' : 's'}`}</span>
      </div>
      {!th.total ? (
        <div className="mt-tree-empty"><p className="small">No one has joined through your link yet. When they do, they appear here.</p></div>
      ) : rows.length === 0 ? <SkeletonList n={1} /> : rows.map((pg, depth) => {
        if (!pg) return null;
        const level = depth + 1;
        const lvCount = th.levels.find((l) => l.level === level)?.people;
        return (
          <div key={depth} className="mt-level">
            <i className="mt-stem" aria-hidden="true" />
            <div className="mt-level-head">
              <b>{`Level ${level}`}</b>
              <span className="ellipsis">{level === 1 ? 'Direct referrals' : (() => { const up = rows[depth - 1]?.items.find((k) => k.key === treePath[depth - 1]); return up && !up.hidden ? `Invited by ${short(up.handle!)}` : 'Their referrals'; })()}</span>
              <span className="mt-level-n">{level === 1 && lvCount != null ? `${n0(lvCount)} ${lvCount === 1 ? 'person' : 'people'}` : `${n0(pg.count)} ${pg.count === 1 ? 'person' : 'people'}`}</span>
            </div>
            <div className="mt-row" role="list">
              {pg.items.map((n) => <div role="listitem" key={n.key}><NodeBubble n={n} open={treePath[depth] === n.key} onOpen={() => openAt(depth, n.key)} /></div>)}
              {pg.items.length < pg.count ? <button className="mt-row-more" onClick={() => more(depth)}>{`+${n0(pg.count - pg.items.length)}`}<span>Show more</span></button> : null}
            </div>
          </div>
        );
      })}
      {th.total ? <p className="tiny muted center">Tap a picture for details. Tap the number under someone to see the people they invited. Swipe a row to see more.</p> : null}
    </section>
  );
}

// ---- List view ------------------------------------------------------------------------------------
const SORTS: [string, string][] = [['joined', 'Newest'], ['direct', 'Most direct referrals'], ['total', 'Biggest network']];
let listQuery = '', listLevel: number | null = null, listSort = 'joined';

function ListView({ th }: { th: TH }) {
  const [q, setQ] = useState(listQuery);
  const [level, setLevel] = useState<number | null>(listLevel);
  const [sort, setSort] = useState(listSort);
  const [flat, setFlat] = useState<Page | null>(null);
  const [root, setRoot] = useState<Page | null>(pages.get(pk(null, sort)) || null);
  const [, setTick] = useState(0);
  const searching = q.trim() !== '' || level !== null;
  const timer = useRef<any>(null);
  useEffect(() => { listQuery = q; listLevel = level; listSort = sort; }, [q, level, sort]);
  useEffect(() => {
    if (searching) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { api.treehouseSearch(q, level, sort, 0, 40).then(setFlat).catch(() => setFlat({ count: 0, items: [] })); }, 250);
      return () => clearTimeout(timer.current);
    }
    loadKids(null, sort).then(setRoot).catch(() => setRoot({ count: 0, items: [] }));
  }, [q, level, sort, searching, th.total]);
  const levels = th.levels.map((l) => l.level);
  if (!th.total) return <div className="card mt-tree-empty"><p className="small">No one has joined through your link yet.</p></div>;
  return (
    <section className="card mt-list" aria-label="Your tree as a list">
      <div className="mt-list-tools">
        <label className="mt-search"><Icon name="search" cls="sm" /><input value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="Search nicknames" aria-label="Search your tree by nickname" /></label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="mt-chips" role="group" aria-label="Filter by level">
        <button className={level === null ? 'on' : ''} onClick={() => setLevel(null)}>All levels</button>
        {levels.map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{`Level ${l}`}</button>)}
      </div>
      <div className="mt-list-you"><b>YOU</b><span className="tiny muted">{`${n0(th.total)} in your network`}</span></div>
      {searching ? (
        !flat ? <SkeletonList n={2} /> : !flat.items.length ? <p className="small muted mt-none">Nobody matches.</p> : (
          <ul className="mt-rows">
            {flat.items.map((n) => <ListRow key={n.key} n={n} depth={0} sort={sort} flat onChange={() => setTick((t) => t + 1)} />)}
            {flat.items.length < flat.count ? <li><button className="link-btn mt-showmore" onClick={() => api.treehouseSearch(q, level, sort, flat.items.length, 40).then((r: Page) => setFlat({ count: r.count, items: [...flat.items, ...r.items] }))}>{`Show more (${n0(flat.count - flat.items.length)})`}</button></li> : null}
          </ul>
        )
      ) : !root ? <SkeletonList n={2} /> : (
        <ul className="mt-rows">
          {root.items.map((n) => <ListRow key={n.key} n={n} depth={0} sort={sort} onChange={() => setTick((t) => t + 1)} />)}
          {root.items.length < root.count ? <li><button className="link-btn mt-showmore" onClick={() => loadKids(null, sort, true).then(setRoot)}>{`Show more (${n0(root.count - root.items.length)})`}</button></li> : null}
        </ul>
      )}
    </section>
  );
}

function ListRow({ n, depth, sort, flat = false, onChange }: { n: Node; depth: number; sort: string; flat?: boolean; onChange: () => void }) {
  const open = listOpen.has(n.key);
  const [kids, setKids] = useState<Page | null>(open ? pages.get(pk(n.key, sort)) || null : null);
  useEffect(() => { if (open && !kids) loadKids(n.key, sort).then(setKids).catch(() => {}); }, [open, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (open) listOpen.delete(n.key); else listOpen.add(n.key); onChange(); };
  const name = n.hidden ? 'Member unavailable' : n.handle!;
  let line: ReactNode = `Level ${n.level} · ${n0(n.direct)} referral${n.direct === 1 ? '' : 's'}`;
  if (n.total > n.direct) line = <>{line}{` · ${n0(n.total)} in network`}</>;
  return (
    <li className="mt-li" style={{ ['--d' as any]: Math.min(depth, 6) }}>
      <div className="mt-li-row">
        {n.has_children && !flat ? <button className="mt-li-tog" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={toggle}><Icon name="chev" cls={`sm mt-chev ${open ? 'up' : 'side'}`} /></button> : <span className="mt-li-tog" />}
        <button className="mt-li-main" onClick={() => nodeSheet(n)}>
          {n.hidden ? <span className="avatar sm mt-locked"><Icon name="lock" /></span> : <Avatar seed={n.handle!} label={n.handle!} cls="sm" />}
          <span className="grow"><b className="ellipsis">{name}</b><span className="tiny muted">{line}{flat && n.parent_handle ? ` · invited by ${short(n.parent_handle)}` : ''}</span></span>
          <span className="tiny muted">{joined(n.joined_at)}</span>
        </button>
      </div>
      {open && !flat ? (
        !kids ? <div className="mt-li-loading tiny muted">Loading…</div> : (
          <ul className="mt-rows">
            {kids.items.map((k) => <ListRow key={k.key} n={k} depth={depth + 1} sort={sort} onChange={onChange} />)}
            {kids.items.length < kids.count ? <li><button className="link-btn mt-showmore" onClick={() => loadKids(n.key, sort, true).then(setKids)}>{`Show more (${n0(kids.count - kids.items.length)})`}</button></li> : null}
          </ul>
        )
      ) : null}
    </li>
  );
}

// ---- Entry card (Home) -----------------------------------------------------------------------------
export function TreehouseCard() {
  const [th, setTh] = useState<TH | null>(thCache ? thCache.d : null);
  useEffect(() => { loadTH().then(setTh); }, []);
  return (
    <button className="hm-games mt-card" onClick={() => go('treehouse')}>
      <span className="hg-text">
        <span className="hg-kicker"><Icon name="network" cls="sm" />My Treehouse</span>
        <b>{th && th.total ? `${n0(th.total)} ${th.total === 1 ? 'person' : 'people'} in your network` : 'Your network. Your growth.'}</b>
        <span className="hg-go">View My Treehouse<Icon name="chev" cls="sm" /></span>
      </span>
      <span className="hg-art" aria-hidden="true"><span>🌳</span><span>🌱</span></span>
    </button>
  );
}
