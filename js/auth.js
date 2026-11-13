// ============================================================================
// auth.js — connexion par code à 4 chiffres, état de session, lecture du rôle.
//
// Fonctionnement :
//   1. Sur l'écran de connexion, tu tapes ton code à 4 chiffres.
//   2. On appelle `signInWithPassword` de Supabase avec l'e-mail de l'admin
//      (fixé dans config.js) et le mot de passe « préfixe + code » (voir
//      PIN_PASSWORD_PREFIX dans config.js). C'est Supabase qui vérifie le
//      code, côté serveur : il n'est jamais stocké dans le navigateur.
//   3. La session obtenue est conservée sur l'appareil (persistSession, voir
//      supabase-client.js) : le code n'est donc demandé qu'une seule fois par
//      appareil, jusqu'à un « Se déconnecter » dans les Réglages.
//   4. On lit ensuite la ligne `profiles` liée au compte pour connaître son
//      rôle (admin). Les règles RLS de supabase/schema.sql continuent de
//      s'appliquer exactement comme avant.
//
// Blocage après plusieurs codes faux (comme un iPhone) : après 5 erreurs
// d'affilée, on impose une attente de 30 s, puis 1 min, puis 5 min à chaque
// nouvelle erreur. Ce compteur vit dans le navigateur (localStorage) : c'est
// un garde-fou d'usage, la vraie limite côté serveur étant celle de Supabase
// sur le nombre de tentatives de connexion.
//
// Remplace l'ancien magic link (lien + code reçus par e-mail), retiré parce
// qu'il échouait régulièrement.
// ============================================================================

import { sb } from './supabase-client.js';
import { ADMIN_EMAIL, PIN_PASSWORD_PREFIX } from './config.js';

// In-memory cache of the current user's profile (role + active status).
// Re-fetched on every sign-in event, so a revoke takes effect the next time
// the app loads/refreshes the session — see the RLS policies for the
// server-side enforcement, which is what actually matters for security.
let currentProfile = null;

export function getCurrentProfile() {
  return currentProfile;
}

// ----------------------------------------------------------------------------
// Blocage progressif après des codes faux
// ----------------------------------------------------------------------------
const LOCK_STORAGE_KEY = 'miamap.pinLock';
const FREE_ATTEMPTS = 5; // nombre d'erreurs tolérées avant la première attente
// Durée d'attente (en secondes) imposée à la 1re, 2e, 3e... erreur au-delà
// des 5 gratuites. Au-delà de la fin du tableau, on garde la dernière valeur.
const LOCK_DELAYS_SECONDS = [30, 60, 300];

// Lit l'état du compteur. try/catch : localStorage peut être indisponible
// (navigation privée stricte) ; dans ce cas on repart simplement de zéro.
function readLockState() {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { failures: parsed?.failures ?? 0, lockedUntil: parsed?.lockedUntil ?? 0 };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

function writeLockState(state) {
  try {
    localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Rien à faire : sans stockage, le blocage ne survit pas à un rechargement.
  }
}

// Nombre de secondes d'attente restantes avant de pouvoir retenter (0 = libre).
export function getPinLockRemainingSeconds() {
  const { lockedUntil } = readLockState();
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

// Enregistre une erreur et, si on dépasse les 5 essais gratuits, pose une
// attente dont la durée augmente à chaque nouvelle erreur.
function registerPinFailure() {
  const state = readLockState();
  state.failures += 1;
  // 0 à la 5e erreur, 1 à la 6e, 2 à la 7e... (négatif avant la 5e = pas d'attente)
  const overLimit = state.failures - FREE_ATTEMPTS;
  if (overLimit >= 0) {
    // 5e erreur → 30 s, 6e → 1 min, 7e et suivantes → 5 min.
    const delay = LOCK_DELAYS_SECONDS[Math.min(overLimit, LOCK_DELAYS_SECONDS.length - 1)];
    state.lockedUntil = Date.now() + delay * 1000;
  }
  writeLockState(state);
}

function resetPinFailures() {
  writeLockState({ failures: 0, lockedUntil: 0 });
}

// ----------------------------------------------------------------------------
// Connexion par code
// ----------------------------------------------------------------------------
// Renvoie { ok: true } si le code est bon, sinon { ok: false, reason, message }
// avec reason = 'locked' (attente en cours), 'wrong-pin' (code faux) ou
// 'error' (réseau, projet Supabase en pause, trop de tentatives côté serveur...).
// En cas de succès, onAuthStateChange (voir onAuthChange plus bas) prend le
// relais et affiche la carte : rien d'autre à faire pour l'appelant.
export async function signInWithPin(pin) {
  if (getPinLockRemainingSeconds() > 0) {
    return { ok: false, reason: 'locked' };
  }

  const { error } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: PIN_PASSWORD_PREFIX + pin,
  });

  if (!error) {
    resetPinFailures();
    return { ok: true };
  }

  // Supabase renvoie le code d'erreur 'invalid_credentials' (message
  // « Invalid login credentials ») quand le mot de passe est faux. Seul ce
  // cas compte comme une erreur de code : une coupure réseau ou un projet
  // en pause ne doit pas te bloquer.
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
    registerPinFailure();
    return { ok: false, reason: 'wrong-pin' };
  }

  console.error('[auth] signInWithPassword a échoué :', error);
  return { ok: false, reason: 'error', message: error.message };
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

// Subscribe to future auth changes (connexion par code, logout, token
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
