// ============================================================================
// app.js — main entry point: screen routing, auth gate, and wiring together
// every other module (map, filters, list view, place detail/form, settings).
//
// This file is intentionally the only one that touches the top-level
// #auth-screen / #main-screen visibility — every other module manages its
// own sub-screen (sheet, form, settings, filter panel).
// ============================================================================

import { DEFAULT_MAP_CENTER } from './config.js';
import { initAuth, onAuthChange, sendMagicLink, verifyEmailCode, readAuthErrorFromUrl, getLastProfileIssue, signOut, isAdmin, getCurrentProfile } from './auth.js';
import { loadTags } from './tags.js';
import { fetchPlaces } from './db.js';
import { initMap, renderMarkers, setOnPinClick, panTo } from './map.js';
import { renderFilterPanel, applyFilters, setSearchText } from './filters.js';
import { renderList, setUserLocation, setSort } from './list-view.js';
import { initPlaceDetail, openPlaceDetail } from './place-detail.js';
import { initPlaceForm, openPlaceForm, closePlaceForm } from './place-form.js';
import { initSettings, openSettings, closeSettings } from './settings.js';

let allPlaces = [];
let currentView = 'map'; // 'map' | 'list'

// ----------------------------------------------------------------------------
// Screen visibility helpers
// ----------------------------------------------------------------------------
function showScreen(id) {
  document.querySelectorAll('.top-screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ----------------------------------------------------------------------------
// Auth screen
// ----------------------------------------------------------------------------
function initAuthScreen() {
  const form = document.getElementById('auth-form');
  const status = document.getElementById('auth-status');
  const codeToggle = document.getElementById('auth-code-toggle');
  const codeForm = document.getElementById('auth-code-form');

  // Surface a failed magic-link redirect instead of silently falling back
  // to an empty login screen — see readAuthErrorFromUrl() in auth.js for
  // why this happens (most commonly: a mail client's link scanner
  // consuming the one-time token before the real click).
  // This error comes from Supabase's /verify endpoint (server-side), not
  // from our code — it means the token in the link was already rejected
  // before the page loaded. In practice that's almost always a *superseded*
  // link: Supabase keeps only ONE active magic-link token per user, so
  // every time a new link is requested, all previously emailed links die.
  // Hence the explicit "most recent email" wording.
  const emailInput = document.getElementById('auth-email');

  // Restore the last address a code/link was sent to. Without this, a failed
  // magic-link redirect reloads the page with an EMPTY email field, and
  // verifying a code then fails — GoTrue needs the exact address the code was
  // issued for, and returns the same generic "Token has expired or is
  // invalid" error when the address doesn't match, which is indistinguishable
  // from a genuinely bad code.
  const REMEMBERED_EMAIL_KEY = 'miamap.lastAuthEmail';
  emailInput.value = localStorage.getItem(REMEMBERED_EMAIL_KEY) || '';

  const authError = readAuthErrorFromUrl();
  if (authError) {
    status.textContent =
      `Lien refusé par Supabase (${authError}). ` +
      `Chaque nouvelle demande annule les liens précédents : n'ouvre que le DERNIER email reçu. ` +
      `Plus fiable : demande un nouvel email et saisis son code ci-dessous SANS cliquer sur le lien ` +
      `(le lien et le code sont le même jeton à usage unique — cliquer le lien annule le code).`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    status.textContent = 'Envoi du lien...';
    const { error } = await sendMagicLink(email);
    if (error) {
      status.textContent = 'Erreur : ' + error.message;
      return;
    }
    localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    status.textContent =
      `✓ Email envoyé à ${email}. Pour te connecter, saisis le code de cet email ci-dessous ` +
      `plutôt que de cliquer sur le lien.`;
    codeForm.classList.remove('hidden');
  });

  codeToggle.addEventListener('click', () => {
    codeForm.classList.toggle('hidden');
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    // The code is tied to the address it was sent to — read it from the same
    // input above (now pre-filled from localStorage, see REMEMBERED_EMAIL_KEY).
    const email = emailInput.value.trim();
    const code = document.getElementById('auth-code-input').value.trim();
    if (!email) {
      status.textContent = 'Renseigne d\'abord ton email ci-dessus (celui auquel le code a été envoyé).';
      return;
    }
    if (!code) return;

    // Disable while in flight: a second submit would resend the SAME code,
    // which Supabase has already consumed, producing a misleading
    // "otp_expired" that hides the fact the first call actually succeeded.
    const submitBtn = codeForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.textContent = 'Vérification du code...';
    const { error } = await verifyEmailCode(email, code);
    submitBtn.disabled = false;
    if (error) {
      // Include the error code/status: GoTrue reuses the same human message
      // for several distinct causes, so these extra fields are what actually
      // tell them apart when debugging.
      const detail = [error.code, error.status].filter(Boolean).join(' / ');
      status.textContent =
        `Code refusé : ${error.message}${detail ? ` [${detail}]` : ''}. ` +
        `Vérifie que l'email ci-dessus est bien celui du destinataire, que le code vient du DERNIER ` +
        `email reçu, et que tu n'as pas déjà cliqué le lien de ce même email.`;
      console.error('verifyOtp a échoué :', error);
      return;
    }
    status.textContent = '';
    // On success, onAuthStateChange (registered in main()) picks up the new
    // session and switches screens automatically — nothing else to do here.
  });
}

// ----------------------------------------------------------------------------
// Main screen: refreshing data + re-rendering both map and list views
// ----------------------------------------------------------------------------
async function refreshPlaces() {
  allPlaces = await fetchPlaces();
  rerenderCurrentView();
}

// Le panneau de filtres, redessiné aussi après un renommage/suppression de
// tag (appui long sur une pilule) : `onTagsChanged` recharge alors la liste
// des tags et les lieux, puisque chaque lieu embarque une copie de ses tags.
function drawFilterPanel() {
  renderFilterPanel(
    document.getElementById('filter-panel-content'),
    rerenderCurrentView,
    async () => {
      await loadTags({ force: true });
      drawFilterPanel();
      await refreshPlaces();
    }
  );
}

function rerenderCurrentView() {
  const filtered = applyFilters(allPlaces);
  if (currentView === 'map') {
    renderMarkers(filtered);
  } else {
    renderList(document.getElementById('list-container'), filtered, (id) => {
      const place = allPlaces.find((p) => p.id === id);
      if (place) openPlaceDetail(place);
    });
  }
}

// Bascule carte/liste pilotée par la pilule segmentée du haut (réf.
// Mapstr 01-accueil). En vue liste : le bloc de contrôles du haut devient
// une barre blanche (.list-mode, voir style.css) et la ligne de tri
// apparaît ; en vue carte, le tri est masqué (il n'a de sens que trié).
function setView(view) {
  currentView = view;
  const isMap = view === 'map';
  document.getElementById('map-container').classList.toggle('hidden', !isMap);
  document.getElementById('list-container').classList.toggle('hidden', isMap);
  document.getElementById('view-map-btn').classList.toggle('active', isMap);
  document.getElementById('view-list-btn').classList.toggle('active', !isMap);
  document.getElementById('main-screen').classList.toggle('list-mode', !isMap);
  document.getElementById('sort-row').classList.toggle('hidden', isMap);
  rerenderCurrentView();
}

function initMainScreenChrome() {
  document.getElementById('view-map-btn').addEventListener('click', () => setView('map'));
  document.getElementById('view-list-btn').addEventListener('click', () => setView('list'));

  // La loupe déplie/replie la barre de recherche par nom.
  document.getElementById('search-toggle-btn').addEventListener('click', () => {
    const row = document.getElementById('search-row');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) document.getElementById('search-input').focus();
  });

  document.getElementById('filter-open-btn').addEventListener('click', () => {
    document.getElementById('filter-panel').classList.add('open');
    document.getElementById('filter-backdrop').classList.add('open');
  });
  document.getElementById('filter-backdrop').addEventListener('click', () => {
    document.getElementById('filter-panel').classList.remove('open');
    document.getElementById('filter-backdrop').classList.remove('open');
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    setSearchText(e.target.value);
    rerenderCurrentView();
  });

  document.querySelectorAll('input[name="sort"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      setSort(e.target.value);
      rerenderCurrentView();
    });
  });

  document.getElementById('add-place-btn').addEventListener('click', () => openPlaceForm());

  document.getElementById('settings-open-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);

  document.getElementById('place-form-close-x').addEventListener('click', closePlaceForm);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  drawFilterPanel();

  setOnPinClick((id) => {
    const place = allPlaces.find((p) => p.id === id);
    if (place) openPlaceDetail(place);
  });

  initPlaceDetail({
    onEditRequested: (place) => openPlaceForm(place),
    onPlaceDeleted: () => refreshPlaces(),
    // Déclenché quand la fiche modifie le lieu sur place (interrupteur de
    // statut, clic sur les étoiles) : on rafraîchit carte/liste derrière.
    onPlaceChanged: () => refreshPlaces(),
  });

  initPlaceForm({ onSaveComplete: () => refreshPlaces() });
  initSettings();
}

