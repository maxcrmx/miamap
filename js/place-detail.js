// ============================================================================
// place-detail.js — la fiche lieu (bottom sheet aux 3/4 de l'écran).
//
// Réfs visuelles : reference-ui/05-fiche-a-essayer.jpeg (statut "à essayer" :
// AUCUNE note affichée) et 06-fiche-deja-teste.jpeg (statut "déjà testé" :
// étoiles affichées, éditables au clic pour l'admin).
//
// Contenu, de haut en bas :
//   - nom + adresse ;
//   - ligne statut : interrupteur (emoji dans le bouton rond) + libellé,
//     étoiles à droite si "déjà testé". L'admin peut basculer le statut
//     directement ici ; les lecteurs le voient en lecture seule ;
//   - pilules de tags colorées (mêmes styles que le panneau filtres) ;
//   - les champs d'avis (👍 / 🤷 / remarques / commentaire) ;
//   - actions : Y aller / Site web / Appeler / Modifier (réf. Mapstr).
//     Site web et téléphone sont lus depuis les colonnes `website`/`phone`
//     de la base (remplies une fois pour toutes à l'ajout/édition, voir
//     js/place-form.js) — l'ouverture d'une fiche ne fait AUCUN appel
//     Google Places. Champ vide = bouton grisé.
// ============================================================================

import { isAdmin } from './auth.js';
import { deletePlace, updatePlace } from './db.js';
import { escapeHtml } from './helpers.js';
import { tagsByCategory } from './tags.js';
import { starsHtml } from './rating-stars.js';

const sheet = document.getElementById('place-sheet');
const sheetContent = document.getElementById('place-sheet-content');

let onEdit = null;
let onDeleted = null;
let onChanged = null;

export function initPlaceDetail({ onEditRequested, onPlaceDeleted, onPlaceChanged }) {
  onEdit = onEditRequested;
  onDeleted = onPlaceDeleted;
  onChanged = onPlaceChanged;

  // Glisser vers le bas sur la poignée pour fermer.
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

// ----------------------------------------------------------------------------
// Petits helpers de rendu
// ----------------------------------------------------------------------------
function statutTag(place) {
  return place.tags.find((t) => t.category === 'statut');
}

// "Déjà testé" = un tag statut existe et ce n'est pas "À tester" (même
// convention que helpers.js isToTry).
function isTested(place) {
  const s = statutTag(place);
  return !!s && s.label !== 'À tester';
}

function tagPillsHtml(place) {
  return place.tags
    .filter((t) => t.category !== 'statut')
    .map((t) => `<span class="tag-pill cat-${t.category}">${t.emoji} ${escapeHtml(t.label)}</span>`)
    .join('');
}

function directionsUrl(place) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name + ' ' + place.address)}`;
}

function addedDateText(place) {
  if (!place.date_added) return '';
  const d = new Date(place.date_added);
  return isNaN(d) ? '' : `Ajouté le ${d.toLocaleDateString('fr-FR')}`;
}

// ----------------------------------------------------------------------------
// Ouverture / rendu de la fiche
// ----------------------------------------------------------------------------
export function openPlaceDetail(place) {
  const admin = isAdmin();
  const tested = isTested(place);
  const statut = statutTag(place);
  // Boutons Site web / Appeler : actifs seulement si l'info est en base.
  const website = place.website || '';
  const phone = place.phone || '';

  sheetContent.innerHTML = `
    <h2 class="place-title">${escapeHtml(place.name)}</h2>
    <p class="place-address">${escapeHtml(place.address)}</p>

    <div class="statut-row">
      <button type="button" id="statut-switch" class="statut-switch${tested ? ' on' : ''}" ${admin ? '' : 'disabled'}
              aria-label="Basculer le statut">
        <span class="statut-knob">${statut ? statut.emoji : '🤔'}</span>
      </button>
      <span class="statut-label">${statut ? escapeHtml(statut.label) : 'À tester'}</span>
      <span class="statut-spacer"></span>
      ${tested ? starsHtml(place.rating, { editable: admin }) : ''}
    </div>

    <div class="place-tags">${tagPillsHtml(place)}</div>

    ${place.top ? `<h4>Les 👍</h4><p class="place-field">${escapeHtml(place.top)}</p>` : ''}
    ${place.bof ? `<h4>Les 🤷</h4><p class="place-field">${escapeHtml(place.bof)}</p>` : ''}
    ${place.remarks ? `<h4>Remarques</h4><p class="place-field">${escapeHtml(place.remarks)}</p>` : ''}
    ${place.comment ? `<h4>Commentaire général</h4><p class="place-field">${escapeHtml(place.comment)}</p>` : ''}

    <p class="place-added">${addedDateText(place)}</p>

    <div class="place-actions">
      <a class="place-action" href="${directionsUrl(place)}" target="_blank" rel="noopener">
        <span class="place-action-icon">↗️</span>Y aller</a>
      <a class="place-action${website ? '' : ' disabled'}" id="place-web-btn"
         ${website ? `href="${escapeHtml(website)}"` : ''} target="_blank" rel="noopener">
        <span class="place-action-icon">🧭</span>Site web</a>
      <a class="place-action${phone ? '' : ' disabled'}" id="place-call-btn"
         ${phone ? `href="tel:${escapeHtml(phone.replace(/\s/g, ''))}"` : ''}>
        <span class="place-action-icon">📞</span>Appeler</a>
      ${admin ? `
        <button type="button" class="place-action" id="place-edit-btn">
          <span class="place-action-icon">✏️</span>Modifier</button>` : ''}
    </div>

    ${admin ? '<button type="button" id="place-delete-btn" class="link-danger">Supprimer ce lieu</button>' : ''}
  `;

  if (admin) {
    // Interrupteur de statut : bascule vers L'AUTRE tag statut (il n'y en a
    // que deux) puis sauvegarde et re-rend la fiche à jour.
    sheetContent.querySelector('#statut-switch').addEventListener('click', async () => {
      const other = tagsByCategory('statut').find((t) => t.id !== statut?.id);
      if (!other) return;
      const newTagIds = statut
        ? place.tags.map((t) => (t.id === statut.id ? other.id : t.id))
        : [...place.tags.map((t) => t.id), other.id];
      const fresh = await updatePlace(place.id, { name: place.name }, newTagIds);
      openPlaceDetail(fresh);
      onChanged && onChanged();
    });

    // Étoiles éditables : cliquer la n-ième étoile met la note à n.
    sheetContent.querySelectorAll('.stars:not(.readonly) .star').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rating = Number(btn.dataset.value);
        const fresh = await updatePlace(place.id, { rating }, place.tags.map((t) => t.id));
        openPlaceDetail(fresh);
        onChanged && onChanged();
      });
    });

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
