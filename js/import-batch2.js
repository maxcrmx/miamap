// ============================================================================
// import-batch2.js — logic behind import-batch2.html, step 2 of the SECOND
// import batch (31 Berlin places, July 2026). Companion to import-tool.js
// (the original 306-place mapstr import) — same admin gate, same tag
// resolution, same idempotent skip-if-present behaviour, INSERT only.
//
// What's different from the first batch: the source list has no
// coordinates and no Google data, so this tool adds a LOOKUP phase before
// the import. For each place it queries Google Places (findPlaceFromQuery
// on "name, address" — same key and same browser-side API as
// js/place-form.js; the key is domain-restricted so this cannot run
// server-side) and takes lat/lng, website, phone and google_place_id from
// the result. A place is FLAGGED — excluded from import, listed in the
// log — instead of guessed at when:
//   - Google returns zero results or MORE THAN ONE candidate, or
//   - the single candidate's address doesn't match the given, verified
//     address (postal code if we have one, street name otherwise).
// After the lookup you can download the enriched review JSON/CSV and eyeball
// it before clicking import — same review-before-write flow as batch 1.
// ============================================================================

import { initAuth, isAdmin, getCurrentProfile } from './auth.js';
import { loadTags, createTag, findTagByLabel, findTagAnyCategory } from './tags.js';
import { sb } from './supabase-client.js';

const gate = document.getElementById('import-gate');
const panel = document.getElementById('import-panel');
const loadBtn = document.getElementById('import-load-btn');
const lookupBtn = document.getElementById('import-lookup-btn');
const runBtn = document.getElementById('import-run-btn');
const exportLinks = document.getElementById('import-export-links');
const summaryEl = document.getElementById('import-summary');
const logEl = document.getElementById('import-log');

let parsedPlaces = null;   // loaded from batch2_parsed_review.json
let lookupDone = false;

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
  const res = await fetch('./batch2_parsed_review.json');
  if (!res.ok) throw new Error('Impossible de charger batch2_parsed_review.json (' + res.status + ')');
  const data = await res.json();
  parsedPlaces = data.places;
  lookupDone = false;
  runBtn.disabled = true;
  lookupBtn.disabled = false;
  summaryEl.textContent = `${parsedPlaces.length} lieux chargés depuis batch2_parsed_review.json.` +
    (data.warnings?.length ? ` ${data.warnings.length} avertissement(s) — voir la console.` : '');
  if (data.warnings?.length) console.warn('Avertissements du parsing :', data.warnings);
}

// ----------------------------------------------------------------------------
// Phase 1 — recherche Google Places
// ----------------------------------------------------------------------------

// "Schönhauser Allee 44a" -> "Schönhauser Allee" (drops trailing tokens that
// contain a digit: house number, "1-2", "14b"...).
function streetName(address) {
  const tokens = address.split(',')[0].trim().split(/\s+/);
  while (tokens.length && /\d/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

// Normalisation tolérante aux abréviations Google : minuscules, ß -> ss,
// puis "strasse"/"straße" réduit à "str" (« Kantstraße » matche « Kantstr. »).
function normalize(s) {
  return s.toLocaleLowerCase('de').replaceAll('ß', 'ss').replace(/strasse\b/g, 'str');
}

// Le résultat Google colle-t-il à l'adresse VÉRIFIÉE de la liste ? Code
// postal si on en a un, sinon nom de rue. Retourne null si OK, sinon la
// raison du rejet (pour le log + le fichier de revue).
function addressMismatch(givenAddress, googleAddress) {
  const postal = (givenAddress.match(/\b\d{5}\b/) || [])[0];
  if (postal) {
    return googleAddress.includes(postal) ? null
      : `code postal ${postal} absent de « ${googleAddress} »`;
  }
  const street = streetName(givenAddress);
  return normalize(googleAddress).includes(normalize(street)) ? null
    : `rue « ${street} » absente de « ${googleAddress} »`;
}

function findPlace(service, query) {
  return new Promise((resolve, reject) => {
    service.findPlaceFromQuery(
      { query, fields: ['place_id', 'name', 'formatted_address', 'geometry'] },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) return resolve([]);
        if (status !== google.maps.places.PlacesServiceStatus.OK) return reject(new Error('Places: ' + status));
        resolve(results || []);
      }
    );
  });
}

