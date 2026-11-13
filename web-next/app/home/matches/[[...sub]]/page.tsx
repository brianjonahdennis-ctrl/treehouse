import Inbox from '@/components/Inbox';

// /home/matches, /home/matches/<likes|chats|requests|matches|friends>, /home/matches/<chat id>
export default async function Page({ params }: { params: Promise<{ sub?: string[] }> }) {
  const { sub } = await params;
  return <Inbox sub={sub && sub[0] ? decodeURIComponent(sub[0]) : null} />;
}
