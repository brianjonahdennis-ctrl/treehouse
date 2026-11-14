import AnnAdmin from '@/components/AnnAdmin';

// /home/admin → announcements dashboard (the only admin area in the member app so far).
// /home/admin/announcements[/new | /staff | /<id> | /<id>/edit]. The database decides who may use it.
export default async function Page({ params }: { params: Promise<{ sub?: string[] }> }) {
  const { sub } = await params;
  const parts = (sub || []).map((x) => decodeURIComponent(x));
  return <AnnAdmin sub={parts[0] === 'announcements' ? parts.slice(1) : []} />;
}
