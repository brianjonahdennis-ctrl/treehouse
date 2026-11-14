import Inbox from '@/components/Inbox';

// /home/matches, /home/matches/<likes|chats|requests|matches|friends|announcements>, /home/matches/<chat id>,
// /home/matches/announcements/<announcement id>
export default async function Page({ params }: { params: Promise<{ sub?: string[] }> }) {
  const { sub } = await params;
  return <Inbox sub={sub && sub[0] ? decodeURIComponent(sub[0]) : null} item={sub && sub[1] ? decodeURIComponent(sub[1]) : null} />;
}
