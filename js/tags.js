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

// ----------------------------------------------------------------------------
// Comparaison de libellés saisis à la main (imports, création inline).
// ----------------------------------------------------------------------------
// Un simple toLowerCase() ne suffit pas : un espace de début/fin, un espace
// double, ou un accent en forme Unicode décomposée ("e" + combinant au lieu
// de "é") produisent des libellés visuellement identiques mais différents
// pour ===. C'est exactement ce qui a fait créer un doublon du tag "Healthy"
// lors de la préparation du batch 2 — d'où cette normalisation unique,
// partagée par tous les outils d'import.
export function normalizeLabel(label) {
  return label.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

// Tag existant portant ce libellé (normalisé) dans CETTE catégorie, ou null.
export function findTagByLabel(category, label) {
  const wanted = normalizeLabel(label);
  return (tagsCache || []).find(
    (t) => t.category === category && normalizeLabel(t.label) === wanted
  ) || null;
}

// Même recherche, toutes catégories confondues. Sert aux imports à détecter
// "ce libellé existe déjà, mais ailleurs" — cas à signaler à l'admin plutôt
// qu'à résoudre en créant silencieusement un quasi-doublon.
export function findTagAnyCategory(label) {
  const wanted = normalizeLabel(label);
  return (tagsCache || []).find((t) => normalizeLabel(t.label) === wanted) || null;
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

// Renomme un tag (émoji + libellé). Aucun lieu n'est touché : `place_tags`
// référence le tag par son id, donc le nouveau libellé apparaît partout dès
// que les lieux sont rechargés.
export async function updateTag(id, emoji, label) {
  const { data, error } = await sb
    .from('tags')
    .update({ emoji: emoji.trim(), label: label.trim() })
    .eq('id', id)
    .select('id, category, emoji, label')
    .single();
  if (error) throw error;
  tagsCache = (tagsCache || []).map((t) => (t.id === id ? data : t));
  return data;
}

// Supprime un tag. Les lignes place_tags correspondantes partent avec, via
// le `on delete cascade` de la FK (supabase/schema.sql) — le tag disparaît
// donc de tous les lieux qui le portaient.
// Le `.select()` n'est pas décoratif : un refus au niveau RLS (par
// opposition à un refus au niveau GRANT, qui lui lève une vraie erreur
// 42501) ne renvoie PAS d'erreur — il renvoie zéro ligne affectée. Sans ce
// contrôle, une policy manquante ou trop stricte se traduirait par une
// suppression qui « marche » dans l'UI et un tag toujours là après
// rafraîchissement. On le transforme en erreur visible.
export async function deleteTag(id) {
  const { data, error } = await sb.from('tags').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("aucune ligne supprimée — accès refusé par les règles de sécurité (RLS).");
  }
  tagsCache = (tagsCache || []).filter((t) => t.id !== id);
}