function applyAdminVisibility() {
  const admin = isAdmin();
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !admin);
  });
}

function locateUser() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(DEFAULT_MAP_CENTER);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(DEFAULT_MAP_CENTER),
      { timeout: 5000 }
    );
  });
}

// ----------------------------------------------------------------------------
// Boot sequence
// ----------------------------------------------------------------------------
let booted = false;

async function bootMainApp() {
  if (booted) {
    applyAdminVisibility();
    return;
  }
  booted = true;

  await window.googleMapsReady; // wait for the async Google Maps <script> before touching google.maps

  applyAdminVisibility();
  initMainScreenChrome();

  const center = await locateUser();
  setUserLocation(center);
  initMap(document.getElementById('map-container'), center);
  panTo(center);

  await loadTags();
  drawFilterPanel();
  await refreshPlaces();
}

async function handleAuthed(profile) {
  if (!profile) {
    // A null profile does NOT necessarily mean "not logged in". The magic
    // link / code can succeed while the profiles lookup still fails — most
    // commonly because `profiles.user_id` was never linked to the auth user.
    // Previously this path just showed the login screen with no message,
    // which looked identical to "nothing happened" while the one-time code
    // had in fact been consumed. Always say what actually went wrong.
    const issue = getLastProfileIssue();
    const status = document.getElementById('auth-status');
    if (issue === 'not-linked') {
      status.textContent =
        "Connexion réussie côté Supabase, mais ton compte n'est relié à aucun profil dans la base. " +
        "Exécute supabase/link_profile.sql dans l'éditeur SQL Supabase, puis recharge cette page — " +
        "ta session est déjà active, aucun nouveau code ne sera nécessaire.";
    } else if (issue === 'query-error') {
      status.textContent =
        "Connexion réussie, mais la lecture de la table `profiles` a échoué (policy RLS ou réseau). " +
        "Détails dans la console du navigateur.";
    } else if (issue === 'revoked') {
      status.textContent = "Cet accès a été révoqué.";
    }
    showScreen('auth-screen');
    return;
  }
  showScreen('main-screen');
  await bootMainApp();
}

async function main() {
  initAuthScreen();
  onAuthChange(handleAuthed);
  const profile = await initAuth();
  await handleAuthed(profile);
}

main();
