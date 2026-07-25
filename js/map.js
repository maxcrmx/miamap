// ============================================================================
// map.js — Google Map rendering: pins (custom SVG icon), clustering, and
// wiring pin/cluster clicks back into the rest of the app.
//
// Pin design (SPEC.md "Screens & UX flow" #2):
//   - center emoji = the place-type emoji (see helpers.js pinIcon)
//   - a ring around it divided into colored slices, one slice per tag
//     *category* the place has at least one tag in (not one slice per tag —
//     that would get unreadable fast for places with many tags)
//   - a small badge in the top-right corner if the place is "to try"
// Clusters (zoomed out, pins close together) render as a plain light-grey
// filled circle with the count of aggregated places, via the
// @googlemaps/markerclusterer library (loaded from a CDN <script> tag in
// index.html, same "no bundler" approach as the rest of the app).
// ============================================================================

import { pinIcon, isToTry, CATEGORY_COLORS } from './helpers.js';

let map = null;
let markers = new Map(); // place id -> google.maps.Marker
let clusterer = null;
let onPinClick = null;

const PIN_SIZE = 40;

// Builds a data: URL for a place's pin icon as inline SVG. Doing this per
// place (rather than one shared icon) is what lets each pin show its own
// emoji + category-color slices + to-try badge.
function buildPinSvg(place) {
  const r = PIN_SIZE / 2;
  const cx = r;
  const cy = r;
  const ringWidth = 5;
  const innerR = r - ringWidth - 1;

  // One slice per distinct tag category present on the place, in a fixed
  // order so colors are consistent across pins.
  const categories = Object.keys(CATEGORY_COLORS).filter((cat) =>
    place.tags.some((t) => t.category === cat)
  );
  const slices = categories.length ? categories : ['type_de_lieu']; // never render an empty ring
  const anglePer = (2 * Math.PI) / slices.length;

  const arcPaths = slices
    .map((cat, i) => {
      const start = i * anglePer - Math.PI / 2;
      const end = start + anglePer;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = anglePer > Math.PI ? 1 : 0;
      return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${CATEGORY_COLORS[cat]}" />`;
    })
    .join('');

  const badge = isToTry(place)
    ? `<circle cx="${PIN_SIZE - 6}" cy="6" r="6" fill="#1a73e8" stroke="#fff" stroke-width="1.5" />`
    : '';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 ${PIN_SIZE} ${PIN_SIZE}">
      <g>${arcPaths}</g>
      <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#ffffff" stroke="#e0e0e0" stroke-width="1" />
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="16">${pinIcon(place)}</text>
      ${badge}
    </svg>
  `;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export function initMap(container, center) {
  map = new google.maps.Map(container, {
    center,
    zoom: 13,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
  });
  return map;
}

export function getMap() {
  return map;
}

export function setOnPinClick(fn) {
  onPinClick = fn;
}

// Redraws all markers for the given (already filtered) list of places.
// Called every time filters/search change — SPEC.md "Map updates live as
// filters/search change."
export function renderMarkers(places) {
  if (clusterer) clusterer.clearMarkers();
  markers.forEach((m) => m.setMap(null));
  markers = new Map();

  const newMarkers = places.map((place) => {
    const marker = new google.maps.Marker({
      position: { lat: place.lat, lng: place.lng },
      icon: {
        url: buildPinSvg(place),
        scaledSize: new google.maps.Size(PIN_SIZE, PIN_SIZE),
        anchor: new google.maps.Point(PIN_SIZE / 2, PIN_SIZE / 2),
      },
      title: place.name,
    });
    marker.addListener('click', () => onPinClick && onPinClick(place.id));
    markers.set(place.id, marker);
    return marker;
  });

  // markerClusterer.MarkerClusterer is the global exposed by the CDN build.
  // Renderer override: plain light-grey circle + count, per SPEC.md.
  clusterer = new markerClusterer.MarkerClusterer({
    map,
    markers: newMarkers,
    renderer: {
      render: ({ count, position }) =>
        new google.maps.Marker({
          position,
          icon: {
            url:
              'data:image/svg+xml;charset=UTF-8,' +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">
                   <circle cx="22" cy="22" r="20" fill="#d9d9d9" stroke="#bdbdbd" stroke-width="1.5" />
                   <text x="22" y="22" text-anchor="middle" dominant-baseline="central" font-size="14" font-family="sans-serif" fill="#333">${count}</text>
                 </svg>`
              ),
            scaledSize: new google.maps.Size(44, 44),
            anchor: new google.maps.Point(22, 22),
          },
          zIndex: 1000 + count,
        }),
    },
  });
}

export function panTo(latLng, zoom) {
  map.panTo(latLng);
  if (zoom) map.setZoom(zoom);
}
