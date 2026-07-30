#!/usr/bin/env python3
"""
parse_batch2.py — Step 1 of the SECOND import batch (31 Berlin places,
July 2026). Companion to parse_mapstr.py (the original 306-place import);
same two-step philosophy: this script touches NOTHING in Supabase, it only
writes two REVIEW files in the repo root:

  - batch2_parsed_review.json  (structured — read by import-batch2.html
    for step 2)
  - batch2_parsed_review.csv   (flattened, spreadsheet-friendly)

DIFFERENCES FROM THE FIRST BATCH
- The source is not a mapstr export: the 31 places were provided as a
  curated list (name, verified address, tags, price, remarks), embedded
  below as data. There is therefore no userComment parsing and no geojson.
- No coordinates in the source: lat/lng — plus website / phone /
  google_place_id — are fetched from the Google Places API by
  import-batch2.html at import time (the API key is domain-restricted, so
  the lookup must run in the browser, same as js/place-form.js). This file
  leaves those fields null/empty on purpose.
- Every place is "À tester": no rating, no top/bof, no comment. Remarks
  are kept exactly as given (already "- ..." formatted).
- Tags were given in English; they are mapped below onto the CANONICAL
  French labels already seeded in supabase/schema.sql / created by the
  first import, so the importer re-uses existing tags instead of creating
  near-duplicates. Only two labels are genuinely new: "Syrien" (cuisine)
  and "Healthy" (spécial) — emoji chosen to match the existing palette
  (country flag for a cuisine, food emoji for a spécial).
"""

import csv
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = REPO_ROOT / 'batch2_parsed_review.json'
OUT_CSV = REPO_ROOT / 'batch2_parsed_review.csv'

# ----------------------------------------------------------------------------
# English source tag -> canonical (category, emoji, label) as used in the DB.
# Keep labels in sync with supabase/schema.sql seed data; the importer
# matches existing tags by (category, label) and keeps that row's emoji, so
# an emoji here only matters for the two tags that don't exist yet.
# ----------------------------------------------------------------------------
TAG_MAP = {
    'restaurant':       ('type_de_lieu', '🍽️', 'Restaurant'),
    'café':             ('type_de_lieu', '☕️', 'Café'),
    'bar':              ('type_de_lieu', '🍻', 'Bar'),
    'ice cream shop':   ('type_de_lieu', '🍦', 'Glacier'),

    'vietnamese':       ('cuisine', '🇻🇳', 'Vietnamien'),
    'asian':            ('cuisine', '🌏', 'Asiatique'),
    'german':           ('cuisine', '🇩🇪', 'Allemand'),
    'syrian':           ('cuisine', '🇸🇾', 'Syrien'),        # NEW tag
    'lebanese':         ('cuisine', '🇱🇧', 'Libanais'),
    'levantine':        ('cuisine', '🥙', 'Levant'),
    'chinese':          ('cuisine', '🇨🇳', 'Chinois'),
    'turkish':          ('cuisine', '🇹🇷', 'Turque'),
    'italian':          ('cuisine', '🇮🇹', 'Italien'),

    'brunch':           ('special', '🍳', 'Brunch'),
    'healthy':          ('special', '🥗', 'Healthy'),        # NEW tag
    'vegetarian':       ('special', '🌱', 'Végétarien'),
    'pizza':            ('special', '🍕', 'Pizza'),
    'seafood':          ('special', '⚓️', 'Poissons et fruits de mer'),
    'queer-friendly':   ('special', '🏳️‍🌈', 'Queer-friendly'),

    '<5€':              ('prix', '💶', '< 5€'),
    '<10€':             ('prix', '💶', '< 10€'),
    '10-15€':           ('prix', '💶', '10 - 15€'),
    '15-20€':           ('prix', '💶', '15 - 20€'),
    '20-25€':           ('prix', '💶', '20 - 25€'),
}

