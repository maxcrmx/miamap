// ============================================================================
// filters.js — the filter side panel: renders tag checkboxes grouped by
// category + the rating range slider, and applies the fixed filter logic
// described in SPEC.md "Filtering logic":
//   - within a category: OR  (any selected tag in that category matches)
//   - across categories: AND (every category with a selection must match)
//   - name search is separate, applied on top of category filters
// ============================================================================

import { TAG_CATEGORIES } from './config.js';
import { tagsByCategory, updateTag, deleteTag } from './tags.js';
import { isAdmin } from './auth.js';

// Current filter state, exported so map.js/list-view.js callers can read it
// directly after a change event if needed.
export const filterState = {
  categories: Object.fromEntries(TAG_CATEGORIES.map((c) => [c.key, new Set()])),
  ratingMin: 0,
  ratingMax: 5,
};

export let searchText = '';

export function setSearchText(text) {
  searchText = text.trim().toLowerCase();
}

// Returns true if `place` matches the current filterState + searchText.
export function placeMatchesFilters(place) {
  if (searchText && !place.name.toLowerCase().includes(searchText)) return false;

  // Unrated places (rating === null, typically "à tester" places not yet
  // visited) always pass the rating filter — a range like 3-5 is about
  // filtering *known* ratings, not about excluding places with no rating
  // yet. The default 0-5 range is a no-op filter either way.
  if (place.rating !== null && (place.rating < filterState.ratingMin || place.rating > filterState.ratingMax)) return false;

  for (const { key } of TAG_CATEGORIES) {
    const selected = filterState.categories[key];
    if (selected.size === 0) continue; // no filter applied for this category
    const placeTagIdsInCategory = place.tags.filter((t) => t.category === key).map((t) => t.id);
    const matchesAny = placeTagIdsInCategory.some((id) => selected.has(id));
    if (!matchesAny) return false; // AND across categories: this category failed
  }
  return true;
}

export function applyFilters(places) {
  return places.filter(placeMatchesFilters);
}

// Dessine le panneau de filtres dans `root` et appelle `onChange()` (sans
// argument — les appelants relisent filterState/searchText) à chaque
// changement.
//
// Style des tags (réf. reference-ui/02-filtres.jpeg + pilules de
// 04-fiche-edition.jpeg) : pilules colorées par catégorie. Comportement au
// clic demandé :
//   - aucune sélection dans la catégorie → toutes les pilules en couleur ;
//   - dès qu'un tag est sélectionné → lui reste coloré (avec une croix ✕
//     pour le retirer), les autres de la MÊME catégorie passent en gris
//     tant qu'ils ne sont pas sélectionnés à leur tour.
//
// `onTagsChanged` (optionnel) est appelé quand un tag a été renommé ou
// supprimé depuis le panneau (appui long sur une pilule, admin uniquement) :
// l'appelant doit recharger les tags et les lieux, puis redessiner le
// panneau — voir js/app.js.
export function renderFilterPanel(root, onChange, onTagsChanged = null) {
  root.innerHTML = '';
  closeTagMenu();

  for (const { key, label } of TAG_CATEGORIES) {
    const section = document.createElement('div');
    section.className = 'filter-section';

    const heading = document.createElement('h3');
    heading.textContent = label;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'filter-tag-list';

    // Redessine uniquement les pilules de CETTE catégorie (l'état
    // sélectionné/grisé de chaque pilule dépend des autres de la catégorie).
    const redrawPills = () => {
      list.innerHTML = '';
      const selected = filterState.categories[key];
      for (const tag of tagsByCategory(key)) {
        const isSelected = selected.has(tag.id);
        const pill = document.createElement('button');
        pill.type = 'button';
        // .dimmed = gris : seulement si un AUTRE tag de la catégorie est
        // sélectionné et pas celui-ci.
        pill.className =
          `tag-pill cat-${key}` + (!isSelected && selected.size > 0 ? ' dimmed' : '');
        pill.innerHTML =
          `<span>${tag.emoji} ${escapeText(tag.label)}</span>` +
          (isSelected ? '<span class="pill-x">✕</span>' : '');
        // Appui long (admin) : mini menu Modifier / Supprimer. `wasLongPress`
        // dit si le clic qui suit vient de conclure un appui long — dans ce
        // cas il ne doit PAS aussi (dé)sélectionner le filtre.
        const wasLongPress =
          onTagsChanged && isAdmin()
            ? attachLongPress(pill, (x, y) => openTagMenu(tag, x, y, onTagsChanged))
            : () => false;

        pill.addEventListener('click', () => {
          if (wasLongPress()) return;
          if (isSelected) selected.delete(tag.id);
          else selected.add(tag.id);
          redrawPills();
          onChange();
        });
        list.appendChild(pill);
      }
    };
    redrawPills();

    section.appendChild(list);
    root.appendChild(section);

    // Le slider de note s'insère après "Prix", avant "Statut" (ordre SPEC.md).
    if (key === 'prix') {
      root.appendChild(buildRatingSlider(onChange));
    }
  }
}

