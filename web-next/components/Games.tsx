'use client';
// Games on treehouse. Every game is made by Kickrs (kickrs.app) and runs in a frame, signed in as the
// member's treehouse self. Screens: the Games tab (hub), one game (the Kickrs frame), the one-time
// Allow step, and the page kickrs.app sends people to for "Continue with treehouse".
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { state, useAppState, loadDating, statusOf, type Convo } from '@/lib/state';
import { go, openChat } from '@/lib/nav';
import { challengeText, clearConnect, connectKickrs, gameUrl, isInviteCode, joinUrl, kickrsGames, kickrsTicket, pendingConnect, type KickrsGame } from '@/lib/kickrs';
import { Avatar, EmptyState, Hero, Icon, SkeletonList } from './ui';
import { FeatureCard } from './FeatureCard';
import { BellButton } from './Home';
import { confirmSheet, openSheet, toast } from './overlay';

const ART: Record<string, string> = { penalties: '⚽', hoops: '🏀', ludo: '🎲', chess: '♟️', treedoku: '🦅', crosswords: '🔠', trivia: '🧠' };

const WhiteKnight = () => (
  <svg viewBox="0 0 45 45" width="36" height="36" aria-hidden="true">
    <g fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="10.5" y="34" width="24" height="5" rx="1.6" />
      <path d="M14 34c0-5 2.5-8 4.5-10.5 1.2-1.5 1-3-.5-3.6l-3.3 2.3c-1.6 1.1-3.8.5-4.4-1.3-.4-1.2 0-2.4.8-3.4L17 10.5 17.5 6l2.8 3c6 .5 11.5 5.5 11.5 14 0 4-.5 7.5-.3 11z" />
    </g>
    <circle cx="17.5" cy="13.5" r="1.3" fill="#090d2b" />
  </svg>
);

