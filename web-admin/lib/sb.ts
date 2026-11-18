'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const MOCK = process.env.NEXT_PUBLIC_ADMIN_MOCK === '1';

let client: SupabaseClient | null = null;

export async function sb(): Promise<SupabaseClient> {
  if (client) return client;
  if (MOCK) {
    const { mockClient } = await import('./mock');
    client = mockClient() as unknown as SupabaseClient;
    return client;
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SUPABASE_URL)) {
    throw new Error('The admin isn’t set up yet: NEXT_PUBLIC_SUPABASE_URL is missing.');
  }
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'th-admin-auth' },
  });
  return client;
}

export class RpcError extends Error {
  code: string;
  constructor(message: string, code = '') { super(message); this.code = code; }
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = await sb();
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new RpcError(error.message || 'Something went wrong.', error.code || '');
  return data as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
export const needsMfa = (e: unknown) => e instanceof Error && /authenticator/i.test(e.message);

/** Latitude/longitude from any Google Maps link, including short maps.app.goo.gl links (read on our server). */
export async function mapLinkCoords(link: string): Promise<{ latitude: number; longitude: number }> {
  if (MOCK) { await new Promise((r) => setTimeout(r, 400)); return { latitude: 6.4281, longitude: 3.4219 }; }
  const c = await sb();
  const { data } = await c.auth.getSession();
  const res = await fetch('/api/maps-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` }, body: JSON.stringify({ url: link }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.message || 'Couldn’t read that link.');
  return out;
}
