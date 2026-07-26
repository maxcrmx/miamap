// ============================================================================
// map.js — Google Map rendering: pins (custom SVG icon), clustering, and
// wiring pin/cluster clicks back into the rest of the app.
//
// Pin design:
//   - un simple cercle gris clair, SANS icône ni tranches colorées
//   - un petit badge en haut à droite si le lieu est "à tester"
// Les clusters (dézoom, pins proches) reprennent exactement le même cercle,
// en plus grand et avec le nombre de lieux agrégés au centre — d'où les
// constantes CIRCLE_* partagées ci-dessous : pin et cluster ne peuvent pas
// diverger visuellement. Le clustering vient de @googlemaps/markerclusterer
// (chargé par <script> CDN dans index.html, même approche « sans bundler »
// que le reste de l'app).
// ============================================================================

import { isToTry } from './helpers.js';

let map = null;
let markers = new Map(); // place id -> google.maps.Marker
let clusterer = null;
let onPinClick = null;

const PIN_SIZE = 40;
const CLUSTER_SIZE = 44;

// Style de cercle commun aux pins et aux clusters.
const CIRCLE_FILL = '#d9d9d9';
const CIRCLE_STROKE = '#bdbdbd';
const CIRCLE_STROKE_WIDTH = 1.5;

// Rayon du cercle dans une boîte de `size`, en laissant la place au trait.
function circleRadius(size) {
  return size / 2 - CIRCLE_STROKE_WIDTH / 2 - 1;
}

function circleSvg(size) {
  const c = size / 2;
  return `<circle cx="${c}" cy="${c}" r="${circleRadius(size)}" fill="${CIRCLE_FILL}"` +
         ` stroke="${CIRCLE_STROKE}" stroke-width="${CIRCLE_STROKE_WIDTH}" />`;
}

function svgDataUrl(svg) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Icône d'un pin individuel : le cercle gris, plus le badge "à tester".
// Toujours généré par lieu (et non partagé) parce que le badge dépend du
// statut du lieu.
function buildPinSvg(place) {
  const badge = isToTry(place)
    ? `<circle cx="${PIN_SIZE - 6}" cy="6" r="6" fill="#1a73e8" stroke="#fff" stroke-width="1.5" />`
    : '';
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 ${PIN_SIZE} ${PIN_SIZE}">
      ${circleSvg(PIN_SIZE)}
      ${badge}
    </svg>
  `);
}

// Icône d'un cluster : le même cercle, en plus grand, avec le compte.
function buildClusterSvg(count) {
  const c = CLUSTER_SIZE / 2;
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${CLUSTER_SIZE}" height="${CLUSTER_SIZE}" viewBox="0 0 ${CLUSTER_SIZE} ${CLUSTER_SIZE}">
      ${circleSvg(CLUSTER_SIZE)}
      <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-size="14" font-family="sans-serif" fill="#333">${count}</text>
    </svg>
  `);
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

  // markerClusterer.MarkerClusterer est le global exposé par le build CDN.
  // Rendu personnalisé : le même cercle gris que les pins, avec le compte.
  clusterer = new markerClusterer.MarkerClusterer({
    map,
    markers: newMarkers,
    renderer: {
      render: ({ count, position }) =>
        new google.maps.Marker({
          position,
          icon: {
            url: buildClusterSvg(count),
            scaledSize: new google.maps.Size(CLUSTER_SIZE, CLUSTER_SIZE),
            anchor: new google.maps.Point(CLUSTER_SIZE / 2, CLUSTER_SIZE / 2),
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
