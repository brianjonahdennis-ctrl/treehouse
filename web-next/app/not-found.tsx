import Link from 'next/link';
export default function NotFound() {
  return <div className="loading-screen"><div className="empty"><div className="empty-art"><span>🧭</span></div><h3>Page not found</h3><p><Link href="/home">Go to treehouse</Link></p></div></div>;
}
