// ============================================================================
// app.js — main entry point: screen routing, écran de code (connexion), and wiring together
// every other module (map, filters, list view, place detail/form, settings).
//
// This file is intentionally the only one that touches the top-level
// #auth-screen / #main-screen visibility — every other module manages its
// own sub-screen (sheet, form, settings, filter panel).
// ============================================================================

import { DEFAULT_MAP_CENTER, PIN_LENGTH } from './config.js';
import { initAuth, onAuthChange, signInWithPin, getPinLockRemainingSeconds, getLastProfileIssue, signOut, isAdmin } from './auth.js';
import { loadTags } from './tags.js';
import { fetchPlaces } from './db.js';
import { initMap, renderMarkers, setOnPinClick, panTo, setUserLocationMarker } from './map.js';
import { renderFilterPanel, applyFilters, setSearchText } from './filters.js';
import { renderList, setUserLocation, setSort } from './list-view.js';
import { initPlaceDetail, openPlaceDetail } from './place-detail.js';
import { initPlaceForm, openPlaceForm, closePlaceForm } from './place-form.js';
import { openSettings, closeSettings } from './settings.js';

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
// Écran de code (connexion)
// ----------------------------------------------------------------------------
// Pavé numérique façon iPhone : chaque chiffre tapé remplit un point ; au 4e,
// le code part automatiquement vers Supabase (signInWithPin, js/auth.js).
// Code bon → onAuthStateChange affiche la carte tout seul (voir main()).
// Code faux → les points tremblent et se vident.
function initPinScreen() {
  const status = document.getElementById('auth-status');
  const dotsRow = document.getElementById('pin-dots');
  const dots = dotsRow.querySelectorAll('.pin-dot');
  const pad = document.getElementById('pin-pad');

  let pin = '';          // chiffres tapés jusqu'ici
  let busy = false;      // vrai pendant la vérification : on ignore les frappes
  let lockTimer = null;  // minuterie qui rafraîchit le compte à rebours du blocage

  function renderDots() {
    dots.forEach((dot, i) => dot.classList.toggle('filled', i < pin.length));
  }

  // Affiche « Réessaie dans X s » tant qu'un blocage est en cours, puis
  // réactive le pavé. Rappelée chaque seconde par setInterval.
  function refreshLock() {
    const remaining = getPinLockRemainingSeconds();
    const locked = remaining > 0;
    pad.classList.toggle('locked', locked);
    if (locked) {
      const label = remaining >= 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining} s`;
      status.textContent = `Trop d'essais. Réessaie dans ${label}.`;
      if (!lockTimer) lockTimer = setInterval(refreshLock, 1000);
    } else if (lockTimer) {
      clearInterval(lockTimer);
      lockTimer = null;
      status.textContent = '';
    }
    return locked;
  }

  // Petite secousse des points en cas de code faux (animation CSS
  // .pin-dots.shake). On retire puis remet la classe pour pouvoir la rejouer.
  function shake() {
    dotsRow.classList.remove('shake');
    void dotsRow.offsetWidth; // force le navigateur à « oublier » l'animation précédente
    dotsRow.classList.add('shake');
  }

  async function submit() {
    busy = true;
    status.textContent = 'Vérification...';
    const result = await signInWithPin(pin);
    busy = false;
    if (result.ok) {
      status.textContent = '';
      return; // la carte s'affiche via onAuthStateChange
    }
    pin = '';
    renderDots();
    if (result.reason === 'wrong-pin') {
      shake();
      status.textContent = 'Code incorrect.';
      refreshLock(); // affiche le compte à rebours si ce code faux déclenche un blocage
    } else if (result.reason === 'locked') {
      refreshLock();
    } else {
      // Réseau coupé, projet Supabase en pause, limite de tentatives côté
      // serveur... : on affiche le message brut pour savoir quoi faire.
      status.textContent = 'Connexion impossible : ' + result.message;
    }
  }

  function pressDigit(digit) {
    if (busy || refreshLock() || pin.length >= PIN_LENGTH) return;
    if (pin.length === 0) status.textContent = ''; // efface « Code incorrect » au 1er chiffre
    pin += digit;
    renderDots();
    if (pin.length === PIN_LENGTH) submit();
  }

  function erase() {
    if (busy) return;
    pin = pin.slice(0, -1);
    renderDots();
  }

  pad.addEventListener('click', (e) => {
    const key = e.target.closest('.pin-key');
    if (!key) return;
    if (key.id === 'pin-erase') erase();
    else pressDigit(key.dataset.digit);
  });

  // Clavier physique (ordinateur) : chiffres et touche Retour arrière, mais
  // seulement quand l'écran de code est celui affiché.
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('auth-screen').classList.contains('active')) return;
    if (/^[0-9]$/.test(e.key)) pressDigit(e.key);
    else if (e.key === 'Backspace') erase();
  });

  refreshLock(); // un blocage peut encore courir depuis la dernière visite
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
      // Le rechargement est déclenché depuis un handler d'événement : sans
      // ce catch, un échec ici partirait en rejet non géré (visible en
      // console uniquement) et l'écran resterait sur des données périmées
      // sans rien dire.
      try {
        await loadTags({ force: true });
        drawFilterPanel();
        await refreshPlaces();
      } catch (err) {
        alert('Le rafraîchissement a échoué : ' + (err?.message ?? err));
      }
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

  // Recentre la carte sur la dernière position GPS connue (le point bleu).
  // Le bouton est toujours visible, même sans position connue — dans ce
  // cas (géolocalisation refusée/indisponible, ou pas encore reçue) on
  // affiche un message d'erreur plutôt que de ne rien faire, même
  // convention que les autres erreurs de l'app (alert()).
  document.getElementById('locate-me-btn').addEventListener('click', () => {
    if (lastKnownUserLocation) {
      panTo(lastKnownUserLocation, 16);
    } else {
      alert("Impossible de trouver ta position. Vérifie que la géolocalisation est autorisée pour ce site, puis réessaie.");
    }
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
}

function applyAdminVisibility() {
  const admin = isAdmin();
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !admin);
  });
}

