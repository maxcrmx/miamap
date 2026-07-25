// ============================================================================
// list-view.js — the alternate list rendering of the filtered places,
// sortable by distance / rating / price (SPEC.md: "not by type/cuisine/
// special, since those aren't ordinal").
// ============================================================================

import { pinIcon, distanceKm, priceRank, escapeHtml } from './helpers.js';

let currentSort = 'distance';
let userLocation = null;

export function setUserLocation(loc) {
  userLocation = loc;
}

export function setSort(sort) {
  currentSort = sort;
}

export function getSort() {
  return currentSort;
}

function sortPlaces(places) {
  const sorted = places.slice();
  if (currentSort === 'distance' && userLocation) {
    sorted.sort((a, b) => distanceKm(userLocation, a) - distanceKm(userLocation, b));
  } else if (currentSort === 'rating') {
    // Unrated places (rating === null) sort last regardless of direction.
    sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  } else if (currentSort === 'price') {
    sorted.sort((a, b) => priceRank(a) - priceRank(b));
  }
  return sorted;
}

export function renderList(root, places, onSelect) {
  const sorted = sortPlaces(places);
  root.innerHTML = '';

  if (sorted.length === 0) {
    root.innerHTML = '<div class="list-empty">Aucun lieu ne correspond aux filtres.</div>';
    return;
  }

  for (const place of sorted) {
    const row = document.createElement('button');
    row.className = 'list-row';
    const distText = userLocation ? `${distanceKm(userLocation, place).toFixed(1)} km` : '';
    const ratingText = place.rating !== null ? `⭐️ ${place.rating}/5` : 'Note à définir';
    row.innerHTML = `
      <span class="list-row-icon">${escapeHtml(pinIcon(place))}</span>
      <span class="list-row-body">
        <span class="list-row-name">${escapeHtml(place.name)}</span>
        <span class="list-row-meta">${ratingText} ${distText ? '· ' + distText : ''}</span>
      </span>
    `;
    row.addEventListener('click', () => onSelect(place.id));
    root.appendChild(row);
  }
}
