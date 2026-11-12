import NotYetPorted from '@/components/NotYetPorted';

export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <NotYetPorted title="Chatroom" path={`rooms/${room}`} what="Live chatrooms (messages, reactions, members, kicks)" />;
}
