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
    // La session est gardée dans localStorage : c'est ce qui fait que le
    // code à 4 chiffres n'est demandé qu'une seule fois par appareil (voir
    // js/auth.js). autoRefreshToken la prolonge tant que l'app est utilisée.
    persistSession: true,
    autoRefreshToken: true,
    // Plus de magic link : aucun jeton de connexion n'arrive par l'URL.
    detectSessionInUrl: false,
  },
});
