'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// /home/invite: this week's top 50 inviters. Every Monday at noon (Lagos) the #1 of the week before is
// announced to everyone as Man / Woman / Star of the Week (dating_private.invite_winner_announce).
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { inviteUrl } from '@/lib/referral';
import { shareOrCopy } from '@/lib/util';
import { Icon, Hero, Avatar, EmptyState, SkeletonList } from './ui';
import { toast } from './overlay';
import { BellButton } from './Home';

type Row = { rank: number; handle: string; invites: number; me: boolean };
type Board = { enabled: boolean; week_start: string; week_end: string; ends_at: string; min: number; top: Row[];
  me: { rank: number | null; invites: number }; last_winner: { handle: string; title: string; invites: number } | null };

let boardCache: { at: number; b: Board } | null = null;
export async function loadBoard(force = false): Promise<Board | null> {
  if (!force && boardCache && Date.now() - boardCache.at < 60e3) return boardCache.b;
  try { const b = await api.inviteLeaderboard(); boardCache = { at: Date.now(), b }; return b; } catch { return null; }
}

const day = (d: string) => new Date(`${d}T12:00:00+01:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
function left(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ending now';
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3);
  return d ? `${d}d ${h}h left` : `${h}h ${Math.max(1, Math.floor((ms % 3600e3) / 60e3))}m left`;
}
const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : null);

export default function InviteBoard() {
  const [b, setB] = useState<Board | null | undefined>(undefined);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    loadBoard(true).then(setB);
    api.myReferral().then((r: any) => setCode(r && r.active ? r.code : null)).catch(() => setCode(null));
  }, []);
  const share = async () => {
    if (!code) return;
    const url = inviteUrl(code);
    const how = await shareOrCopy({ title: 'treehouse', text: 'Join me on treehouse: anonymous chats, chatrooms and dating for Nigeria.', url });
    if (how === 'copied') toast('Invite link copied');
    else if (how === 'failed') toast(url, 'link');
  };
  return (
    <div className="stack-lg invite">
      <Hero title="Top inviters" sub="Invite friends to treehouse. The #1 inviter each week is celebrated as Man or Woman of the Week." actions={<BellButton />} />
      <div className="below-hero stack">
        {b === undefined ? <SkeletonList n={4} /> : b === null || !b.enabled ? (
          <EmptyState emoji="🎟️" title="Invites are resting" text="The leaderboard is taking a short break. Check back soon." />
        ) : (
          <>
            {b.last_winner ? (
              <div className="iv-winner">
                <span className="iv-trophy" aria-hidden="true">🏆</span>
                <span className="grow"><small>Last week’s {b.last_winner.title}</small><b>{b.last_winner.handle}</b>
                  <span>{b.last_winner.invites} friends joined with their link</span></span>
                <Avatar seed={b.last_winner.handle} />
              </div>
            ) : null}
            <div className="iv-me">
              <div className="grow">
                <small>This week · {day(b.week_start)} – {day(b.week_end)} · {left(b.ends_at)}</small>
                <b>{b.me.rank ? `You’re #${b.me.rank}` : 'You’re not on the board yet'}</b>
                <span>{b.me.invites ? `${b.me.invites} friend${b.me.invites === 1 ? '' : 's'} joined with your link` : `Invite at least ${b.min} friends to have a shot at the title`}</span>
              </div>
              <button className="btn btn-primary btn-sm" onClick={share} disabled={!code}><Icon name="send" cls="sm" />Invite</button>
            </div>
            <section>
              <div className="section-head"><h2>This week</h2><span className="small muted">Top 50</span></div>
              {b.top.length === 0 ? <EmptyState emoji="🚀" title="Nobody yet this week" text="Share your link first and take the top spot." /> : (
                <ol className="iv-list">
                  {b.top.map((r) => (
                    <li key={r.handle} className={`${r.me ? 'me' : ''} ${r.rank <= 3 ? 'podium' : ''}`}>
                      <span className="iv-rank">{medal(r.rank) || r.rank}</span>
                      <Avatar seed={r.handle} cls="sm" />
                      <span className="grow ellipsis"><b>{r.handle}</b>{r.me ? <span className="iv-you">You</span> : null}</span>
                      <span className="iv-n"><b>{r.invites}</b><small>{r.invites === 1 ? 'friend' : 'friends'}</small></span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <p className="tiny muted center">Friends count once they’ve joined with your link and come back to treehouse. The board resets every Monday; the winner is announced to everyone at noon.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function InviteCard() {
  const [b, setB] = useState<Board | null>(null);
  useEffect(() => { loadBoard().then(setB); }, []);
  if (!b || !b.enabled) return null;
  return (
    <button className="hm-games hm-invite" onClick={() => go('invite')}>
      <span className="hg-text">
        <span className="hg-kicker"><Icon name="sparkles" cls="sm" />Man & Woman of the Week</span>
        <b>{b.last_winner ? `${b.last_winner.handle} won last week. Your turn?` : 'Invite friends and top the leaderboard.'}</b>
        <span className="hg-go">{b.me.rank ? `You’re #${b.me.rank} · See the board` : 'See the leaderboard'}<Icon name="chev" cls="sm" /></span>
      </span>
      <span className="hg-art" aria-hidden="true"><span>🏆</span><span>🎉</span></span>
    </button>
  );
}