STATUS_TO_TRY = ('statut', '🕐', 'À tester')

# ----------------------------------------------------------------------------
# The 31 places, exactly as provided (name, verified address, source tags,
# remarks). Tag ORDER is preserved: the app's pin icon is the emoji of the
# FIRST "Type de lieu" tag added, and the source lists always start with it.
# Osmans Töchter was given "10-15€/15-20€" — kept as BOTH price tags.
# ----------------------------------------------------------------------------
PLACES = [
    ('Saigon Green', 'Kantstraße 23, Berlin',
     ['restaurant', 'vietnamese', '<10€'], []),
    ('Café Kuchen Zeit', 'Kaiser-Friedrich-Straße 1, 10585 Berlin',
     ['restaurant', 'café', 'brunch', '<10€'], []),
    ('Nu Restaurant', 'Schlüterstraße 55, 10629 Berlin',
     ['restaurant', 'vietnamese', 'asian', '10-15€'], []),
    ('Zollpackhof', 'Elisabeth-Abegg-Straße 1, 10557 Berlin',
     ['restaurant', 'bar', 'german', '10-15€'], []),
    ('Café am Neuen See', 'Lichtensteinallee 2, 10787 Berlin',
     ['restaurant', 'bar', 'german', '10-15€'], []),
    ('Schleusenkrug', 'Müller-Breslau-Straße 14b, 10623 Berlin',
     ['restaurant', 'bar', 'german', '10-15€'], []),
    ('Rocket+Basil', 'Lützowstraße 22, 10785 Berlin',
     ['restaurant', 'healthy', 'vegetarian', '10-15€'], []),
    ('Maultaschen Manufaktur', 'Yorckstraße 45, 10965 Berlin',
     ['restaurant', 'german', '10-15€'], []),
    ('Malakeh', 'Potsdamer Straße 153, 10783 Berlin',
     ['restaurant', 'syrian', '15-20€'], []),
    ('Yarok', 'Torstraße 195, 10115 Berlin',
     ['restaurant', 'syrian', '15-20€'], []),
    ('Hummus & Friends', 'Oranienburger Straße 27, 10117 Berlin',
     ['restaurant', 'levantine', '10-15€'], []),
    ('Chipperfield Kantine', 'Joachimstraße 11, 10119 Berlin',
     ['restaurant', 'vegetarian', '10-15€'], ['- résa recommandée']),
    ("Konnopke's Imbiss", 'Schönhauser Allee 44a, 10435 Berlin',
     ['restaurant', 'german', '<5€'], ['- currywurst']),
    ("Ziervogel's Kult Curry", 'Schönhauser Allee 20, 10435 Berlin',
     ['restaurant', 'german', '<5€'], ['- currywurst']),
    ('Babel', 'Kastanienallee 33, 10119 Berlin',
     ['restaurant', 'lebanese', '10-15€'], []),
    ('Metzer Eck', 'Metzer Straße 33, 10405 Berlin',
     ['restaurant', 'german', '10-15€'], []),
    ('Wen Cheng', 'Schönhauser Allee 10, Berlin',
     ['restaurant', 'chinese', '<10€'], []),
    ('Osmans Töchter', 'Prenzlauer Allee 247, 10405 Berlin (Bötzow Areal)',
     ['restaurant', 'turkish', '10-15€', '15-20€'], []),
    ('Minoa', 'Rykestraße 52, 10405 Berlin',
     ['restaurant', 'café', 'brunch', '15-20€'], []),
    ('Café Krone', 'Oderberger Straße 38, 10435 Berlin',
     ['restaurant', 'café', 'brunch', '15-20€'],
     ['- long queues', '- next to the Mauerpark flea market']),
    ('Morgenrot', 'Kastanienallee 85, 10435 Berlin',
     ['restaurant', 'brunch', 'healthy', 'vegetarian', '10-15€'], []),
    ('Il Glaciale', 'Kollwitzstraße 59, 10405 Berlin',
     ['ice cream shop'], []),
    ('Kauf Dich Glücklich', 'Oderberger Straße 44, 10435 Berlin',
     ['ice cream shop'], []),
    ('Hamy Café', 'Hasenheide 10, 10967 Berlin',
     ['restaurant', 'vietnamese', '<10€'], []),
    ("Mustafa's Gemüse Kebap", 'Mehringdamm 33, 10961 Berlin',
     ['restaurant', 'turkish', '<10€'], ['- döner']),
    ('By Schicksals', 'Lindenstraße 16, 10969 Berlin',
     ['restaurant', 'healthy', '<10€'], []),
    ('Ammazza che Pizza', 'Maybachufer 21, 12047 Berlin',
     ['restaurant', 'italian', 'pizza', '10-15€'], []),
    ('Fischtheke', 'Flughafenstraße 35, 12053 Berlin',
     ['restaurant', 'seafood', '20-25€'], []),
    ('Vila Rixdorf', 'Richardplatz 6, 12055 Berlin',
     ['restaurant', 'german', '10-15€'], ['- schnitzel and rösti']),
    ('Südblock', 'Admiralstraße 1-2, 10999 Berlin',
     ['restaurant', 'café', 'queer-friendly', '<10€'], []),
    ('Duo Sicilian Ice Cream', 'Skalitzer Straße 77, 10997 Berlin',
     ['ice cream shop'], []),
]


