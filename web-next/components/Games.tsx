'use client';
// Games on treehouse. Every game is made by Kickrs (kickrs.app) and runs in a frame, signed in as the
// member's treehouse self. Screens: the Games tab (hub), one game (the Kickrs frame), the one-time
// Allow step, and the page kickrs.app sends people to for "Continue with treehouse".
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { state, useAppState, loadDating, statusOf, type Convo } from '@/lib/state';
import { go, openChat } from '@/lib/nav';
import { challengeText, clearConnect, connectKickrs, gameUrl, isInviteCode, kickrsGames, kickrsTicket, KICKRS_ORIGIN, pendingConnect, type KickrsGame } from '@/lib/kickrs';
import { Avatar, EmptyState, Hero, Icon, SkeletonList } from './ui';
import { BellButton } from './Home';
import { confirmSheet, openSheet, toast } from './overlay';

const ART: Record<string, string> = { penalties: '⚽', ludo: '🎲', chess: '♟️', dice: '🎯', crosswords: '🔠', trivia: '❓' };
const FILTERS = [['all', 'All Games'], ['multi', 'Multiplayer'], ['quick', 'Quick Play']] as const;
const playing = (n: number | null) => (!n ? '' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K playing` : `${n} playing`);
const BLOCKED: Record<string, string> = {
  profile: 'Create your treehouse profile first, then come back to play.',
  suspended: 'Your profile is suspended, so games are switched off for now.',
};

let gamesCache: KickrsGame[] | null = null;
function useGames() {
  const [games, setGames] = useState<KickrsGame[] | null>(gamesCache);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    kickrsGames().then((g) => { gamesCache = g; if (live) setGames(g); }).catch((e) => { if (live && !gamesCache) setError(e.message); });
    return () => { live = false; };
  }, []);
  return { games, error };
}

// ---- Home card ------------------------------------------------------------------------------------
export function GamesCard() {
  return (
    <button className="hm-games" onClick={() => go('games')}>
      <span className="hg-text">
        <span className="hg-kicker"><Icon name="gamepad" cls="sm" />Games on treehouse</span>
        <b>Play, compete, and meet new people.</b>
        <span className="hg-go">Play Games<Icon name="chev" cls="sm" /></span>
      </span>
      <span className="hg-art" aria-hidden="true"><span>⚽</span><span>🎲</span></span>
    </button>
  );
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
                  <span className="gm-art" aria-hidden="true">{ART[g.id] || '🎮'}</span>
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
  const src = join ? `${KICKRS_ORIGIN}/f/${join}?embed=treehouse` : challenge && base ? `${base}&challenge=1` : base;
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
