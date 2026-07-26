// ============================================================================
// place-form.js — le formulaire d'ajout/édition de lieu (admin uniquement).
//
// Réfs visuelles : reference-ui/03-ajout-lieu.jpeg (un SEUL champ de
// recherche, pas d'onglets par nom/adresse/coordonnées) et
// reference-ui/04-fiche-edition.jpeg (pilules de tags colorées avec croix,
// bouton "+ Créer un nouveau tag", statut en deux boutons toggle).
//
// Ce que gère ce fichier :
//   - La recherche unique Google Places : taper un nom OU une adresse
//     propose jusqu'à 5 suggestions ("aucun lieu trouvé" sinon, exigences
//     SPEC.md). Choisir une suggestion remplit la carte "lieu sélectionné"
//     (nom modifiable + adresse géocodée).
//   - La sélection de tags par catégorie : pilule grise = disponible (clic
//     pour ajouter), pilule colorée avec ✕ = sélectionnée (clic pour
//     retirer). Création d'un tag perso via "+ Créer un nouveau tag".
//   - Le statut (À tester / Déjà testé) en deux gros boutons toggle,
//     exclusifs l'un de l'autre.
//   - Les champs d'avis (top / bof / remarques / note / commentaire).
//   - L'ORDRE de sélection des tags est conservé (pas seulement lesquels) :
//     "icône du pin = emoji du PREMIER tag Type de lieu ajouté" (voir
//     helpers.js pinIcon) dépend de l'ordre d'insertion en base (db.js).
// ============================================================================

import { TAG_CATEGORIES } from './config.js';
import { tagsByCategory, createTag, loadTags } from './tags.js';
import { createPlace, updatePlace } from './db.js';
import { getCurrentProfile } from './auth.js';
import { escapeHtml } from './helpers.js';
import { starButtonsHtml, attachStarInput } from './rating-stars.js';

// Prix reste mono-sélection (un lieu a UNE fourchette de prix) ; le statut
// aussi, mais il est rendu à part (boutons toggle, pas nuage de pilules).
const SINGLE_SELECT_CATEGORIES = new Set(['prix', 'statut']);

const form = document.getElementById('place-form');
const formTitle = document.getElementById('place-form-title');
const searchInput = document.getElementById('place-form-search');
const addressStatus = document.getElementById('place-form-address-status');
const addressSuggestions = document.getElementById('place-form-address-suggestions');
const selectedCard = document.getElementById('place-form-selected');
const selectedAddressEl = document.getElementById('place-form-selected-address');
const nameInput = document.getElementById('place-form-name');
const tagsContainer = document.getElementById('place-form-tags');
const statutContainer = document.getElementById('place-form-statut');
const ratingBlock = document.getElementById('place-form-rating-block');
const ratingInput = document.getElementById('place-form-rating'); // input caché : la valeur numérique
const starsEl = document.getElementById('place-form-stars');
const ratingValueEl = document.getElementById('place-form-rating-value');

let editingPlace = null; // null = création d'un nouveau lieu
let selectedLocation = null; // { lat, lng, formatted_address }
let selectedTagIds = []; // tableau ordonné d'UUID de tags, dans l'ordre des clics
let autocompleteService = null;
let placesService = null;
let onSaved = null;

export function initPlaceForm({ onSaveComplete }) {
  onSaved = onSaveComplete;
  autocompleteService = new google.maps.places.AutocompleteService();
  // PlacesService exige un nœud DOM (pour une éventuelle attribution) ;
  // il n'est jamais affiché.
  placesService = new google.maps.places.PlacesService(document.createElement('div'));

  searchInput.addEventListener('input', onSearchInput);

  // Étoiles : clic + glisser. Attaché UNE seule fois ici (pas à chaque
  // ouverture du formulaire) — voir attachStarInput pour pourquoi.
  attachStarInput(starsEl, setRating);
  document.getElementById('place-form-rating-clear').addEventListener('click', () => setRating(null));

  form.addEventListener('submit', onSubmit);
}

