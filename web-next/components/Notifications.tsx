'use client';
// Notifications screen (port of renderNotifications in anon-inbox/public/hy-app.js). Built from data
// the app already has; nothing extra is fetched.
import { useEffect } from 'react';
import { useAppState, notifications, notifSeenAt, markNotifsSeen } from '@/lib/state';
import { go, openChat } from '@/lib/nav';
import { ago } from '@/lib/util';
import { Hero, EmptyState } from './ui';

export default function Notifications() {
  useAppState();
  const seen = notifSeenAt();
  const items = notifications();
  useEffect(() => { const t = setTimeout(markNotifsSeen, 1500); return () => clearTimeout(t); }, []);
  const head = <Hero title="Notifications" sub="Messages, requests, matches and chats." />;
  if (!items.length) return <div className="stack-lg">{head}<EmptyState emoji="🔔" title="All caught up" text="New chats, message requests, likes and matches will show up here." /></div>;
  return (
    <div className="stack-lg">{head}
      <div className="card" style={{ padding: '6px' }}>{items.map((n, i) => (
        <button key={`${n.kind}-${n.chat || n.to}-${i}`} className={`notif ${new Date(n.at).getTime() > seen ? 'new' : ''}`} onClick={() => (n.chat ? openChat(n.chat) : go(n.to || 'home'))}>
          <span className="n-icon">{n.emoji}</span>
          <span className="grow"><p>{n.text}</p><span className="when">{ago(n.at)}</span></span>
        </button>
      ))}</div>
      <p className="tiny muted center">Want these on your lock screen? Push notifications can be turned on in the current app (moving here soon).</p>
    </div>
  );
}
