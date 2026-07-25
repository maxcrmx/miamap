// ============================================================================
// place-detail.js — the bottom sheet shown when tapping a pin or list row.
// Covers 3/4 of the screen height, swipe-down-from-top to dismiss, shows
// all place info, an external Google Maps link, and (admin only) Edit /
// Delete buttons.
// ============================================================================

import { isAdmin } from './auth.js';
import { deletePlace } from './db.js';
import { escapeHtml } from './helpers.js';

const sheet = document.getElementById('place-sheet');
const sheetContent = document.getElementById('place-sheet-content');

let onEdit = null;
let onDeleted = null;

export function initPlaceDetail({ onEditRequested, onPlaceDeleted }) {
  onEdit = onEditRequested;
  onDeleted = onPlaceDeleted;

  // Swipe-down-to-dismiss on the drag handle area.
  const handle = document.getElementById('place-sheet-handle');
  let startY = null;
  handle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transform = '';
    startY = null;
    if (dy > 80) closePlaceDetail();
  });

  document.getElementById('place-sheet-backdrop').addEventListener('click', closePlaceDetail);
}

function googleMapsUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
}

// Tag chips shown in the "Tags" section — everything except Statut, which
// gets its own dedicated line (see openPlaceDetail's fixed field order).
function tagChipsHtml(place) {
  return place.tags
    .filter((t) => t.category !== 'statut')
    .map((t) => `<span class="tag-chip">${t.emoji} ${escapeHtml(t.label)}</span>`)
    .join('');
}

function statutText(place) {
  const statut = place.tags.find((t) => t.category === 'statut');
  return statut ? `${statut.emoji} ${escapeHtml(statut.label)}` : '—';
}

export function openPlaceDetail(place) {
  const admin = isAdmin();
  const ratingText = place.rating !== null ? `⭐️ ${place.rating}/5` : 'à définir';

  // Field order is a fixed product decision (SPEC.md follow-up): Nom, Tags,
  // Statut, Note, Commentaire général, Top, Bof, Remarques. Note and
  // Commentaire général are always shown (Note falls back to "à définir");
  // Top/Bof/Remarques are only shown when the admin actually wrote something.
  sheetContent.innerHTML = `
    <a class="place-maps-link" href="${googleMapsUrl(place)}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
    <h2 class="place-title">${escapeHtml(place.name)}</h2>
    <p class="place-address">${escapeHtml(place.address)}</p>

    <div class="place-tags">${tagChipsHtml(place)}</div>

    <p class="place-status"><strong>Statut :</strong> ${statutText(place)}</p>
    <p class="place-rating"><strong>Note :</strong> ${ratingText}</p>

    <h4>Commentaire général</h4>
    <p class="place-field">${place.comment ? escapeHtml(place.comment) : '—'}</p>

    ${place.top ? `<h4>Les 👍</h4><p class="place-field">${escapeHtml(place.top)}</p>` : ''}
    ${place.bof ? `<h4>Les 🤷</h4><p class="place-field">${escapeHtml(place.bof)}</p>` : ''}
    ${place.remarks ? `<h4>Remarques</h4><p class="place-field">${escapeHtml(place.remarks)}</p>` : ''}

    ${admin ? `
      <div class="place-admin-actions">
        <button id="place-edit-btn" class="btn-secondary">Modifier</button>
        <button id="place-delete-btn" class="btn-danger">Supprimer</button>
      </div>
    ` : ''}
  `;

  if (admin) {
    sheetContent.querySelector('#place-edit-btn').addEventListener('click', () => {
      closePlaceDetail();
      onEdit(place);
    });
    sheetContent.querySelector('#place-delete-btn').addEventListener('click', async () => {
      if (!confirm(`Supprimer "${place.name}" ? Cette action est définitive.`)) return;
      await deletePlace(place.id);
      closePlaceDetail();
      onDeleted(place.id);
    });
  }

  sheet.classList.add('open');
  document.getElementById('place-sheet-backdrop').classList.add('open');
}

export function closePlaceDetail() {
  sheet.classList.remove('open');
  document.getElementById('place-sheet-backdrop').classList.remove('open');
}
