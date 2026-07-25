// ============================================================================
// place-form.js — the Add/Edit place form (admin only).
//
// Handles:
//   - Address input with live Google Places autocomplete, custom-rendered
//     (not the default widget) so we can show SPEC.md's required states:
//     "aucun lieu trouvé" (no results) and a scrollable top 4-5 suggestion
//     list (ambiguous / multiple matches).
//   - Tag selection per category, including inline "create a custom tag"
//     (emoji + name). Type de lieu / Cuisine / Spécial are multi-select
//     (click to toggle); Prix and Statut are single-select, since SPEC.md
//     describes Prix as "a dropdown/select, not a slider" and Statut as
//     strictly binary per place.
//   - The 5 review fields (top / bof / remarks / rating / comment).
//   - Selection ORDER is tracked (not just which tags are selected),
//     because "pin icon = emoji of the first Type de lieu tag added" (see
//     helpers.js pinIcon) depends on insertion order, which we control by
//     inserting place_tags rows in this order on save (see db.js).
// ============================================================================

import { TAG_CATEGORIES, GOOGLE_MAPS_KEY } from './config.js';
import { tagsByCategory, createTag, loadTags } from './tags.js';
import { createPlace, updatePlace } from './db.js';
import { getCurrentProfile } from './auth.js';

const SINGLE_SELECT_CATEGORIES = new Set(['prix', 'statut']);

const form = document.getElementById('place-form');
const formTitle = document.getElementById('place-form-title');
const addressInput = document.getElementById('place-form-address');
const addressStatus = document.getElementById('place-form-address-status');
const addressSuggestions = document.getElementById('place-form-address-suggestions');
const tagsContainer = document.getElementById('place-form-tags');

let editingPlace = null; // null = creating a new place
let selectedLocation = null; // { lat, lng, formatted_address }
let selectedTagIds = []; // ordered array of tag UUIDs, in click order
let autocompleteService = null;
let placesService = null;
let onSaved = null;

export function initPlaceForm({ onSaveComplete }) {
  onSaved = onSaveComplete;
  autocompleteService = new google.maps.places.AutocompleteService();
  // PlacesService needs a DOM node to (potentially) attach attribution to;
  // it's never actually rendered visibly.
  placesService = new google.maps.places.PlacesService(document.createElement('div'));

  addressInput.addEventListener('input', onAddressInput);
  document.getElementById('place-form-cancel').addEventListener('click', closePlaceForm);
  document.getElementById('place-form-rating-clear').addEventListener('click', () => {
    document.getElementById('place-form-rating').value = '';
  });
  form.addEventListener('submit', onSubmit);
}

function onAddressInput() {
  const value = addressInput.value.trim();
  selectedLocation = null;
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
    // SPEC.md: "scrollable list of the top 4-5 suggestions to pick from".
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
  placesService.getDetails({ placeId: prediction.place_id, fields: ['formatted_address', 'geometry', 'name'] }, (place, status) => {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !place.geometry) {
      addressStatus.textContent = 'Aucun lieu trouvé.';
      return;
    }
    selectedLocation = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      formatted_address: place.formatted_address,
    };
    addressInput.value = place.formatted_address;
    addressSuggestions.innerHTML = '';
    addressStatus.textContent = `✓ ${place.formatted_address}`;
  });
}

function toggleTag(tagId, category) {
  const isSelected = selectedTagIds.includes(tagId);
  if (SINGLE_SELECT_CATEGORIES.has(category)) {
    // Radio-like: deselect any other tag from the same category first.
    const otherIdsInCategory = tagsByCategory(category).map((t) => t.id).filter((id) => id !== tagId);
    selectedTagIds = selectedTagIds.filter((id) => !otherIdsInCategory.includes(id));
  }
  if (isSelected) {
    selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
  } else {
    selectedTagIds.push(tagId);
  }
  renderTagSection(category);
}

function renderTagSection(category) {
  const section = tagsContainer.querySelector(`[data-category="${category}"] .tag-chip-list`);
  if (!section) return;
  section.innerHTML = '';
  for (const tag of tagsByCategory(category)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip-select' + (selectedTagIds.includes(tag.id) ? ' selected' : '');
    chip.textContent = `${tag.emoji} ${tag.label}`;
    chip.addEventListener('click', () => toggleTag(tag.id, category));
    section.appendChild(chip);
  }
}

