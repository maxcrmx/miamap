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

// ----------------------------------------------------------------------------
// Contrôle de schéma AVANT d'écrire quoi que ce soit
// ----------------------------------------------------------------------------
// `places` a gagné website / phone / google_place_id après l'écriture de cet
// outil. Sans les migrations, l'import partait ligne par ligne et échouait
// 306 fois de suite sur "Could not find the 'google_place_id' column" — on
// préfère refuser de démarrer, avec le SQL exact à exécuter.
const REQUIRED_COLUMNS = ['website', 'phone', 'google_place_id'];

const MIGRATION_SQL =
  "alter table public.places add column if not exists website         text not null default '';\n" +
  "alter table public.places add column if not exists phone           text not null default '';\n" +
  "alter table public.places add column if not exists google_place_id text not null default '';\n" +
  "notify pgrst, 'reload schema';";

async function checkSchema() {
  const { error } = await sb
    .from('places')
    .select(['id', ...REQUIRED_COLUMNS].join(', '))
    .limit(1);
  if (!error) return true;

  log('✗ Schéma incomplet : ' + error.message);
  log('\nExécute ceci dans Supabase → SQL Editor, puis recharge cette page :\n');
  log(MIGRATION_SQL);
  summaryEl.textContent = 'Import bloqué : migration SQL manquante (voir le journal ci-dessous).';
  return false;
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

  // Refuse de démarrer si les colonnes manquent (voir checkSchema). Le
  // try/catch couvre aussi une panne du préflight lui-même : sans lui, une
  // exception ici laissait les deux boutons désactivés et la page muette,
  // sans aucune indication de ce qui s'était passé.
  try {
    if (!(await checkSchema())) {
      runBtn.disabled = false;
      loadBtn.disabled = false;
      return;
    }
    await loadTags();
  } catch (err) {
    log('✗ Impossible de démarrer l\'import : ' + (err?.message ?? err));
    summaryEl.textContent = 'Import non démarré (voir le journal).';
    console.error('[import] préflight en échec :', err);
    runBtn.disabled = false;
    loadBtn.disabled = false;
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const total = parsedPlaces.length;
  let done = 0;

  for (const place of parsedPlaces) {
    done++;
    summaryEl.textContent = `Import en cours… ${done}/${total} (${created} créés, ${skipped} ignorés, ${failed} échecs)`;
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
          // `rating` reste null pour les lieux "à tester" — surtout pas 0,
          // qui voudrait dire "testé et noté zéro".
          rating: place.rating,
          top: place.top,
          bof: place.bof,
          remarks: place.remarks,
          comment: place.comment,
          // L'export mapstr ne contient ni site web, ni téléphone, ni
          // identifiant Google : on insère des chaînes vides, ce que la fiche
          // lieu sait afficher (boutons Site web / Appeler grisés, "Y aller"
          // qui retombe sur l'URL de recherche Google Maps). Si une future
          // version du parsing les fournit, elles sont reprises telles quelles.
          website: place.website ?? '',
          phone: place.phone ?? '',
          google_place_id: place.google_place_id ?? place.place_id ?? '',
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
  summaryEl.textContent = `Terminé : ${created} créés, ${skipped} déjà présents, ${failed} échecs.`;
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
