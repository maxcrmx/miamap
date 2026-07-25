// ============================================================================
// supabase-client.js — creates the single shared Supabase client instance.
//
// Every other module imports `sb` from here instead of creating its own
// client, so there's exactly one auth session / one set of in-memory
// caches for the whole app.
//
// The Supabase JS SDK itself is loaded via a plain <script> tag in
// index.html (see the comment there) rather than npm, per the "no
// build step" requirement — that script sets `window.supabase`, which is
// the *library*, not to be confused with `sb` below, which is our client
// *instance*.
// ============================================================================

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Persist the session in localStorage so a reload / app reopen doesn't
    // require clicking the magic link again (SPEC.md: "Skipped
    // automatically on future visits if the session is still valid").
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // reads the magic-link token out of the URL on redirect back
  },
});