// `granted` distingue "vraie position GPS obtenue" de "repli sur Paris" —
// les deux résolvent avec un `center` utilisable pour centrer la carte, mais
// seul le premier cas doit déclencher le point bleu (startUserLocationWatch
// ci-dessous) : la géolocalisation refusée/indisponible doit garder le
// centrage par défaut SANS jamais afficher de point bleu.
function locateUser() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ center: DEFAULT_MAP_CENTER, granted: false });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, granted: true }),
      () => resolve({ center: DEFAULT_MAP_CENTER, granted: false }),
      { timeout: 5000 }
    );
  });
}

// Point bleu façon Google Maps (voir map.js setUserLocationMarker) : suit la
// position réelle en continu tant que l'app est ouverte, via watchPosition
// plutôt qu'un seul getCurrentPosition. N'est appelée qu'après un premier
// succès de géolocalisation (voir bootMainApp) — jamais si l'utilisateur a
// refusé ou si l'appareil n'a pas de géolocalisation.
function startUserLocationWatch() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (pos) => updateUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => {}, // une erreur ponctuelle (GPS perdu un instant) ne doit pas faire disparaître le point : on garde sa dernière position connue
    { enableHighAccuracy: false, maximumAge: 10000, timeout: 10000 }
  );
}

// Dernière position GPS connue — mémorisée pour que le bouton "centrer sur
// ma position" (id="locate-me-btn") sache où recentrer la carte au clic
// sans redemander la géolocalisation à chaque fois.
let lastKnownUserLocation = null;

function updateUserLocation(loc) {
  lastKnownUserLocation = loc;
  setUserLocationMarker(loc);
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

  const { center, granted } = await locateUser();
  setUserLocation(center);
  initMap(document.getElementById('map-container'), center);
  panTo(center);
  if (granted) {
    updateUserLocation(center); // évite d'attendre le premier tick de watchPosition
    startUserLocationWatch();
  }

  await loadTags();
  drawFilterPanel();
  await refreshPlaces();
}

async function handleAuthed(profile) {
  if (!profile) {
    // A null profile does NOT necessarily mean "not logged in". Le code peut
    // être accepté par Supabase alors que la lecture du profil échoue — le
    // plus souvent parce que `profiles.user_id` n'est pas relié au compte.
    // On dit toujours ce qui s'est réellement passé plutôt que de revenir
    // sans un mot à l'écran de code.
    const issue = getLastProfileIssue();
    const status = document.getElementById('auth-status');
    if (issue === 'not-linked') {
      status.textContent =
        "Connexion réussie côté Supabase, mais ton compte n'est relié à aucun profil dans la base. " +
        "Exécute supabase/link_profile.sql dans l'éditeur SQL Supabase, puis recharge cette page — " +
        "ta session est déjà active, pas besoin de retaper le code.";
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
  initPinScreen();
  onAuthChange(handleAuthed);
  const profile = await initAuth();
  await handleAuthed(profile);
}

main();
