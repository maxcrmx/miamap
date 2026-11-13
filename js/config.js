// ============================================================================
// config.js — central place for the app's API keys and constants.
//
// This is a static site with no build step or server, so these keys ship in
// the client-side JS bundle and are visible to anyone who opens dev tools.
// That is expected and safe for both keys used here:
//   - The Supabase key is the "publishable" (anon) key, which is designed to
//     be public — real access control happens in Postgres via Row Level
//     Security policies (see supabase/schema.sql), not by hiding this key.
//   - The Google Maps key is restricted (in the Google Cloud console) to the
//     specific domains this site is hosted on, so it can't be used elsewhere
//     even if copied.
// ============================================================================

export const SUPABASE_URL = 'https://xkgnijhmanupvoszxszi.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sbqVRvbPpW2DFsNlYJlspw_mNYTH5YZ';

// ----------------------------------------------------------------------------
// Connexion par code à 4 chiffres (remplace le magic link, voir js/auth.js).
// ----------------------------------------------------------------------------
// L'app n'a qu'un seul compte : celui de l'admin. L'écran de connexion ne
// demande donc que le code ; l'adresse e-mail du compte est fixée ici.
// (Elle figure déjà en clair dans supabase/schema.sql, rien de nouveau n'est
// rendu public.)
export const ADMIN_EMAIL = 'cremieux.maxime@gmail.com';

// Supabase refuse les mots de passe de moins de 6 caractères. Le mot de passe
// réel du compte est donc ce préfixe suivi du code à 4 chiffres : avec le
// code 1234, le mot de passe enregistré dans Supabase est « miamap-1234 ».
// Le code lui-même n'est écrit nulle part dans ce repo (public) : il n'existe
// que dans Supabase, posé à la main via supabase/set_pin_password.sql.
export const PIN_PASSWORD_PREFIX = 'miamap-';
export const PIN_LENGTH = 4;

// Reused from the original POC (index.html) — the Google Maps JS API key.
export const GOOGLE_MAPS_KEY = 'AIzaSyBnuLqnv74mFOif3XwWQ-eEut9Tc6gyVpY';

// Paris — fallback map center when geolocation is denied/unavailable.
export const DEFAULT_MAP_CENTER = { lat: 48.8566, lng: 2.3522 };

// The five tag categories, in the display order used throughout the app
// (filter panel, add/edit form). Each has a stable `key` (matches the
// `category` column in the `tags` table) and a human label for headings.
export const TAG_CATEGORIES = [
  { key: 'type_de_lieu', label: 'Type de lieu' },
  { key: 'cuisine', label: 'Cuisine' },
  { key: 'special', label: 'Spécial' },
  { key: 'prix', label: 'Prix' },
  { key: 'statut', label: 'Statut' },
];
