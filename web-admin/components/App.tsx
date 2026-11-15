'use client';
import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { allows, SECTIONS } from '@/lib/roles';
import { Gate, useMe } from './Gate';
import { Shell } from './Shell';
import { Toasts, Empty, Spinner } from './ui';
import Dashboard from './Dashboard';
import Reports from './Reports';
import { Members, Member, ChatPage } from './Members';
import { Rooms, RoomPage } from './Rooms';
import { AnnList, AnnEdit, AnnView } from './Announcements';
import { AdsList, AdEdit } from './Ads';
import Referrals from './Referrals';
import { SettingsPage, StaffPage, AuditPage } from './Admin';

function Route() {
  const { me } = useMe();
  const parts = (usePathname() || '/').split('/').filter(Boolean).map(decodeURIComponent);
  const [s, a, b] = parts;
  const sec = SECTIONS.find((x) => x.id === (s || ''));
  if (s && s !== 'chats' && !sec) return <Empty text="That page doesn’t exist." icon="x" />;
  if (sec && !allows(me.role, sec.need)) return <Empty text="Your role can’t open this page." icon="lock" />;
  switch (s || '') {
    case '': return <Dashboard />;
    case 'reports': return <Reports />;
    case 'members': return a ? <Member handle={a} /> : <Members />;
    case 'chats': return a ? <ChatPage id={a} /> : <Empty text="Open a chat from a report or a member." icon="chat" />;
    case 'rooms': return a ? <RoomPage room={a} /> : <Rooms />;
    case 'announcements': return a === 'new' ? <AnnEdit /> : a && b === 'edit' ? <AnnEdit id={a} /> : a ? <AnnView id={a} /> : <AnnList />;
    case 'ads': return a === 'new' ? <AdEdit /> : a ? <AdEdit id={a} /> : <AdsList />;
    case 'referrals': return <Referrals />;
    case 'settings': return <SettingsPage />;
    case 'staff': return <StaffPage />;
    case 'audit': return <AuditPage />;
  }
  return null;
}

export default function App() {
  return (
    <>
      <Gate>
        <Shell>
          <Suspense fallback={<Spinner />}>
            <Route />
          </Suspense>
        </Shell>
      </Gate>
      <Toasts />
    </>
  );
}
