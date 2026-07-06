import "server-only";

// Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never be
// imported into client code or exposed to the browser. The autopilots tables have
// RLS enabled with no public policies, so only this client can read/write them.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  // The SECRET key (sb_secret_…, the service_role replacement) — bypasses RLS.
  // NOT the publishable key, which respects RLS and can't reach the locked tables.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY).");
  }
  if (!client) {
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}
