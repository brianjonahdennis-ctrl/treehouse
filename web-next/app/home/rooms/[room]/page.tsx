import Rooms from '@/components/Rooms';
import Room from '@/components/Room';
import DobGate from '@/components/DobGate';

// The chatroom draws on top of the list (like the live app), so going back is instant.
// Older accounts without a date of birth see the "add your date of birth" card instead.
export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <DobGate what="join chatrooms"><Rooms /><Room target={decodeURIComponent(room)} /></DobGate>;
}
