import App from '@/components/App';

// Everything under /home is the member app. It runs in the browser (the Supabase session lives on
// the device, as in the live app); the server only sends the loading screen.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <App>{children}</App>;
}