def main():
    parsed = []
    warnings = []

    for i, (name, address, raw_tags, remarks_lines) in enumerate(PLACES):
        tags = []
        for raw in raw_tags:
            if raw not in TAG_MAP:
                raise SystemExit(f'Place {i} ({name}): unknown source tag "{raw}" — add it to TAG_MAP.')
            c, e, l = TAG_MAP[raw]
            tags.append({'category': c, 'emoji': e, 'label': l})
        tags.append({'category': STATUS_TO_TRY[0], 'emoji': STATUS_TO_TRY[1], 'label': STATUS_TO_TRY[2]})

        if not any(t['category'] == 'type_de_lieu' for t in tags):
            warnings.append(f'Place {i} ({name}): no "Type de lieu" tag — pin icon will fall back to 📍.')
        if not any(t['category'] == 'prix' for t in tags):
            warnings.append(f'Place {i} ({name}): no price tag (given without one — fine if intended).')

        parsed.append({
            'batch_index': i,
            'name': name,
            # The given, human-verified address. import-batch2.html checks the
            # Google Places result against it (postal code / street name) and
            # FLAGS mismatches instead of importing a guess.
            'address': address,
            # Filled by the browser lookup step — null/empty here on purpose.
            'lat': None,
            'lng': None,
            'website': '',
            'phone': '',
            'google_place_id': '',
            'rating': None,     # "à tester" — no rating, NOT 0
            'top': '',
            'bof': '',
            'remarks': '\n'.join(remarks_lines),
            'comment': '',
            'tags': tags,
        })

    OUT_JSON.write_text(json.dumps({'places': parsed, 'warnings': warnings}, ensure_ascii=False, indent=2), encoding='utf-8')

    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['batch_index', 'name', 'address', 'remarks', 'tags'])
        for p in parsed:
            tags_flat = ' | '.join(f"[{t['category']}] {t['emoji']} {t['label']}" for t in p['tags'])
            writer.writerow([p['batch_index'], p['name'], p['address'], p['remarks'], tags_flat])

    print(f'Parsed {len(parsed)} places.')
    print(f'Wrote {OUT_JSON.relative_to(REPO_ROOT)}')
    print(f'Wrote {OUT_CSV.relative_to(REPO_ROOT)}')
    if warnings:
        print(f'\n{len(warnings)} warning(s):')
        for w in warnings:
            print(' -', w)


if __name__ == '__main__':
    main()
