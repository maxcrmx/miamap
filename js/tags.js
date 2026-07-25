// ============================================================================
// tags.js — loading and creating tags (place type / cuisine / special /
// prix / statut).
//
// Tags are loaded once and cached in memory for the session; the app is
// single-user-at-a-time-editing in practice (only the admin writes), so a
// simple refetch-after-write cache is enough — no realtime subscription
// needed.
// ============================================================================

import { sb } from './supabase-client.js';

let tagsCache = null; // array of { id, category, emoji, label }

// Strips a leading emoji + following space from a label, so alphabetical
// sorting ignores it — SPEC.md: "Tags within a category are alphabetically
// sorted, ignoring any leading emoji."
function sortableLabel(tag) {
  return tag.label.trim().toLocaleLowerCase('fr');
}

export async function loadTags({ force = false } = {}) {
  if (tagsCache && !force) return tagsCache;
  const { data, error } = await sb.from('tags').select('id, category, emoji, label').order('label');
  if (error) throw error;
  tagsCache = data;
  return tagsCache;
}

// Returns tags for one category, alphabetically sorted (ignoring emoji).
export function tagsByCategory(category) {
  return (tagsCache || [])
    .filter((t) => t.category === category)
    .sort((a, b) => sortableLabel(a).localeCompare(sortableLabel(b), 'fr'));
}

export function tagById(id) {
  return (tagsCache || []).find((t) => t.id === id);
}

// Creates a new custom tag (admin-only — enforced server-side by RLS).
// `label` should be the plain text name, without the emoji prefix.
export async function createTag(category, emoji, label) {
  const { data, error } = await sb
    .from('tags')
    .insert({ category, emoji, label: label.trim() })
    .select('id, category, emoji, label')
    .single();
  if (error) throw error;
  tagsCache = [...(tagsCache || []), data];
  return data;
}
