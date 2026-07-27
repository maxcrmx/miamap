// ============================================================================
// map.js — Google Map rendering: pins (custom SVG icon), clustering, and
// wiring pin/cluster clicks back into the rest of the app.
//
// Pin design:
//   - un cercle gris clair, avec au centre l'émoji du type de lieu
//     (helpers.js pinIcon : l'émoji du PREMIER tag "Type de lieu" ajouté au
//     lieu, même si plusieurs sont sélectionnés — jamais un mélange)
//   - un petit badge en haut à droite si le lieu est "à tester"
// Les clusters (dézoom, pins proches) reprennent exactement le même cercle,
// en plus grand, avec le nombre de lieux agrégés au centre et AUCUN émoji
// (ils agrègent des lieux de types différents) — d'où les constantes
// CIRCLE_* partagées ci-dessous : pin et cluster ne peuvent pas diverger
// visuellement. Le clustering vient de @googlemaps/markerclusterer (chargé
// par <script> CDN dans index.html, même approche « sans bundler » que le
// reste de l'app).
// ============================================================================

import { isToTry, pinIcon } from './helpers.js';

let map = null;
let markers = new Map(); // place id -> google.maps.Marker
let clusterer = null;
let onPinClick = null;

// Diamètre visuel du cercle, et taille de la boîte SVG qui le contient.
// La boîte est plus grande que le cercle pour laisser la place à l'ombre
// portée (sans marge, l'ombre serait rognée au bord du SVG).
const PIN_CIRCLE = 40;
const PIN_BOX = 50;
const CLUSTER_SIZE = 44;

// Couleurs des PINS — identité "Carnet" : crème avec un contour taupe assez
// soutenu pour détacher le pin des routes claires et des bâtiments du fond
// de carte Google. C'est le contour qui porte la lisibilité — le fond, lui,
// reste proche de la surface crème du reste de l'app.
const PIN_FILL = '#FBF8F1';
const PIN_STROKE = '#B4AC94';

// Couleurs des CLUSTERS : gris clair neutre avec texte noir, assorti au
// style pilule utilisé ailleurs dans l'app (pins/tags), plutôt qu'un
// cercle sombre qui détonnait.
const CLUSTER_FILL = '#D9D5C9';
const CLUSTER_STROKE = '#B4AC94';

// Couleur du badge "à tester" : jaune Mapstr d'origine (clin d'œil aux
// racines de l'app — voir SPEC.md/captures de référence). Les lieux "déjà
// testé" n'ont pas de badge du tout — seuls les lieux à tester en ont un,
// pour attirer l'œil sur ce qu'il reste à visiter.
const BADGE_TO_TRY = '#FFC72C';

const CIRCLE_STROKE_WIDTH = 1.5;

// Rayon du cercle dans une boîte de `size`, en laissant la place au trait.
function circleRadius(size) {
  return size / 2 - CIRCLE_STROKE_WIDTH / 2 - 1;
}

function circleSvg(size, fill, stroke) {
  const c = size / 2;
  return `<circle cx="${c}" cy="${c}" r="${circleRadius(size)}" fill="${fill}"` +
         ` stroke="${stroke}" stroke-width="${CIRCLE_STROKE_WIDTH}" />`;
}

function svgDataUrl(svg) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Les émojis de tags sont saisis à la main (formulaire « créer un tag ») :
// on échappe avant de les injecter dans le SVG, sinon un caractère comme
// & ou < produirait un XML invalide et un pin qui ne s'affiche pas du tout.
function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Icône d'un pin individuel : cercle quasi blanc, émoji du type de lieu au
// centre, badge "à tester", et une ombre portée douce.
//
// L'ombre n'est pas décorative : le fond du pin (#f5f5f5) et le fond de
// carte clair de Google (routes blanches, bâtiments ~#f6f5f5) ont un
// contraste mesuré de 1.00:1 — le corps du pin est indistinguable. Assombrir
// le contour serait l'autre solution, mais elle va contre le rendu clair
// voulu. L'ombre crée la séparation en gardant le pin quasi blanc.
//
// L'ombre est posée sur un cercle SÉPARÉ, sans trait, juste en dessous du
// cercle visible : lui appliquer le filtre flou DIRECTEMENT sur le cercle
// tracé (fill + stroke) adoucit aussi le bord du trait, qui paraît alors
// plus épais que celui — non flouté — des pins de cluster. Avec deux
// cercles superposés, le trait visible reste net et fait exactement
// CIRCLE_STROKE_WIDTH, comme pour les clusters.
function buildPinSvg(place) {
  const c = PIN_BOX / 2;
  const r = circleRadius(PIN_CIRCLE);
  // Centre du badge posé EXACTEMENT sur le bord du cercle du pin (diagonale
  // haut-droite à 45°) : la moitié du badge chevauche l'intérieur du pin,
  // l'autre moitié déborde à l'extérieur — le classique point de
  // notification, plutôt qu'un badge flottant à côté du pin.
  const badgeOffset = r / Math.SQRT2;
  const badge = isToTry(place)
    ? `<circle cx="${c + badgeOffset}" cy="${c - badgeOffset}" r="6" fill="${BADGE_TO_TRY}" stroke="#fff" stroke-width="1.5" />`
    : '';
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${PIN_BOX}" height="${PIN_BOX}" viewBox="0 0 ${PIN_BOX} ${PIN_BOX}">
      <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.7" />
      </filter>
      <circle cx="${c}" cy="${c}" r="${r}" fill="${PIN_FILL}" filter="url(#s)" />
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PIN_STROKE}" stroke-width="${CIRCLE_STROKE_WIDTH}" />
      <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-size="20">${escapeXml(pinIcon(place))}</text>
      ${badge}
    </svg>
  `);
}

// Icône d'un cluster : le même cercle, en plus grand, avec le compte.
function buildClusterSvg(count) {
  const c = CLUSTER_SIZE / 2;
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${CLUSTER_SIZE}" height="${CLUSTER_SIZE}" viewBox="0 0 ${CLUSTER_SIZE} ${CLUSTER_SIZE}">
      ${circleSvg(CLUSTER_SIZE, CLUSTER_FILL, CLUSTER_STROKE)}
      <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-size="14" font-family="sans-serif" fill="#000">${count}</text>
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
        scaledSize: new google.maps.Size(PIN_BOX, PIN_BOX),
        anchor: new google.maps.Point(PIN_BOX / 2, PIN_BOX / 2),
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
