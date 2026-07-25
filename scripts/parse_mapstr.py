#!/usr/bin/env python3
"""
parse_mapstr.py — Step 1 of the mapstr.csv/mapstr.geojson import (SPEC.md
"Data import (one-time, 307 places)").

WHAT THIS SCRIPT DOES
This does NOT touch Supabase. It only reads the two export files sitting in
the repo root and writes two REVIEW files next to them:

  - mapstr_parsed_review.json  (structured — this is what the browser-based
    import tool at import/import.html actually reads for step 2)
  - mapstr_parsed_review.csv   (flattened, spreadsheet-friendly — open this
    one in Excel/Numbers/Google Sheets to eyeball 307 rows quickly)

Nothing is written to the live database until you've checked these files
and explicitly run the import step. See import/README.md for that.

WHY THE PARSING WORKS THIS WAY
- mapstr.csv has one row per place with a free-text `userComment` field
  that mixes 4 sections together using French emoji markers, e.g.:
      "Les 👍 : ... Les 🤷‍♂️ : ... Remarque 💭 : ... Note ⭐️ : 4/5 blah"
  We split on those markers into top / bof / remarks. The numeric rating
  (the "Note" field) is read from the CSV's own `rating` column instead of
  parsed from the text (it's more reliable) and is ALWAYS a bare number
  (e.g. 4 or 4.5), never mixed with text. Any free text that follows the
  "X/5" in the Note section (e.g. "c'est le parfait sandwich italien...")
  is extracted into the `comment` field instead.
- mapstr.csv's `tags` column (hash-separated, e.g. "🍽️ Restaurant#🇮🇹
  Italien#< 10€#⭐️ 4/5") is split and each tag is classified into one of
  the 5 categories from SPEC.md by matching against known label sets.
  Order is preserved because the app's pin-icon logic needs "the FIRST
  Type de lieu tag added" — see helpers.js pinIcon() in the frontend.
- mapstr.geojson has the same 307 places in the same order (verified by
  comparing name+address pairs) and carries the lat/lng that mapstr.csv
  lacks, so we zip the two files together by index instead of geocoding
  addresses again.
"""

import csv
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / 'mapstr.csv'
GEOJSON_PATH = REPO_ROOT / 'mapstr.geojson'
OUT_JSON = REPO_ROOT / 'mapstr_parsed_review.json'
OUT_CSV = REPO_ROOT / 'mapstr_parsed_review.csv'

# ----------------------------------------------------------------------------
# Tag category classification
# ----------------------------------------------------------------------------
# Every tag in mapstr.csv looks like "<emoji> <Label>" (emoji + space + text)
# except price tags ("< 10€", "10 - 15€", ...) which have no emoji, and the
# "To try" status tag. We classify by the *label text* (emoji stripped).

TYPE_DE_LIEU_LABELS = {
    'Restaurant', 'Café', 'Bar', 'Boulangerie', 'Pâtisserie', 'Glacier',
    'Mercado', 'Crêperie', 'Fromagerie', 'Fromage',
}
# mapstr.csv spells some labels slightly differently than the canonical
# names seeded in supabase/schema.sql (e.g. missing an accent), and some
# raw tags should be merged into an existing one entirely rather than kept
# as their own tag. Map the raw CSV spelling/label to the canonical one so
# the import re-uses the seeded tag instead of creating a near-duplicate.
# "Crêpe" is merged into "Crêperie" (Type de lieu) per admin correction —
# it no longer exists as its own tag after parsing.
TYPE_DE_LIEU_ALIASES = {
    'Patisserie': 'Pâtisserie',
    'Crêpe': 'Crêperie',
}
SPECIAL_LABELS = {
    'Sandwich', 'Bowl', 'Pizza', 'Brunch', 'Burger', 'Trendy', 'Végétarien',
    'Vegan', 'Poissons et fruits de mer', 'À partager', 'Queer-friendly',
    'Sans gluten', 'Rooftop',
}
# Cuisine labels renamed from their raw mapstr.csv spelling per admin
# correction (e.g. "Moyen-orient" -> "Levant").
CUISINE_ALIASES = {
    'Moyen-orient': 'Levant',
}
PRICE_RE = re.compile(r'^(<\s*\d+€|\d+\s*-\s*\d+€)$')
RATING_TAG_RE = re.compile(r'^⭐️\s*[\d,.]+/5$')  # redundant with the `rating` column — dropped
STATUS_TO_TRY_LABEL = 'To try'