const DraughtsBoard = () => (
  <svg viewBox="0 0 44 44" width="38" height="38" aria-hidden="true">
    <rect width="44" height="44" rx="5" fill="#3A2416" />
    <rect x="3" y="3" width="38" height="38" fill="#EBCB98" />
    {Array.from({ length: 32 }, (_, i) => {
      const r = Math.floor(i / 4);
      const x = 3 + (2 * (i % 4) + (r % 2)) * 4.75;
      const y = 3 + r * 4.75;
      const black = r < 3;
      return (
        <g key={i}>
          <rect x={x} y={y} width="4.75" height="4.75" fill="#4A2D1C" />
          {(r < 3 || r > 4) && (
            <>
              <circle cx={x + 2.375} cy={y + 2.375} r="1.85" fill={black ? '#2E2E30' : '#F4F4F2'} stroke={black ? '#151516' : '#BDBDB8'} strokeWidth=".35" />
              <circle cx={x + 2.375} cy={y + 2.375} r="1.05" fill="none" stroke={black ? '#5A5A5E' : '#D2D2CC'} strokeWidth=".3" />
            </>
          )}
        </g>
      );
    })}
  </svg>
);
const FILTERS = [['all', 'All Games'], ['multi', 'Multiplayer'], ['quick', 'Quick Play']] as const;
const playing = (n: number | null) => (!n ? '' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K playing` : `${n} playing`);
const BLOCKED: Record<string, string> = {
  profile: 'Create your treehouse profile first, then come back to play.',
  suspended: 'Your profile is suspended, so games are switched off for now.',
};

let gamesCache: KickrsGame[] | null = null;
const byPlayers = (games: KickrsGame[]) => games.map((g, i) => ({ g, i })).sort((a, b) => Number(b.g.status === 'live') - Number(a.g.status === 'live') || (b.g.playing ?? 0) - (a.g.playing ?? 0) || a.i - b.i).map(({ g }) => g);
function useGames() {
  const [games, setGames] = useState<KickrsGame[] | null>(gamesCache);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => kickrsGames().then((g) => { gamesCache = byPlayers(g); if (live) setGames(gamesCache); }).catch((e) => { if (live && !gamesCache) setError(e.message); });
    void load();
    const t = window.setInterval(load, 30000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return { games, error };
}

// ---- Home card ------------------------------------------------------------------------------------
export function GamesCard() {
  return <FeatureCard kind="games" iconName="gamepad" title="Games" text="Play, compete and meet new people." actionText="Play games" onClick={() => go('games')} />;
}

// ---- Games tab ------------------------------------------------------------------------------------
export function GamesHub() {
  const { games, error } = useGames();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const featured = games?.find((g) => g.status === 'live') || null;
  const shown = (games || []).filter((g) => filter === 'all' || (filter === 'quick' ? g.status === 'live' : g.players !== '1v1'));
  return (
    <div className="stack-lg games">
      <Hero title="Games" sub="Friendly matches with treehouse members. Win, then add them as friends." actions={<BellButton />} />
      <button className="gm-banner" disabled={!featured} onClick={() => featured && go(`games/${featured.id}`)}>
        <span className="gm-banner-text">
          <b>Play Games.<br />Meet People.</b>
          <span>Fun games, friendly competition and new connections on treehouse.</span>
        </span>
        <span className="gm-banner-art" aria-hidden="true"><Icon name="gamepad" /></span>
      </button>
      <button className="th-games-card" onClick={() => go('games/treasure-hunt')}>
        <span className="th-games-art" aria-hidden="true">🧰</span>
        <span className="th-games-copy"><b>Treasure Hunt</b><small>Explore real places. Follow clues. Collect coins.</small></span>
        <span className="th-games-cta">Explore <Icon name="chev" cls="sm" /></span>
      </button>
      <div className="chips gm-filters" role="group" aria-label="Show">
        {FILTERS.map(([k, label]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      <section>
        <div className="section-head"><h2>Popular on treehouse</h2></div>
        {error ? <EmptyState emoji="🎮" title="Games are taking a break" text={error} />
          : !games ? <SkeletonList n={2} />
          : shown.length ? (
            <div className="gm-grid">
              {shown.map((g) => (
                <button key={g.id} className={`gm-tile ${g.status}`} disabled={g.status !== 'live'} onClick={() => go(`games/${g.id}`)} aria-label={g.status === 'live' ? `Play ${g.name}` : `${g.name}, coming soon`}>
                  <span className="gm-art" aria-hidden="true">{g.id === 'chess' ? <WhiteKnight /> : g.id === 'draughts' ? <DraughtsBoard /> : ART[g.id] || '🎮'}</span>
                  <b>{g.name.replace(/^Kickrs /, '')}</b>
                  <span className="gm-meta">{g.status === 'live' ? <><i className="gm-live" />{playing(g.playing) || g.players}</> : 'Coming soon'}</span>
                </button>
              ))}
            </div>
          ) : <p className="muted small">No games here yet.</p>}
      </section>
    </div>
  );
}

// ---- Allow (once) ---------------------------------------------------------------------------------
function Allow({ onAllow, onCancel, busy, error }: { onAllow: () => void; onCancel: () => void; busy: boolean; error: string }) {
  const handle = state.profile?.handle || '';
  return (
    <div className="card gm-allow">
      <div className="gm-allow-who"><Avatar seed={handle} cls="lg" /><div><p className="small muted">Play Kickrs games as</p><b>{handle}</b></div></div>
      <ul className="gm-allow-list">
        <li><Icon name="check" cls="sm" />Kickrs sees your nickname, your avatar and that you’re 18+.</li>
        <li><Icon name="check" cls="sm" />People you play can send you a treehouse friend request.</li>
        <li><Icon name="lock" cls="sm" />Your name, email, photos and chats stay on treehouse.</li>
      </ul>
      <p className="error" role="alert">{error}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={onAllow}>{busy ? 'Connecting…' : 'Allow'}</button>
        <button className="btn btn-soft btn-block" disabled={busy} onClick={onCancel}>Not now</button>
      </div>
      <p className="tiny muted">You can disconnect Kickrs at any time from the ⋯ menu in a game.</p>
    </div>
  );
}

// ---- One game -------------------------------------------------------------------------------------
type Phase = { k: 'loading' } | { k: 'missing' } | { k: 'blocked'; why: string } | { k: 'allow' } | { k: 'play'; game: KickrsGame };
// join: a challenge code from a chat message. challenge: the chat to send a new challenge to.
// back: the chat to return to with the back button.
type Opening = { join?: string; challenge?: string; back?: string };
const chatId = (v?: string) => (v && /^[\w-]{1,64}$/.test(v) ? v : undefined);

export function GameScreen({ id, join, challenge, back }: { id: string } & Opening) {
  const [opening] = useState<Opening>(() => ({ join: isInviteCode(join) ? join : undefined, challenge: isInviteCode(join) ? undefined : chatId(challenge), back: chatId(back) }));
  useAppState();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const game = useRef<KickrsGame | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([kickrsGames(), api.kickrsStatus()]).then(([games, st]) => {
      if (!live) return;
      const g = games.find((x) => x.id === id && x.status === 'live');
      if (!g) return setPhase({ k: 'missing' });
      game.current = g;
      if (st.blocker) return setPhase({ k: 'blocked', why: BLOCKED[st.blocker] || 'Games aren’t available for this account.' });
      setPhase(st.connected ? { k: 'play', game: g } : { k: 'allow' });
    }).catch((e) => { if (live) setPhase({ k: 'blocked', why: api.friendly(e) }); });
    return () => { live = false; };
  }, [id]);

  if (phase.k === 'play') return <Stage game={phase.game} {...opening} />;
  return (
    <div className="stack-lg games">
      <Hero title={game.current?.name || 'Games'} actions={<BellButton />} />
      {phase.k === 'loading' ? <SkeletonList n={1} /> : null}
      {phase.k === 'missing' ? <EmptyState emoji="🎮" title="That game isn’t open yet" text="It’s coming soon. Try one of the games that are live now."><button className="btn btn-primary" onClick={() => go('games')}>See all games</button></EmptyState> : null}
      {phase.k === 'blocked' ? <EmptyState emoji="🔒" title="Games aren’t available" text={phase.why} /> : null}
      {phase.k === 'allow' ? (
        <Allow busy={busy} error={error} onCancel={() => (opening.back ? openChat(opening.back) : go('games'))} onAllow={async () => {
          setBusy(true); setError('');
          try { await api.kickrsConnect(); if (game.current) setPhase({ k: 'play', game: game.current }); }
          catch (e) { setError(api.friendly(e)); }
          setBusy(false);
        }} />
      ) : null}
    </div>
  );
}

function Stage({ game, join, challenge, back }: { game: KickrsGame } & Opening) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef(false);
  const base = gameUrl(game);
  const src = join ? joinUrl(game, join) : challenge && base ? `${base}&challenge=1` : base;
  const playingNow = useRef(false);
  const okToLeave = async () => !playingNow.current || await confirmSheet({ title: 'Leave the match?', text: 'The match is still going. If you leave now, you lose it.', yes: 'Leave match', danger: true });
  const leave = async () => {
    if (!(await okToLeave())) return;
    playingNow.current = false;
    if (back) openChat(back); else go('games');
  };
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!playingNow.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as Element | null)?.closest?.('.bottom-nav a[href], .sidebar a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const to = new URL(link.href).pathname.replace(/^\/home\/?/, '');
      void okToLeave().then((yes) => { if (yes) { playingNow.current = false; go(to || 'home'); } });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  useEffect(() => {
    if (!frame.current) return;
    return connectKickrs(frame.current, {
      addFriend: async (kickrsId) => {
        const known = new Set(state.convos.map((c: Convo) => c.conversation_id));
        const id = await api.kickrsFriendRequest(kickrsId);
        const had: Convo | undefined = state.convos.find((c: Convo) => c.conversation_id === id);
        loadDating({ force: true });
        if (id && known.has(id) && had) {
          if (statusOf(had) !== 'chat') return 'There’s already a request between you. It’s in your treehouse Inbox.';
          return had.kind === 'friend' ? 'You’re already friends on treehouse.' : 'You already have a chat with them on treehouse.';
        }
        toast('Friend request sent. It’s in your Inbox.', 'check');
        return 'Friend request sent. It’s in your treehouse Inbox.';
      },
      friendStatus: (handle) => {
        const c: Convo | undefined = state.convos.find((x: Convo) => x.other_handle === handle);
        if (!c) return 'none';
        if (c.blocked || c.kind !== 'friend') return 'chat';
        return statusOf(c) === 'chat' ? 'friends' : 'pending';
      },
      onEvent: (e) => {
        if (e.type === 'kickrs:match-start') playingNow.current = true;
        if (e.type === 'kickrs:match-end' || e.type === 'kickrs:match-left') playingNow.current = false;
        if (e.type !== 'kickrs:invite' || !challenge || sent.current || !isInviteCode(e.code)) return;
        sent.current = true;
        api.sendMessage(challenge, challengeText(game.id, e.code))
          .then(() => { loadDating({ force: true }); toast('Challenge sent. Stay here until they join.', 'check'); })
          .catch((err: unknown) => { sent.current = false; toast(api.friendly(err), 'x'); });
      },
    });
  }, [challenge, game.id]);
  const menu = () => openSheet((close) => (
    <>
      <h2>{game.name}</h2>
      <p className="muted small">Games are made by Kickrs. Disconnecting signs you out of Kickrs here and stops people you played from sending you friend requests from a game.</p>
      <div className="sheet-actions">
        <button className="btn btn-soft btn-block danger-text" onClick={async () => {
          close();
          try { await api.kickrsDisconnect(); toast('Kickrs disconnected', 'check'); go('games'); } catch (e) { toast(api.friendly(e), 'x'); }
        }}>Disconnect Kickrs</button>
        <button className="btn btn-soft btn-block" onClick={close}>Close</button>
      </div>
    </>
  ), { label: 'Game options' });
  return (
    <div className="game-stage">
      <header className="gs-head">
        <button className="hero-btn" aria-label={back ? 'Back to the chat' : 'Back to games'} onClick={leave}><Icon name="back" /></button>
        <b className="ellipsis">{game.name}</b>
        <button className="hero-btn" aria-label="Game options" onClick={menu}><Icon name="more" /></button>
      </header>
      {src ? <iframe ref={frame} className="gs-frame" src={src} title={game.name} allow="autoplay; vibrate; clipboard-write; web-share" /> : null}
    </div>
  );
}

// ---- kickrs.app → "Continue with treehouse" -------------------------------------------------------
export function ConnectKickrs() {
  useAppState();
  const [phase, setPhase] = useState<'loading' | 'bad' | 'blocked' | 'allow' | 'sending'>('loading');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const sendRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const p = pendingConnect();
    if (!p) { setPhase('bad'); return; }
    let live = true;
    const send = async () => {
      setPhase('sending');
      const ticket = await kickrsTicket(p.nonce);
      clearConnect();
      location.replace(`${p.back}#ticket=${encodeURIComponent(ticket)}`);
    };
    api.kickrsStatus().then(async (st) => {
      if (!live) return;
      if (st.blocker) { setWhy(BLOCKED[st.blocker] || ''); setPhase('blocked'); return; }
      if (st.connected) await send(); else setPhase('allow');
    }).catch((e) => { if (live) { setWhy(api.friendly(e)); setPhase('blocked'); } });
    sendRef.current = send;
    return () => { live = false; };
  }, []);

  const back = () => {
    const p = pendingConnect();
    clearConnect();
    if (p) location.replace(`${p.back}#error=denied`); else go('games');
  };

  return (
    <div className="stack-lg games">
      <Hero title="Kickrs" sub="Sign in to Kickrs with your treehouse account." />
      {phase === 'loading' || phase === 'sending' ? <div className="card gm-wait"><span className="spinner" aria-hidden="true" />{phase === 'sending' ? 'Taking you back to Kickrs…' : 'Checking your account…'}</div> : null}
      {phase === 'bad' ? <EmptyState emoji="🔗" title="This link has expired" text="Go back to Kickrs and tap Continue with treehouse again."><button className="btn btn-primary" onClick={() => go('games')}>Play games on treehouse</button></EmptyState> : null}
      {phase === 'blocked' ? <EmptyState emoji="🔒" title="Kickrs isn’t available" text={why} /> : null}
      {phase === 'allow' ? (
        <Allow busy={busy} error={why} onCancel={back} onAllow={async () => {
          setBusy(true); setWhy('');
          try {
            await api.kickrsConnect();
            await sendRef.current();
          } catch (e) { setWhy(api.friendly(e)); setBusy(false); }
        }} />
      ) : null}
    </div>
  );
}
