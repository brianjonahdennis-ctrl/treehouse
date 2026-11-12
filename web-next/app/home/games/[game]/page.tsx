import { GameScreen } from '@/components/Games';

export default async function Page({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  return <GameScreen id={game} />;
}
