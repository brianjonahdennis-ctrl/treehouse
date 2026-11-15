'use client';
// Older accounts (made before sign-up asked for a date of birth) add it before using chatrooms, Discover
// and Nearby. The database enforces the same rule (dating_private.require_dob); this card explains it.
import type { ReactNode } from 'react';
import { useAppState } from '@/lib/state';
import { go } from '@/lib/nav';
import { EmptyState } from './ui';
import { askBirthday } from './Room';

const WHY = 'treehouse is for adults only, so we need your date of birth before you join chatrooms or use Discover. It’s private: nobody else sees it, only your age.';

export default function DobGate({ what, children }: { what: string; children: ReactNode }) {
  const s = useAppState();
  const p = s.profile;
  // No profile yet (onboarding handles it) or a date of birth already saved: show the screen as normal.
  if (!p || p.birth_date) return <>{children}</>;
  return (
    <div className="stack-lg" style={{ paddingTop: 24 }}>
      <EmptyState emoji="🎂" title="Add your date of birth" text={`To ${what}, add your date of birth first. It’s private: nobody else sees it, only your age.`}>
        <div className="row center-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => askBirthday(undefined, WHY)}>Add date of birth</button>
          <button className="btn btn-ghost" onClick={() => go('home')}>Not now</button>
        </div>
      </EmptyState>
    </div>
  );
}