// Mini-échappement pour injecter un label dans du innerHTML sans risque.
function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ----------------------------------------------------------------------------
// Appui long sur une pilule → menu Modifier / Supprimer (admin uniquement)
// ----------------------------------------------------------------------------

const LONG_PRESS_MS = 500;
// Au-delà de ce déplacement, l'appui est considéré comme un scroll du
// panneau, pas comme un appui long.
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

// Branche la détection d'appui long (tactile + souris) sur `el` et appelle
// `handler(x, y)` avec les coordonnées écran du point d'appui. Renvoie une
// fonction qui dit si le dernier appui était un appui long, pour que le
// handler de `click` (déclenché juste après le touchend/mouseup) puisse
// s'abstenir.
function attachLongPress(el, handler) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const start = (x, y) => {
    cancel();
    fired = false;
    startX = x;
    startY = y;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      handler(x, y);
    }, LONG_PRESS_MS);
  };

  const moved = (x, y) => {
    if (Math.hypot(x - startX, y - startY) > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
  };

  el.addEventListener('touchstart', (e) => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  el.addEventListener('touchmove', (e) => moved(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);

  el.addEventListener('mousedown', (e) => {
    if (e.button === 0) start(e.clientX, e.clientY);
  });
  el.addEventListener('mousemove', (e) => {
    if (timer) moved(e.clientX, e.clientY);
  });
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);

  // Sur desktop, l'appui long de la souris n'ouvre pas de menu natif, mais
  // sur mobile un appui maintenu déclenche le menu contextuel du navigateur
  // (copier / partager…) : on le neutralise sur les pilules.
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => fired;
}

let openMenuEl = null;

function closeTagMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  window.removeEventListener('scroll', closeTagMenu, true);
}

function onDocPointerDown(e) {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeTagMenu();
}

// Menu contextuel positionné près du point d'appui. `position: fixed` (via
// .tag-menu) : les coordonnées sont donc celles du viewport, celles que
// donnent déjà les events tactiles/souris.
function openTagMenu(tag, x, y, onTagsChanged) {
  closeTagMenu();

  const menu = document.createElement('div');
  menu.className = 'tag-menu';
  menu.innerHTML = `
    <button type="button" data-action="edit">✏️ Modifier</button>
    <button type="button" data-action="delete">🗑️ Supprimer</button>
  `;
  // Posé hors écran le temps de le mesurer, pour éviter un flash au mauvais
  // endroit avant que left/top ne soient calculés.
  menu.style.left = '-9999px';
  menu.style.top = '0';
  document.body.appendChild(menu);
  openMenuEl = menu;

  // Placement : sous le doigt, recadré pour rester entièrement visible.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8);
  const top = y + 12 + rect.height > window.innerHeight ? y - 12 - rect.height : y + 12;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
    closeTagMenu();
    openTagEditModal(tag, onTagsChanged);
  });
  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    closeTagMenu();
    if (!confirm('Supprimer ce tag ? Il sera retiré de tous les lieux.')) return;
    try {
      await deleteTag(tag.id);
    } catch (err) {
      alert('La suppression a échoué : ' + (err?.message ?? err));
      return;
    }
    // Le tag disparaît de la base : il ne doit plus filtrer quoi que ce soit.
    filterState.categories[tag.category]?.delete(tag.id);
    onTagsChanged();
  });

  // Le menu se ferme au premier clic/tap ailleurs. En capture, et posé au
  // prochain tick pour ne pas intercepter l'événement en cours.
  setTimeout(() => {
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('scroll', closeTagMenu, true);
  }, 0);
}

