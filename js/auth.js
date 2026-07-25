// ============================================================================
// auth.js — Magic Link sign-in, session state, and role lookup.
//
// Flow:
//   1. User types their email on the auth screen and we call
//      `signInWithOtp`, which makes Supabase send them a magic link email.
//   2. They click it, land back on this site with a token in the URL,
//      and the Supabase SDK (via detectSessionInUrl, see supabase-client.js)
//      turns that into a logged-in session automatically.
//   3. We then read their `profiles` row to find out if they're an admin
//      or a reader. If no profiles row exists (they were never invited —
//      see supabase/schema.sql), we treat them as unauthorized and sign
//      them back out, even though Supabase itself let the login succeed.
// ============================================================================

import { sb } from './supabase-client.js';

// In-memory cache of the current user's profile (role + active status).
// Re-fetched on every sign-in event, so a revoke takes effect the next time
// the app loads/refreshes the session — see the RLS policies for the
// server-side enforcement, which is what actually matters for security.
let currentProfile = null;

export function getCurrentProfile() {
  return currentProfile;
}

// Sends the magic link (Supabase's email also contains a 6-digit code as a
// fallback — see verifyEmailCode below — so this stays "Supabase's own
// magic link mechanism", just with a second way to redeem the same code).
export async function sendMagicLink(email) {
  const redirectTo = window.location.origin + window.location.pathname;
  return sb.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: { emailRedirectTo: redirectTo },
  });
}

// Fallback path: redeem the numeric code Supabase emailed alongside the
// link.
//
// IMPORTANT — the link and the code in a single email are two forms of the
// SAME one-time token (the link carries its hashed form, `{{ .Token }}` the
// plaintext code). Redeeming either one consumes both. So if you click the
// link first, the code from that same email is already dead.
//
// `type: 'email'` is the correct value for a numeric code sent by
// signInWithOtp({ email }) — confirmed against Supabase's verifyOtp docs.
// Not 'magiclink', which is not a documented type for verifyOtp.
//
// The email must match the one the code was sent to exactly. GoTrue stores
// addresses lowercased, and returns the SAME generic "Token has expired or
// is invalid" error whether the token is wrong OR the user lookup failed —
// so a mistyped/differently-cased address looks identical to a bad code.
// Hence the normalization here.
export async function verifyEmailCode(email, code) {
  const params = {
    email: normalizeEmail(email),
    token: code.replace(/\s+/g, ''), // tolerate a pasted "1234 5678"
    type: 'email',
  };
  console.log('[auth] verifyOtp — requête envoyée :', params);
  const result = await sb.auth.verifyOtp(params);
  console.log('[auth] verifyOtp — réponse brute :', {
    session: result.data?.session ? '(session créée)' : null,
    user: result.data?.user?.id ?? null,
    error: result.error,
  });
  return result;
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// If the magic link redirect failed server-side (expired/already-used
// token, mismatched redirect URL, etc.), Supabase appends the failure as
// `#error=...&error_description=...` (or `?error=...`) to the redirect URL
// instead of the session tokens. Previously nothing read these — the app
// just silently fell back to the login screen with no explanation, which
// is what made this bug hard to diagnose. Call this once on startup.
export function readAuthErrorFromUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const description = hashParams.get('error_description') || queryParams.get('error_description');
  const code = hashParams.get('error_code') || queryParams.get('error_code');
  if (!description && !code) return null;

  // Clean the failed params out of the URL so a refresh doesn't re-show
  // the same stale error.
  window.history.replaceState(null, '', window.location.pathname);

  return (description ? decodeURIComponent(description.replace(/\+/g, ' ')) : null) || code;
}

export async function signOut() {
  currentProfile = null;
  await sb.auth.signOut();
}

// Why the last loadProfile() call returned null. Without this, an
// authenticated-but-unlinked user was indistinguishable from a logged-out
// one, and the app silently bounced back to the login screen — which looked
// exactly like "the login did nothing" even though it had fully succeeded.
let lastProfileIssue = null;

export function getLastProfileIssue() {
  return lastProfileIssue;
}

// Fetches the profiles row for the currently logged-in Supabase auth user.
// Returns null if there is no session, or no matching (invited) profile.
// `knownUser` lets callers pass the user object they already have (e.g. the
// one handed to the onAuthStateChange callback), skipping a redundant
// getUser() network round-trip inside that callback.
async function loadProfile(knownUser = null) {
  let user = knownUser;
  if (!user) {
    ({ data: { user } } = await sb.auth.getUser());
  }
  if (!user) {
    currentProfile = null;
    lastProfileIssue = 'no-session';
    return null;
  }

  const { data, error } = await sb
    .from('profiles')
    .select('id, role, is_active, email')
    .eq('user_id', user.id)
    .maybeSingle();

  console.log('[auth] loadProfile — recherche du profil pour auth user', {
    authUserId: user.id,
    authUserEmail: user.email,
    profilTrouve: data,
    erreur: error,
  });

  if (error) {
    currentProfile = null;
    lastProfileIssue = 'query-error';
    console.error('[auth] Lecture de `profiles` en échec (RLS ou réseau) :', error);
    return null;
  }

  if (!data) {
    // Authenticated with Supabase, but no profiles row is linked to this
    // auth user id. Typically `profiles.user_id` is still NULL because the
    // auth.users row was created before the profile existed (or the
    // on_auth_user_created trigger never ran). See supabase/link_profile.sql.
    currentProfile = null;
    lastProfileIssue = 'not-linked';
    console.error(
      '[auth] Session valide mais AUCUN profil lié à cet utilisateur.',
      'auth.uid() =', user.id, '| email =', user.email,
      '→ `profiles.user_id` doit être renseigné pour cette adresse.'
    );
    return null;
  }

  if (!data.is_active) {
    // Revoked: don't let an authenticated-but-unauthorized session linger.
    currentProfile = null;
    lastProfileIssue = 'revoked';
    await sb.auth.signOut();
    return null;
  }

  currentProfile = data;
  lastProfileIssue = null;
  return data;
}

// Resolves once we know whether there's a valid, authorized session.
// Returns the profile (or null). Call this on app startup.
export async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  return loadProfile();
}

// Subscribe to future auth changes (login via magic link, logout, token
// refresh). `callback(profile)` fires with the new profile (or null).
export function onAuthChange(callback) {
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      currentProfile = null;
      callback(null);
      return;
    }
    const profile = await loadProfile(session.user);
    callback(profile);
  });
}

export function isAdmin() {
  return currentProfile?.role === 'admin';
}
