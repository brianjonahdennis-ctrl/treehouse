'use client';
// Shown for screens that haven't moved to the Next.js app yet (see MIGRATION.md). They still work in
// the live app, so the button opens the same screen there.
import { Hero, EmptyState } from './ui';
import { BellButton } from './Home';

const LIVE = process.env.NEXT_PUBLIC_LIVE_APP || 'https://treehouse.ng';

export default function NotYetPorted({ title, path, what }: { title: string; path: string; what: string }) {
  return (
    <div className="stack-lg">
      <Hero title={title} actions={<BellButton />} />
      <EmptyState emoji="🚧" title="Not in the new app yet" text={`${what}: this part is still being moved to the new version of treehouse.`}>
        <a className="btn btn-primary" href={`${LIVE}/home/${path}`}>Open it in the current app</a>
      </EmptyState>
    </div>
  );
}
