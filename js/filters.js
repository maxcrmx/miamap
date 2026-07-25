// ============================================================================
// filters.js — the filter side panel: renders tag checkboxes grouped by
// category + the rating range slider, and applies the fixed filter logic
// described in SPEC.md "Filtering logic":
//   - within a category: OR  (any selected tag in that category matches)
//   - across categories: AND (every category with a selection must match)
//   - name search is separate, applied on top of category filters
// ============================================================================

import { TAG_CATEGORIES } from './config.js';
import { tagsByCategory } from './tags.js';

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

// Renders the filter panel into `root` (a DOM element) and calls
// `onChange()` (no args — callers re-read filterState/searchText) whenever
// something changes.
export function renderFilterPanel(root, onChange) {
  root.innerHTML = '';

  for (const { key, label } of TAG_CATEGORIES) {
    const section = document.createElement('div');
    section.className = 'filter-section';

    const heading = document.createElement('h3');
    heading.textContent = label;
    section.appendChild(heading);

    if (key === 'prix') {
      // Prix is presented as a dropdown-style single pick per SPEC.md, but
      // internally it's still "OR within category" if more than one is
      // selected — a plain multi-select list of checkboxes covers this
      // without needing special-case filtering logic.
    }

    const list = document.createElement('div');
    list.className = 'filter-tag-list';
    for (const tag of tagsByCategory(key)) {
      const id = `filter-${tag.id}`;
      const item = document.createElement('label');
      item.className = 'filter-tag-item';
      item.htmlFor = id;
      item.innerHTML = `<input type="checkbox" id="${id}" /><span>${tag.emoji} ${tag.label}</span>`;
      const checkbox = item.querySelector('input');
      checkbox.checked = filterState.categories[key].has(tag.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) filterState.categories[key].add(tag.id);
        else filterState.categories[key].delete(tag.id);
        onChange();
      });
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);

    // Rating slider goes after "Prix", before "Statut", per SPEC.md order.
    if (key === 'prix') {
      root.appendChild(buildRatingSlider(onChange));
    }
  }
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
