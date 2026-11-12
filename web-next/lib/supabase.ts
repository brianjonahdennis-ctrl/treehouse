'use client';
// The one Supabase client for the browser. Same project, same *publishable* key and the same
// database functions as the live app (anon-inbox/public/hy-api.js). No secret keys ever live here:
// what each person may read is decided by the database (row-level security + functions).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const MOCK = process.env.NEXT_PUBLIC_TH_MOCK === '1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient | any = null;

export async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  if (MOCK) {
    // Preview mode: sample people, no database (the same fake client the old app's preview uses).
    // @ts-expect-error plain script (sets window.supabase), not a module
    await import('../dev/mock-supabase.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = (window as any).supabase.createClient('mock', 'mock');
    return client;
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) || !/^sb_publishable_[\w-]+$/.test(SUPABASE_KEY)) {
    throw new Error('treehouse isn’t available right now. Please try again later.');
  }
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}