function getDetails(service, placeId) {
  return new Promise((resolve, reject) => {
    service.getDetails(
      // Mêmes champs que js/place-form.js selectPrediction() — récupérés UNE
      // fois ici puis stockés en base, zéro appel Places à l'ouverture d'une fiche.
      { placeId, fields: ['place_id', 'formatted_address', 'geometry', 'name', 'website', 'formatted_phone_number'] },
      (place, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !place.geometry) {
          return reject(new Error('Places getDetails: ' + status));
        }
        resolve(place);
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLookup() {
  lookupBtn.disabled = true;
  loadBtn.disabled = true;
  await window.googleMapsReady;
  const service = new google.maps.places.PlacesService(document.createElement('div'));

  let flagged = 0;
  const total = parsedPlaces.length;

  for (const [i, place] of parsedPlaces.entries()) {
    summaryEl.textContent = `Recherche Google Places… ${i + 1}/${total} (${flagged} à vérifier)`;
    place.flag = '';
    try {
      const candidates = await findPlace(service, `${place.name}, ${place.address}`);

      if (candidates.length === 0) {
        place.flag = 'aucun résultat Google';
      } else if (candidates.length > 1) {
        // Plusieurs candidats = ambigu -> on N'IMPORTE PAS, on liste tout
        // pour arbitrage manuel (règle du batch : signaler, pas deviner).
        place.flag = 'plusieurs candidats : ' +
          candidates.map((c) => `${c.name} — ${c.formatted_address}`).join(' / ');
      } else {
        const mismatch = addressMismatch(place.address, candidates[0].formatted_address);
        if (mismatch) {
          place.flag = `adresse différente (${mismatch})`;
        } else {
          const details = await getDetails(service, candidates[0].place_id);
          place.lat = details.geometry.location.lat();
          place.lng = details.geometry.location.lng();
          place.website = details.website || '';
          place.phone = details.formatted_phone_number || '';
          place.google_place_id = details.place_id || candidates[0].place_id;
          // Conservés pour la revue humaine (colonne à comparer), PAS importés :
          // le nom et l'adresse de la liste font foi, comme au batch 1.
          place.google_name = details.name || '';
          place.google_address = details.formatted_address || '';
        }
      }
    } catch (err) {
      place.flag = 'erreur : ' + (err?.message ?? err);
    }

    if (place.flag) {
      flagged++;
      log(`⚠️  ${place.name} — À VÉRIFIER : ${place.flag}`);
    } else {
      log(`✓ ${place.name} → ${place.google_address}` +
        (place.website ? '' : ' (pas de site web)') + (place.phone ? '' : ' (pas de téléphone)'));
    }
    await sleep(250); // évite OVER_QUERY_LIMIT sur 31 requêtes d'affilée
  }

  lookupDone = true;
  offerExports();
  runBtn.disabled = false;
  loadBtn.disabled = false;
  const ok = total - flagged;
  summaryEl.textContent = `Recherche terminée : ${ok} lieux prêts, ${flagged} à vérifier (exclus de l'import). ` +
    'Télécharge et relis la revue enrichie avant d\'importer.';
  log(`\nRecherche terminée. ${ok} prêts, ${flagged} à vérifier.` +
    (flagged ? ' Les lieux ⚠️ ci-dessus seront IGNORÉS par l\'import — corrige la liste ou traite-les à la main.' : ''));
}

// ----------------------------------------------------------------------------
// Revue enrichie téléchargeable (JSON + CSV) — à relire AVANT l'import
// ----------------------------------------------------------------------------
function offerExports() {
  const stamp = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ places: parsedPlaces }, null, 2);

  const csvEscape = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  const header = ['batch_index', 'flag', 'name', 'google_name', 'address', 'google_address',
    'lat', 'lng', 'website', 'phone', 'google_place_id', 'remarks', 'tags'];
  const rows = parsedPlaces.map((p) => [
    p.batch_index, p.flag, p.name, p.google_name ?? '', p.address, p.google_address ?? '',
    p.lat ?? '', p.lng ?? '', p.website, p.phone, p.google_place_id, p.remarks,
    p.tags.map((t) => `[${t.category}] ${t.emoji} ${t.label}`).join(' | '),
  ].map(csvEscape).join(','));
  const csv = header.join(',') + '\n' + rows.join('\n');

  exportLinks.innerHTML = '';
  for (const [content, type, filename] of [
    [json, 'application/json', `batch2_enriched_review_${stamp}.json`],
    ['﻿' + csv, 'text/csv', `batch2_enriched_review_${stamp}.csv`],
  ]) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.textContent = '⬇ ' + filename;
    exportLinks.appendChild(a);
  }
  exportLinks.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// Phase 2 — import idempotent (INSERT only, jamais de DELETE/UPDATE)
// ----------------------------------------------------------------------------

// Réutilise un tag existant ou le crée — jamais de doublon. La comparaison
// passe par tags.js normalizeLabel() (trim + espaces multiples + Unicode NFC
// + casse) : un « Healthy » avec un espace de fin ou un accent décomposé
// matche quand même. Et si le libellé existe déjà dans une AUTRE catégorie,
// on refuse (erreur → lieu en échec dans le journal) au lieu de créer un
// second tag en silence — c'est le trou qui a produit deux tags "Healthy".
async function resolveTagId(category, emoji, label) {
  const existing = findTagByLabel(category, label);
  if (existing) return existing.id;
  const elsewhere = findTagAnyCategory(label);
  if (elsewhere) {
    throw new Error(
      `le tag « ${label} » existe déjà dans la catégorie « ${elsewhere.category} » ` +
      `(attendu : « ${category} ») — corrige la catégorie du tag en base ou celle du batch, puis relance.`
    );
  }
  const created = await createTag(category, emoji, label);
  return created.id;
}

// Idempotence : un lieu est "déjà là" si son google_place_id existe en base
// (comparaison la plus fiable — le batch 1 a des place_id vides, d'où le
// filtre non-vide), OU à défaut si nom + adresse correspondent exactement.
async function placeAlreadyImported(place) {
  if (place.google_place_id) {
    const { data, error } = await sb
      .from('places')
      .select('id')
      .eq('google_place_id', place.google_place_id)
      .limit(1);
    if (error) throw error;
    if (data.length) return true;
  }
  const { data, error } = await sb
    .from('places')
    .select('id')
    .eq('name', place.name)
    .eq('address', place.address)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

async function runImport() {
  runBtn.disabled = true;
  loadBtn.disabled = true;
  lookupBtn.disabled = true;

  try {
    await loadTags();
  } catch (err) {
    log('✗ Impossible de démarrer l\'import : ' + (err?.message ?? err));
    summaryEl.textContent = 'Import non démarré (voir le journal).';
    runBtn.disabled = false;
    loadBtn.disabled = false;
    return;
  }

  let created = 0;
  let skipped = 0;
  let flaggedSkipped = 0;
  let failed = 0;
  const total = parsedPlaces.length;
  let done = 0;

  for (const place of parsedPlaces) {
    done++;
    summaryEl.textContent = `Import en cours… ${done}/${total} (${created} créés, ${skipped} déjà là, ${flaggedSkipped} à vérifier, ${failed} échecs)`;
    try {
      if (place.flag) {
        flaggedSkipped++;
        log(`⚠️  ${place.name} — NON importé (à vérifier : ${place.flag})`);
        continue;
      }
      if (await placeAlreadyImported(place)) {
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
          address: place.address,   // l'adresse vérifiée de la liste fait foi
          lat: place.lat,
          lng: place.lng,
          rating: null,             // "à tester" — surtout pas 0
          top: '',
          bof: '',
          remarks: place.remarks,
          comment: '',
          website: place.website,
          phone: place.phone,
          google_place_id: place.google_place_id,
          // pas de date_added : le défaut now() de la colonne s'applique —
          // contrairement au batch 1, il n'y a pas de date mapstr à préserver.
          created_by: getCurrentProfile().id,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      // Insérés dans l'ordre de la liste (type de lieu en premier) : l'icône
      // du pin = emoji du PREMIER tag "Type de lieu" ajouté (added_at).
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

  log(`\nTerminé. ${created} créés, ${skipped} déjà présents, ${flaggedSkipped} à vérifier (non importés), ${failed} échecs.`);
  summaryEl.textContent = `Terminé : ${created} créés, ${skipped} déjà présents, ${flaggedSkipped} à vérifier, ${failed} échecs.`;
  runBtn.disabled = false;
  loadBtn.disabled = false;
  lookupBtn.disabled = false;
}

async function main() {
  const ok = await checkAdmin();
  if (!ok) return;
  loadBtn.addEventListener('click', () => loadReviewFile().catch((e) => log('Erreur : ' + e.message)));
  lookupBtn.addEventListener('click', () => runLookup().catch((e) => log('Erreur : ' + e.message)));
  runBtn.addEventListener('click', () => {
    if (!lookupDone) return;
    const ready = parsedPlaces.filter((p) => !p.flag).length;
    if (!confirm(`Importer ${ready} lieux dans la base en direct ? Cette action écrit des données réelles (INSERT uniquement).`)) return;
    runImport();
  });
}

main();
