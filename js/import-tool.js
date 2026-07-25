// ============================================================================
// import-tool.js — logic behind import.html, step 2 of the one-time
// mapstr import (SPEC.md "Data import").
//
// This is deliberately a page you open and click a button in yourself,
// rather than something run automatically — it writes 307 rows to the
// live database and should only run once, after you've reviewed
// mapstr_parsed_review.json/.csv (produced by scripts/parse_mapstr.py).
//
// It reuses your existing logged-in session (same Supabase client/
// localStorage as index.html) so all writes go through the exact same
// RLS policies as the rest of the app — this page has no special access,
// it just automates clicking "Ajouter un lieu" 307 times.
// ============================================================================

import { initAuth, isAdmin, getCurrentProfile } from './auth.js';
import { loadTags, tagsByCategory, createTag } from './tags.js';
import { sb } from './supabase-client.js';

const gate = document.getElementById('import-gate');
const panel = document.getElementById('import-panel');
const loadBtn = document.getElementById('import-load-btn');
const runBtn = document.getElementById('import-run-btn');
const summaryEl = document.getElementById('import-summary');
const logEl = document.getElementById('import-log');

let parsedPlaces = null;

function log(msg) {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

async function checkAdmin() {
  const profile = await initAuth();
  if (!profile || !isAdmin()) {
    gate.textContent = profile
      ? 'Connecté, mais pas en tant qu\'admin — cet outil est réservé à l\'admin.'
      : 'Connecte-toi depuis index.html (lien magique) avant d\'ouvrir cet outil.';
    return false;
  }
  gate.textContent = `Connecté en tant qu'admin (${getCurrentProfile().email}).`;
  panel.classList.remove('hidden');
  return true;
}

async function loadReviewFile() {
  const res = await fetch('./mapstr_parsed_review.json');
  if (!res.ok) throw new Error('Impossible de charger mapstr_parsed_review.json (' + res.status + ')');
  const data = await res.json();
  parsedPlaces = data.places;
  summaryEl.textContent = `${parsedPlaces.length} lieux chargés depuis mapstr_parsed_review.json.` +
    (data.warnings?.length ? ` ${data.warnings.length} avertissement(s) — voir la console.` : '');
  if (data.warnings?.length) console.warn('Avertissements du parsing :', data.warnings);
  runBtn.disabled = false;
}

// Finds an existing tag matching (category, label) case-insensitively, or
// creates it. Re-uses the seeded tags from supabase/schema.sql whenever
// the label matches, so we don't end up with near-duplicate tags.
async function resolveTagId(category, emoji, label) {
  const existing = tagsByCategory(category).find(
    (t) => t.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr')
  );
  if (existing) return existing.id;
  const created = await createTag(category, emoji, label);
  return created.id;
}

async function placeAlreadyImported(name, address) {
  const { data, error } = await sb
    .from('places')
    .select('id')
    .eq('name', name)
    .eq('address', address)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function runImport() {
  runBtn.disabled = true;
  loadBtn.disabled = true;
  await loadTags();

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const place of parsedPlaces) {
    try {
      // Safe to re-run: skip anything that's already in the DB (matched by
      // exact name+address) instead of creating duplicates.
      if (await placeAlreadyImported(place.name, place.address)) {
        skipped++;
        log(`⏭️  ${place.name} — déjà importé, ignoré.`);
        continue;
      }

      const tagIds = [];
      for (const t of place.tags) {
        tagIds.push(await resolveTagId(t.category, t.emoji, t.label));
      }

      const { data: inserted, error: insertError } = await sb
        .from('places')
        .insert({
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating,
          top: place.top,
          bof: place.bof,
          remarks: place.remarks,
          comment: place.comment,
          date_added: place.date_added,
          created_by: getCurrentProfile().id,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      for (const tagId of tagIds) {
        const { error: linkError } = await sb.from('place_tags').insert({ place_id: inserted.id, tag_id: tagId });
        if (linkError) throw linkError;
      }

      created++;
      log(`✓ ${place.name}`);
    } catch (err) {
      failed++;
      log(`✗ ${place.name} — ERREUR: ${err.message}`);
    }
  }

  log(`\nTerminé. ${created} créés, ${skipped} déjà présents, ${failed} échecs.`);
  runBtn.disabled = false;
  loadBtn.disabled = false;
}

async function main() {
  const ok = await checkAdmin();
  if (!ok) return;
  loadBtn.addEventListener('click', () => loadReviewFile().catch((e) => log('Erreur : ' + e.message)));
  runBtn.addEventListener('click', () => {
    if (!confirm(`Importer ${parsedPlaces.length} lieux dans la base en direct ? Cette action écrit des données réelles.`)) return;
    runImport();
  });
}

main();
