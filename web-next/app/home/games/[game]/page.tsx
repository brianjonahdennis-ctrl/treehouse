import { GameScreen } from '@/components/Games';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Page({ params, searchParams }: { params: Promise<{ game: string }>; searchParams: Promise<Search> }) {
  const { game } = await params;
  const q = await searchParams;
  return <GameScreen id={game} join={one(q.join)} challenge={one(q.challenge)} back={one(q.back)} />;
}
