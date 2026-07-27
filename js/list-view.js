// ============================================================================
// list-view.js — the alternate list rendering of the filtered places,
// sortable by distance / rating / price (SPEC.md: "not by type/cuisine/
// special, since those aren't ordinal").
// ============================================================================

import { pinIcon, distanceKm, priceRank, escapeHtml } from './helpers.js';
import { starsHtml } from './rating-stars.js';

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

// Sous chaque ligne, les tags du lieu (hors statut) sont regroupés en deux
// rangées à défilement horizontal : "Tags" (type de lieu/cuisine/spécial)
// puis "Prix" — même regroupement que le nuage de tags du panneau filtres,
// juste réparti en deux étiquettes au lieu d'un seul bloc.
function tagGroupsHtml(place) {
  const rest = place.tags.filter((t) => t.category !== 'statut' && t.category !== 'prix');
  const prix = place.tags.filter((t) => t.category === 'prix');
  const groups = [];
  if (rest.length) groups.push({ label: 'Tags', tags: rest });
  if (prix.length) groups.push({ label: 'Prix', tags: prix });

  return groups.map((g) => `
    <div class="list-row-group">
      <div class="list-row-group-label">${g.label}</div>
      <div class="list-row-tag-scroll">
        ${g.tags.map((t) => `<span class="list-row-tag">${escapeHtml(t.emoji)} ${escapeHtml(t.label)}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

export function renderList(root, places, onSelect) {
  const sorted = sortPlaces(places);
  root.innerHTML = '';

  if (sorted.length === 0) {
    root.innerHTML = '<div class="list-empty">Aucun lieu ne correspond aux filtres.</div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'list-card';

  for (const place of sorted) {
    const row = document.createElement('button');
    row.className = 'list-row';
    const distText = userLocation ? `${distanceKm(userLocation, place).toFixed(1)} km` : '';
    const ratingMeta = place.rating !== null
      ? `${starsHtml(place.rating)}<span class="list-row-rating">${place.rating}/5</span>`
      : `<span class="list-row-norating">Note à définir</span>`;
    row.innerHTML = `
      <div class="list-row-top">
        <span class="list-row-icon">${escapeHtml(pinIcon(place))}</span>
        <span class="list-row-body">
          <span class="list-row-name">${escapeHtml(place.name)}</span>
          <span class="list-row-meta">
            ${ratingMeta}
            ${distText ? `<span class="list-row-dot">·</span><span>${distText}</span>` : ''}
          </span>
        </span>
      </div>
      ${tagGroupsHtml(place)}
    `;
    row.addEventListener('click', () => onSelect(place.id));
    card.appendChild(row);
  }

  root.appendChild(card);
}
