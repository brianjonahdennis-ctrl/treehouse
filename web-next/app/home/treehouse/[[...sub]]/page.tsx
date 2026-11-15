import MyTreehouse from '@/components/MyTreehouse';

// /home/treehouse = My Treehouse; /home/treehouse/tree = Your Tree (Tree view / List view).
export default async function Page({ params }: { params: Promise<{ sub?: string[] }> }) {
  const { sub } = await params;
  return <MyTreehouse sub={sub && sub[0] ? decodeURIComponent(sub[0]) : null} />;
}