// ----------------------------------------------------------------------------
// Note : état + affichage
// ----------------------------------------------------------------------------
// `value` : nombre de 0 à 5 (pas de 0,5) ou null pour "pas de note".
function setRating(value) {
  ratingInput.value = value === null ? '' : String(value);
  starsEl.innerHTML = starButtonsHtml(value);
  ratingValueEl.textContent = value === null ? '' : `${value}/5`;
}

function currentRating() {
  return ratingInput.value === '' ? null : parseFloat(ratingInput.value);
}

// Le tag de statut actuellement sélectionné (il n'y en a qu'un à la fois).
function selectedStatutTag() {
  return tagsByCategory('statut').find((t) => selectedTagIds.includes(t.id));
}

// "Déjà testé" = un statut est choisi et ce n'est pas "À tester" (même
// convention que helpers.js isToTry).
function isTestedSelected() {
  const s = selectedStatutTag();
  return !!s && s.label !== 'À tester';
}

// Le bloc note n'existe que pour un lieu déjà testé. Repasser à "À tester"
// efface la note : un lieu pas encore testé ne peut pas avoir d'avis chiffré,
// et c'est ce que la fiche lieu suppose (écran 5 : aucune note affichée).
function updateRatingVisibility() {
  const tested = isTestedSelected();
  ratingBlock.classList.toggle('hidden', !tested);
  if (!tested && currentRating() !== null) setRating(null);
}

// ----------------------------------------------------------------------------
// Recherche unique Google Places (nom OU adresse dans le même champ)
// ----------------------------------------------------------------------------
function onSearchInput() {
  const value = searchInput.value.trim();
  if (value.length < 3) {
    addressSuggestions.innerHTML = '';
    addressStatus.textContent = '';
    return;
  }
  autocompleteService.getPlacePredictions({ input: value }, (predictions, status) => {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) {
      addressSuggestions.innerHTML = '';
      addressStatus.textContent = 'Aucun lieu trouvé.';
      return;
    }
    addressStatus.textContent = '';
    // SPEC.md : "liste déroulante des 4-5 meilleures suggestions".
    renderSuggestions(predictions.slice(0, 5));
  });
}

function renderSuggestions(predictions) {
  addressSuggestions.innerHTML = '';
  for (const p of predictions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'address-suggestion';
    item.textContent = p.description;
    item.addEventListener('click', () => selectPrediction(p));
    addressSuggestions.appendChild(item);
  }
}

function selectPrediction(prediction) {
  // website + formatted_phone_number : récupérés ICI, une seule fois, puis
  // stockés en base à la sauvegarde. La fiche lieu les lit directement —
  // plus aucun appel Google Places à l'ouverture d'une fiche.
  placesService.getDetails(
    { placeId: prediction.place_id, fields: ['formatted_address', 'geometry', 'name', 'website', 'formatted_phone_number'] },
    (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place.geometry) {
        addressStatus.textContent = 'Aucun lieu trouvé.';
        return;
      }
      selectedLocation = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        formatted_address: place.formatted_address,
        // Chaîne vide si Google ne les connaît pas : la fiche grisera alors
        // le bouton Site web / Appeler correspondant.
        website: place.website || '',
        phone: place.formatted_phone_number || '',
      };
      // Le nom Google pré-remplit le champ nom (modifiable ensuite) — c'est
      // ce qui permet de n'avoir qu'un seul champ de recherche.
      nameInput.value = place.name || nameInput.value;
      showSelectedCard(place.formatted_address);
      searchInput.value = '';
      addressSuggestions.innerHTML = '';
      addressStatus.textContent = '';
    }
  );
}