# Default emoji fallback for a couple of default category placeholders used
# when the source data doesn't carry one for that category (price/status
# already have fixed emoji chosen in supabase/schema.sql's seed data).
PRICE_EMOJI = '💶'
STATUS_TESTED_EMOJI = '✅'
STATUS_TO_TRY_EMOJI = '🕐'

# Rows excluded entirely from the import (admin decision — not worth fixing
# up, e.g. missing a Type de lieu tag and not otherwise interesting).
# Keyed by (row_index, name) so a mismatch raises loudly instead of
# silently skipping the wrong row if mapstr.csv ever changes.
EXCLUDED_ROWS = {(109, 'PAN:AM')}


def split_emoji_label(raw_tag):
    """Splits '🇮🇹 Italien' into ('🇮🇹', 'Italien'). Tags without a leading
    emoji (price brackets) return ('', raw_tag)."""
    raw_tag = raw_tag.strip()
    parts = raw_tag.split(' ', 1)
    if len(parts) == 2 and not parts[0][0].isalnum():
        return parts[0], parts[1].strip()
    return '', raw_tag


def classify_tag(raw_tag):
    """Returns (category, emoji, label) for one raw tag string from
    mapstr.csv's `tags` column, or None if it should be dropped (the
    redundant '⭐️ X/5' rating tags)."""
    raw_tag = raw_tag.strip()
    if not raw_tag:
        return None
    if RATING_TAG_RE.match(raw_tag):
        return None  # rating comes from the CSV `rating` column instead
    if PRICE_RE.match(raw_tag):
        return ('prix', PRICE_EMOJI, raw_tag)
    if raw_tag == STATUS_TO_TRY_LABEL:
        return ('statut', STATUS_TO_TRY_EMOJI, 'À tester')

    emoji, label = split_emoji_label(raw_tag)
    if label in TYPE_DE_LIEU_ALIASES:
        label = TYPE_DE_LIEU_ALIASES[label]
    if label in TYPE_DE_LIEU_LABELS:
        return ('type_de_lieu', emoji, label)
    if label in SPECIAL_LABELS:
        return ('special', emoji, label)
    # Everything else in this dataset is a cuisine/origin tag (country
    # flags, "Asiatique", "Méditerranéen", etc.) — SPEC.md: "Keep every
    # cuisine as its own tag, even low-frequency ones."
    if label in CUISINE_ALIASES:
        label = CUISINE_ALIASES[label]
    return ('cuisine', emoji, label)


# ----------------------------------------------------------------------------
# userComment splitting
# ----------------------------------------------------------------------------
# Matches any of the 4 section markers seen in the export, tolerating the
# variants actually present (singular/plural "Remarque(s)", with/without
# space before ':', the '🤷‍♂️' emoji containing a zero-width-joiner).
MARKER_RE = re.compile(
    r'(?P<top>Les\s*👍\s*:)'
    r'|(?P<bof>Les\s*🤷[^\s:]*\s*:)'
    r'|(?P<remarks>Remarques?\s*💭?\s*:)'
    r'|(?P<note>Notes?\s*⭐️?\s*:)'
)

NOTE_PREFIX_RE = re.compile(r'^\s*[\d,.]+\s*/\s*5\s*')  # strips a leading "4/5" / "3,5/5" etc.


def split_user_comment(text):
    """Returns dict with 'top', 'bof', 'remarks', 'comment' (str), each
    trimmed. The Note section is "Note ⭐️ : X/5 <optional free text>" — the
    numeric rating itself is NOT read from here (see the `rating` CSV
    column, used directly as the numeric Note field), and any free text
    that follows "X/5" goes into 'comment', e.g. "Note ⭐️ : 4/5 c'est le
    parfait sandwich italien" -> comment = "c'est le parfait sandwich
    italien" (per admin correction — this text used to be appended to
    'remarks', which mixed it up with the general-notes field)."""
    result = {'top': '', 'bof': '', 'remarks': '', 'comment': ''}
    if not text or not text.strip():
        return result

    matches = list(MARKER_RE.finditer(text))
    if not matches:
        # No recognizable markers at all — keep the whole thing as remarks
        # rather than silently losing it.
        result['remarks'] = text.strip()
        return result

    sections = {}
    for i, m in enumerate(matches):
        kind = m.lastgroup
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections.setdefault(kind, []).append(text[start:end].strip())

    result['top'] = '\n'.join(sections.get('top', [])).strip()
    result['bof'] = '\n'.join(sections.get('bof', [])).strip()
    result['remarks'] = '\n'.join(sections.get('remarks', [])).strip()

    note_text = '\n'.join(sections.get('note', [])).strip()
    result['comment'] = format_comment(NOTE_PREFIX_RE.sub('', note_text).strip())

    return result


