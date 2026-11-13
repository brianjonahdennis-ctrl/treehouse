import Rooms from '@/components/Rooms';
import Room from '@/components/Room';

// The chatroom draws on top of the list (like the live app), so going back is instant.
export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <><Rooms /><Room target={decodeURIComponent(room)} /></>;
}