// Petite modale émoji + nom. Créée à la volée (pas de markup dans
// index.html) : elle n'existe que le temps d'une édition.
function openTagEditModal(tag, onTagsChanged) {
  const overlay = document.createElement('div');
  overlay.className = 'tag-modal-overlay';
  overlay.innerHTML = `
    <div class="tag-modal" role="dialog" aria-label="Modifier le tag">
      <h3>Modifier le tag</h3>
      <div class="tag-modal-row">
        <input type="text" class="tag-modal-emoji" maxlength="4" value="${escapeText(tag.emoji)}" aria-label="Émoji" />
        <input type="text" class="tag-modal-label" value="${escapeText(tag.label)}" aria-label="Nom du tag" />
      </div>
      <p class="tag-modal-error error-text hidden"></p>
      <div class="tag-modal-actions">
        <button type="button" class="btn-secondary" data-action="cancel">Annuler</button>
        <button type="button" class="btn-primary" data-action="save">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const emojiInput = overlay.querySelector('.tag-modal-emoji');
  const labelInput = overlay.querySelector('.tag-modal-label');
  const errorEl = overlay.querySelector('.tag-modal-error');
  const saveBtn = overlay.querySelector('[data-action="save"]');
  const close = () => overlay.remove();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

  const save = async () => {
    const emoji = emojiInput.value.trim();
    const label = labelInput.value.trim();
    if (!emoji || !label) {
      errorEl.textContent = 'Émoji et nom sont obligatoires.';
      errorEl.classList.remove('hidden');
      return;
    }
    saveBtn.disabled = true;
    try {
      await updateTag(tag.id, emoji, label);
    } catch (err) {
      // Cas courant : contrainte unique (category, label) — un tag de la
      // même catégorie porte déjà ce nom.
      errorEl.textContent = 'Échec : ' + (err?.message ?? err);
      errorEl.classList.remove('hidden');
      saveBtn.disabled = false;
      return;
    }
    close();
    onTagsChanged();
  };

  saveBtn.addEventListener('click', save);
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  labelInput.focus();
  labelInput.select();
}

function buildRatingSlider(onChange) {
  const section = document.createElement('div');
  section.className = 'filter-section';
  section.innerHTML = `
    <h3>Note</h3>
    <div class="rating-slider">
      <div class="rating-slider-track"></div>
      <div class="rating-slider-range"></div>
      <input type="range" class="rating-min" min="0" max="5" step="0.5" value="0" />
      <input type="range" class="rating-max" min="0" max="5" step="0.5" value="5" />
    </div>
    <div class="rating-slider-labels"><span class="rl-min">0</span> – <span class="rl-max">5</span> ⭐️</div>
  `;

  const minInput = section.querySelector('.rating-min');
  const maxInput = section.querySelector('.rating-max');
  const range = section.querySelector('.rating-slider-range');
  const rlMin = section.querySelector('.rl-min');
  const rlMax = section.querySelector('.rl-max');

  function redraw() {
    let min = parseFloat(minInput.value);
    let max = parseFloat(maxInput.value);
    if (min > max) {
      // Keep the two handles from crossing past each other.
      [min, max] = [max, min];
    }
    filterState.ratingMin = min;
    filterState.ratingMax = max;
    rlMin.textContent = min;
    rlMax.textContent = max;
    range.style.left = `${(min / 5) * 100}%`;
    range.style.right = `${100 - (max / 5) * 100}%`;
  }

  minInput.addEventListener('input', () => {
    if (parseFloat(minInput.value) > parseFloat(maxInput.value)) minInput.value = maxInput.value;
    redraw();
    onChange();
  });
  maxInput.addEventListener('input', () => {
    if (parseFloat(maxInput.value) < parseFloat(minInput.value)) maxInput.value = minInput.value;
    redraw();
    onChange();
  });

  redraw();
  return section;
}