def format_comment(text):
    """Capitalizes the first letter and strips one trailing '.' — cosmetic
    cleanup for the 'comment' field only (admin correction: top/bof/remarks
    are left exactly as written, lowercase or not)."""
    text = text.strip()
    if not text:
        return text
    text = text[0].upper() + text[1:]
    if text.endswith('.'):
        text = text[:-1].rstrip()
    return text


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        csv_rows = list(csv.DictReader(f))

    with open(GEOJSON_PATH, encoding='utf-8') as f:
        features = json.load(f)['features']

    if len(csv_rows) != len(features):
        raise SystemExit(f'Row count mismatch: csv={len(csv_rows)} geojson={len(features)}')

    parsed = []
    warnings = []

    for i, (row, feat) in enumerate(zip(csv_rows, features)):
        if row['name'] != feat['properties']['name'] or row['address'] != feat['properties']['address']:
            warnings.append(f'Row {i}: name/address mismatch between CSV and GeoJSON — check manually.')

        if (i, row['name'].strip()) in EXCLUDED_ROWS:
            continue  # deliberately not imported — see EXCLUDED_ROWS above

        lng, lat = feat['geometry']['coordinates']

        comment_parts = split_user_comment(row['userComment'])

        # "À tester" (not yet visited) places have no rating in the source
        # data — that must stay NULL ("no rating yet"), not 0 (a 0 would
        # read as "visited and rated zero", which is a different fact).
        try:
            rating = float(row['rating']) if row['rating'].strip() else None
        except ValueError:
            rating = None
            warnings.append(f'Row {i} ({row["name"]}): unparsable rating "{row["rating"]}", left empty.')

        raw_tags = [t for t in row['tags'].split('#') if t.strip()]
        classified = [classify_tag(t) for t in raw_tags]
        classified = [c for c in classified if c is not None]
        tags = []
        seen = set()
        for (c, e, l) in classified:
            # Dedupe: aliasing (e.g. "Crêpe" -> "Crêperie") can make two
            # originally-distinct raw tags collide into the same tag here.
            key = (c, l)
            if key in seen:
                continue
            seen.add(key)
            tags.append({'category': c, 'emoji': e, 'label': l})

        if not any(t['category'] == 'type_de_lieu' for t in tags):
            warnings.append(f'Row {i} ({row["name"]}): no "Type de lieu" tag found — pin icon will fall back to 📍.')

        # "Déjà testé" is implicit (no tag) unless "To try" was present —
        # make it explicit in the review file so it's obvious what will be
        # imported, per SPEC.md's 3-state Statut filter.
        if not any(t['category'] == 'statut' for t in tags):
            tags.append({'category': 'statut', 'emoji': STATUS_TESTED_EMOJI, 'label': 'Déjà testé'})

        parsed.append({
            'row_index': i,
            'name': row['name'].strip(),
            'address': row['address'].strip(),
            'lat': lat,
            'lng': lng,
            'rating': rating,
            'top': comment_parts['top'],
            'bof': comment_parts['bof'],
            'remarks': comment_parts['remarks'],
            'comment': comment_parts['comment'],
            'date_added': row['date'].strip(),
            'tags': tags,
        })

    OUT_JSON.write_text(json.dumps({'places': parsed, 'warnings': warnings}, ensure_ascii=False, indent=2), encoding='utf-8')

    # Flattened CSV for quick human review (tags joined into one column).
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['row_index', 'name', 'address', 'lat', 'lng', 'rating', 'top', 'bof', 'remarks', 'comment', 'date_added', 'tags'])
        for p in parsed:
            tags_flat = ' | '.join(f"[{t['category']}] {t['emoji']} {t['label']}" for t in p['tags'])
            rating_out = '' if p['rating'] is None else p['rating']
            writer.writerow([p['row_index'], p['name'], p['address'], p['lat'], p['lng'], rating_out, p['top'], p['bof'], p['remarks'], p['comment'], p['date_added'], tags_flat])

    print(f'Parsed {len(parsed)} places ({len(EXCLUDED_ROWS)} excluded: {", ".join(name for _, name in EXCLUDED_ROWS)}).')
    print(f'Wrote {OUT_JSON.relative_to(REPO_ROOT)}')
    print(f'Wrote {OUT_CSV.relative_to(REPO_ROOT)}')
    if warnings:
        print(f'\n{len(warnings)} warning(s) — review these rows carefully:')
        for w in warnings:
            print(' -', w)


if __name__ == '__main__':
    main()