function renderTagCategories() {
  tagsContainer.innerHTML = '';
  for (const { key, label } of TAG_CATEGORIES) {
    const section = document.createElement('div');
    section.className = 'form-tag-category';
    section.dataset.category = key;
    section.innerHTML = `
      <h4>${label}${key === 'type_de_lieu' ? ' <span class="required-mark">*</span>' : ''}</h4>
      <div class="tag-chip-list"></div>
      <div class="new-tag-row">
        <input type="text" class="new-tag-emoji" placeholder="🍕" maxlength="4" />
        <input type="text" class="new-tag-label" placeholder="Nouveau tag..." />
        <button type="button" class="new-tag-add">Ajouter</button>
      </div>
    `;
    tagsContainer.appendChild(section);
    renderTagSection(key);

    const emojiInput = section.querySelector('.new-tag-emoji');
    const labelInput = section.querySelector('.new-tag-label');
    section.querySelector('.new-tag-add').addEventListener('click', async () => {
      const emoji = emojiInput.value.trim();
      const label = labelInput.value.trim();
      if (!emoji || !label) return;
      const tag = await createTag(key, emoji, label);
      emojiInput.value = '';
      labelInput.value = '';
      renderTagSection(key);
      toggleTag(tag.id, key);
    });
  }
}

async function onSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('place-form-name').value.trim();
  // Empty rating input means "not rated yet" (e.g. a place that's still
  // "à tester") — this must stay NULL in the database, not become 0.
  const ratingRaw = document.getElementById('place-form-rating').value;
  const rating = ratingRaw === '' ? null : parseFloat(ratingRaw);
  const top = document.getElementById('place-form-top').value.trim();
  const bof = document.getElementById('place-form-bof').value.trim();
  const remarks = document.getElementById('place-form-remarks').value.trim();
  const comment = document.getElementById('place-form-comment').value.trim();

  const address = editingPlace && !selectedLocation
    ? { address: editingPlace.address, lat: editingPlace.lat, lng: editingPlace.lng }
    : selectedLocation
      ? { address: selectedLocation.formatted_address, lat: selectedLocation.lat, lng: selectedLocation.lng }
      : null;

  if (!name || !address) {
    addressStatus.textContent = !address ? 'Choisis une adresse dans la liste.' : addressStatus.textContent;
    return;
  }
  if (!selectedTagIds.some((id) => tagsByCategory('type_de_lieu').some((t) => t.id === id))) {
    alert('Choisis au moins un tag "Type de lieu" (il détermine l\'icône du pin).');
    return;
  }

  const fields = { name, rating, top, bof, remarks, comment, ...address };

  if (editingPlace) {
    await updatePlace(editingPlace.id, fields, selectedTagIds);
  } else {
    await createPlace({ ...fields, created_by: getCurrentProfile()?.id ?? null }, selectedTagIds);
  }
  closePlaceForm();
  onSaved();
}

// Opens the form empty (add) or pre-filled (edit, when `place` is given).
export async function openPlaceForm(place = null) {
  await loadTags();
  editingPlace = place;
  selectedLocation = null;
  selectedTagIds = place ? place.tags.map((t) => t.id) : [];

  formTitle.textContent = place ? 'Modifier le lieu' : 'Ajouter un lieu';
  document.getElementById('place-form-name').value = place?.name ?? '';
  addressInput.value = place?.address ?? '';
  addressStatus.textContent = '';
  addressSuggestions.innerHTML = '';
  // `place.rating` can be null (not yet rated) — leave the input empty
  // rather than defaulting to 0, which would mean something different.
  document.getElementById('place-form-rating').value = place?.rating ?? '';
  document.getElementById('place-form-top').value = place?.top ?? '';
  document.getElementById('place-form-bof').value = place?.bof ?? '';
  document.getElementById('place-form-remarks').value = place?.remarks ?? '';
  document.getElementById('place-form-comment').value = place?.comment ?? '';

  renderTagCategories();
  document.getElementById('place-form-screen').classList.add('open');
}

export function closePlaceForm() {
  document.getElementById('place-form-screen').classList.remove('open');
  editingPlace = null;
}
