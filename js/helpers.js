// ============================================================================
// helpers.js — small pure functions shared across map/list/filters/form.
// ============================================================================

// SPEC.md "Pin icon logic": a place's pin icon = the emoji of the FIRST
// "Type de lieu" tag added to that place (place.tags is already sorted by
// added_at ascending — see db.js normalizePlace). Falls back to a generic
// pin emoji if the place has no Type de lieu tag yet (shouldn't normally
// happen since the form requires one, but keeps rendering safe).
export function pinIcon(place) {
  const first = place.tags.find((t) => t.category === 'type_de_lieu');
  return first ? first.emoji : '📍';
}

export function isToTry(place) {
  return place.tags.some((t) => t.category === 'statut' && t.label === 'À tester');
}

// Colors used for the tag-slice ring drawn around each pin, one per
// category present on the place (stable so the same category is always
// the same color across the whole map).
export const CATEGORY_COLORS = {
  type_de_lieu: '#f5d842',
  cuisine: '#ff8a65',
  special: '#4fc3f7',
  prix: '#81c784',
  statut: '#bdbdbd',
};

// Haversine distance in kilometers between two {lat,lng} points.
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Cheapest possible "price rank" for sorting the list view by price, based
// on the place's prix tag label (e.g. "10 - 15€" -> 10). Places with no
// prix tag sort last.
export function priceRank(place) {
  const prix = place.tags.find((t) => t.category === 'prix');
  if (!prix) return Infinity;
  const match = prix.label.match(/\d+/);
  return match ? Number(match[0]) : Infinity;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