function showSelectedCard(address) {
  selectedAddressEl.textContent = address;
  selectedCard.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// Tags : pilules par catégorie + création de tag perso
// ----------------------------------------------------------------------------
function toggleTag(tagId, category) {
  const isSelected = selectedTagIds.includes(tagId);
  if (SINGLE_SELECT_CATEGORIES.has(category)) {
    // Comportement radio : on retire d'abord tout autre tag de la catégorie.
    const otherIdsInCategory = tagsByCategory(category).map((t) => t.id).filter((id) => id !== tagId);
    selectedTagIds = selectedTagIds.filter((id) => !otherIdsInCategory.includes(id));
  }
  if (isSelected) {
    selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
  } else {
    selectedTagIds.push(tagId);
  }
  if (category === 'statut') renderStatutToggles();
  else renderTagSection(category);
}

// Pilules d'une catégorie : sélectionnées en couleur avec ✕ d'abord, puis
// les disponibles en gris (réf. 04 : "sélecteur de tags disponibles en
// dessous, gris, clic pour ajouter").
function renderTagSection(category) {
  const section = tagsContainer.querySelector(`[data-category="${category}"] .tag-chip-list`);
  if (!section) return;
  section.innerHTML = '';
  const all = tagsByCategory(category);
  const selectedFirst = [
    ...all.filter((t) => selectedTagIds.includes(t.id)),
    ...all.filter((t) => !selectedTagIds.includes(t.id)),
  ];
  for (const tag of selectedFirst) {
    const isSelected = selectedTagIds.includes(tag.id);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `tag-pill cat-${category}` + (isSelected ? '' : ' dimmed');
    pill.innerHTML =
      `<span>${tag.emoji} ${escapeHtml(tag.label)}</span>` +
      (isSelected ? '<span class="pill-x">✕</span>' : '');
    pill.addEventListener('click', () => toggleTag(tag.id, category));
    section.appendChild(pill);
  }
}

function renderTagCategories() {
  tagsContainer.innerHTML = '';
  // Le statut n'apparaît pas dans le nuage de tags : il a sa propre section
  // de boutons toggle (voir renderStatutToggles).
  for (const { key, label } of TAG_CATEGORIES.filter((c) => c.key !== 'statut')) {
    const section = document.createElement('div');
    section.className = 'form-tag-category';
    section.dataset.category = key;
    section.innerHTML = `
      <h4>${label}${key === 'type_de_lieu' ? ' <span class="required-mark">*</span>' : ''}</h4>
      <div class="tag-chip-list"></div>
      <button type="button" class="new-tag-toggle">+ Créer un nouveau tag</button>
      <div class="new-tag-row hidden">
        <input type="text" class="new-tag-emoji" placeholder="🍕" maxlength="4" />
        <input type="text" class="new-tag-label" placeholder="Nouveau tag..." />
        <button type="button" class="new-tag-add">Ajouter</button>
      </div>
    `;
    tagsContainer.appendChild(section);
    renderTagSection(key);

    // "+ Créer un nouveau tag" révèle la ligne emoji + nom (réf. 04).
    const newTagRow = section.querySelector('.new-tag-row');
    section.querySelector('.new-tag-toggle').addEventListener('click', () => {
      newTagRow.classList.toggle('hidden');
      if (!newTagRow.classList.contains('hidden')) section.querySelector('.new-tag-emoji').focus();
    });

    const emojiInput = section.querySelector('.new-tag-emoji');
    const labelInput = section.querySelector('.new-tag-label');
    section.querySelector('.new-tag-add').addEventListener('click', async () => {
      const emoji = emojiInput.value.trim();
      const label = labelInput.value.trim();
      if (!emoji || !label) return;
      const tag = await createTag(key, emoji, label);
      emojiInput.value = '';
      labelInput.value = '';
      newTagRow.classList.add('hidden');
      renderTagSection(key);
      toggleTag(tag.id, key); // le tag créé est sélectionné directement
    });
  }
}

// Statut : deux gros boutons toggle exclusifs (réf. 04 "Choisissez le
// statut du lieu"). Les deux tags viennent de la catégorie `statut` en base.
function renderStatutToggles() {
  statutContainer.innerHTML = '';
  for (const tag of tagsByCategory('statut')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'statut-toggle' + (selectedTagIds.includes(tag.id) ? ' selected' : '');
    btn.textContent = `${tag.emoji} ${tag.label}`;
    btn.addEventListener('click', () => toggleTag(tag.id, 'statut'));
    statutContainer.appendChild(btn);
  }
  // Le statut pilote l'affichage du bloc note.
  updateRatingVisibility();
}

// ----------------------------------------------------------------------------
// Enregistrement
// ----------------------------------------------------------------------------
async function onSubmit(e) {
  e.preventDefault();

  const name = nameInput.value.trim();
  // Pas de note = "pas encore noté" (lieu "à tester") — doit rester NULL en
  // base, surtout pas devenir 0.
  const rating = currentRating();
  const top = document.getElementById('place-form-top').value.trim();
  const bof = document.getElementById('place-form-bof').value.trim();
  const remarks = document.getElementById('place-form-remarks').value.trim();
  const comment = document.getElementById('place-form-comment').value.trim();

  // En édition sans nouvelle recherche, on garde l'adresse ET le site
  // web/téléphone existants. Re-chercher le lieu dans le champ du haut est
  // ce qui permet de RAFRAÎCHIR website/phone (nouvelle réponse Google).
  const address = selectedLocation
    ? { address: selectedLocation.formatted_address, lat: selectedLocation.lat, lng: selectedLocation.lng,
        website: selectedLocation.website, phone: selectedLocation.phone }
    : editingPlace
      ? { address: editingPlace.address, lat: editingPlace.lat, lng: editingPlace.lng,
          website: editingPlace.website ?? '', phone: editingPlace.phone ?? '' }
      : null;

  if (!address) {
    addressStatus.textContent = 'Recherche le lieu ci-dessus et choisis-le dans la liste.';
    return;
  }
  if (!name) {
    nameInput.focus();
    return;
  }
  if (!selectedTagIds.some((id) => tagsByCategory('type_de_lieu').some((t) => t.id === id))) {
    alert('Choisis au moins un tag "Type de lieu" (il détermine l\'icône du pin).');
    return;
  }

  const fields = { name, rating, top, bof, remarks, comment, ...address };

  // Bouton désactivé pendant l'écriture : un double-tap créerait deux lieux.
  const saveBtn = form.querySelector('.btn-save');
  saveBtn.disabled = true;
  const previousLabel = saveBtn.textContent;
  saveBtn.textContent = 'Enregistrement…';

  try {
    if (editingPlace) {
      await updatePlace(editingPlace.id, fields, selectedTagIds);
    } else {
      await createPlace({ ...fields, created_by: getCurrentProfile()?.id ?? null }, selectedTagIds);
    }
    // ATTENDRE le rechargement AVANT de fermer. Sans ce `await`, le
    // formulaire se refermait immédiatement et les vues restaient affichées
    // avec l'ancien jeu de données le temps de l'aller-retour réseau : le
    // lieu tout juste ajouté semblait absent de la vue liste (bug constaté
    // en local, invisible en test tant que la base répondait instantanément).
    await onSaved();
  } catch (err) {
    console.error('[place-form] Enregistrement en échec :', err);
    alert("L'enregistrement a échoué : " + (err?.message ?? err));
    return; // formulaire laissé ouvert, la saisie n'est pas perdue
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = previousLabel;
  }

  closePlaceForm();
}

// Ouvre le formulaire vide (ajout) ou pré-rempli (édition, si `place` fourni).
export async function openPlaceForm(place = null) {
  await loadTags();
  editingPlace = place;
  selectedLocation = null;
  selectedTagIds = place ? place.tags.map((t) => t.id) : [];

  formTitle.textContent = place ? 'Modifier' : 'Enregistrer un lieu';
  nameInput.value = place?.name ?? '';
  searchInput.value = '';
  addressStatus.textContent = '';
  addressSuggestions.innerHTML = '';

  // En édition, la carte "lieu sélectionné" montre le lieu existant ; en
  // ajout elle reste cachée tant que rien n'est choisi dans la recherche.
  if (place) showSelectedCard(place.address);
  else selectedCard.classList.add('hidden');

  // `place.rating` peut être null (pas encore noté) — aucune étoile allumée
  // plutôt que 0, qui voudrait dire autre chose. `renderStatutToggles()`
  // plus bas décide si le bloc note est visible du tout.
  setRating(place?.rating ?? null);
  document.getElementById('place-form-top').value = place?.top ?? '';
  document.getElementById('place-form-bof').value = place?.bof ?? '';
  document.getElementById('place-form-remarks').value = place?.remarks ?? '';
  document.getElementById('place-form-comment').value = place?.comment ?? '';

  renderTagCategories();
  renderStatutToggles();
  document.getElementById('place-form-screen').classList.add('open');
}

export function closePlaceForm() {
  document.getElementById('place-form-screen').classList.remove('open');
  editingPlace = null;
}
