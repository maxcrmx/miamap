// ============================================================================
// db.js — all reads/writes for `places` and their tags.
//
// Every place is loaded together with its tags (via the place_tags join
// table) so the rest of the app can work with a single denormalized object:
//   { id, name, address, lat, lng, rating, top, bof, remarks, comment,
//     date_added, tags: [{ id, category, emoji, label, added_at }, ...] }
//
// `tags` is kept sorted by `added_at` ascending, because pin-icon logic
// (SPEC.md "Pin icon logic") needs "the *first* Type de lieu tag added to
// that place" — see helpers.js for where that's actually used.
// ============================================================================

import { sb } from './supabase-client.js';

const PLACE_SELECT = `
  id, name, address, lat, lng, rating, top, bof, remarks, comment,
  website, phone, google_place_id, date_added,
  place_tags ( added_at, tags ( id, category, emoji, label ) )
`;

function normalizePlace(row) {
  const tags = (row.place_tags || [])
    .slice()
    .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
    .map((pt) => ({ ...pt.tags, added_at: pt.added_at }));
  const { place_tags, ...rest } = row;
  return { ...rest, tags };
}

export async function fetchPlaces() {
  const { data, error } = await sb.from('places').select(PLACE_SELECT);
  if (error) throw error;
  return data.map(normalizePlace);
}

export async function fetchPlace(id) {
  const { data, error } = await sb.from('places').select(PLACE_SELECT).eq('id', id).single();
  if (error) throw error;
  return normalizePlace(data);
}

// Replaces a place's tag set with `tagIds`, preserving the order of the
// array as insertion order (which is what pin-icon logic relies on for
// "first Type de lieu tag"). Sequential awaited inserts so each row gets
// a distinct `added_at` timestamp in the order given.
async function setPlaceTags(placeId, tagIds) {
  const { error: delError } = await sb.from('place_tags').delete().eq('place_id', placeId);
  if (delError) throw delError;

  for (const tagId of tagIds) {
    const { error } = await sb.from('place_tags').insert({ place_id: placeId, tag_id: tagId });
    if (error) throw error;
  }
}

// `fields`: { name, address, lat, lng, rating, top, bof, remarks, comment }
// `tagIds`: ordered array of tag UUIDs (see setPlaceTags above for why order matters).
export async function createPlace(fields, tagIds) {
  const { data, error } = await sb.from('places').insert(fields).select('id').single();
  if (error) throw error;
  await setPlaceTags(data.id, tagIds);
  return fetchPlace(data.id);
}

export async function updatePlace(id, fields, tagIds) {
  const { error } = await sb.from('places').update(fields).eq('id', id);
  if (error) throw error;
  await setPlaceTags(id, tagIds);
  return fetchPlace(id);
}

export async function deletePlace(id) {
  const { error } = await sb.from('places').delete().eq('id', id);
  if (error) throw error;
}
