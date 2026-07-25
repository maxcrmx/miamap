# miamap — Product & Technical Spec

## Context

This is a personal replacement for Mapstr (a "save your favorite places" app), which became paid beyond 300 saved addresses. We are rebuilding it as a lightweight, self-hosted PWA.

**Current repo state (already in place, do not discard):**
- `index.html` — working POC: yellow landing screen → button → address search screen with a live Google Maps map. Already deployed on GitHub Pages.
- `manifest.json`, `icon.png` — PWA install support (fullscreen on iOS home screen).
- `mapstr.csv`, `mapstr.geojson` — the raw export of 307 places from Mapstr. This is real user data to import, not a sample.

**Hosting:** GitHub Pages (static site). No Next.js, no build step, no bundler — plain HTML/CSS/JS, same approach as the existing `index.html`. Load the Supabase JS SDK via `<script>` tag (like the Google Maps script already in `index.html`), not via npm/SSR.

**Stack:**
- Frontend: vanilla HTML/CSS/JS (or minimal, no-build setup if you have a strong reason — but default to vanilla)
- Maps: Google Maps JavaScript API (key already wired in `index.html`)
- Backend/data: Supabase (Postgres + Auth + Row Level Security). Project already created.
  - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` will be provided separately by the user (do not hardcode placeholder values — ask for them if not present in the repo).

**Code quality requirement (important):** Write clear, well-commented code. Every file must start with a short comment block explaining what the file does and why it exists. Add inline comments wherever logic isn't self-evident (RLS policies, filter logic, parsing logic especially). The user is a non-developer product owner who will read this code later — optimize for readability over cleverness.

---

## Roles & Auth

Two roles only, for now:

- **Admin** (the app owner): full read + write (add/edit/delete places) + can manage readers (invite/revoke) via a Settings screen.
- **Reader**: read-only access to everything except Settings, which is hidden/blocked for them.

**Auth mechanism:** Supabase Magic Link (email-based passwordless login) for both roles. No custom password/code system.

- A `profiles` table (linked to Supabase `auth.users`) stores a `role` column (`admin` / `reader`). The admin's role is set based on a known admin email at signup/first login — do not hardcode identity checks by email string throughout the app; check `role` via RLS policies instead.
- Revoking a reader must take effect immediately (their access is checked against `profiles`/an active-status flag on every request, not cached client-side).
- A magic link is tied to the email it was sent to — no separate custom "single-use code" system needed, Supabase's own magic link mechanism covers this requirement (one link per reader invite, sent by the admin from Settings).
- RLS should be enabled on all tables. Reads and writes must be enforced server-side (policies), never trusted from client-side checks alone.

---

## Data Model (places)

Each place has:

- `name`, `address` (with lat/lng from geocoding), `date_added`
- **Rating**: 0 to 5 (0.5 increments), stored as a number — filterable via a range (two-handle slider)
- **5 review fields** (replacing Mapstr's single free-text comment):
  - `top` — what's great about the place
  - `bof` — what's meh
  - `remarks` — general notes
  - `note` — this is the same numeric rating above, not a separate text field (clarify with user if ambiguous — in the original spec "Note" in the 5-field list refers to the rating field)
  - `comment` — free text, currently unused but keep the field for future use
- **Tags**, grouped into categories. A place can have any number of tags per category, no cap.

### Tag categories

1. **Type de lieu** (place type) — e.g. Restaurant, Café, Bar, Boulangerie, Pâtisserie, Glacier, Mercado, Crêperie, Fromagerie
2. **Cuisine** — ~28 individual country/origin cuisines (Italien, Mexicain, Japonais, Français, Coréen, Chinois, Indien, Thaï, Libanais, etc.) plus Asiatique, Méditerranéen, Levantine. Keep every cuisine as its own tag, even low-frequency ones — do not merge into "other".
3. **Spécial** — Sandwich, Bowl, Pizza, Brunch, Burger, Trendy, Végétarien, Vegan, Poissons et fruits de mer, À partager, Queer-friendly, Sans gluten, Rooftop
4. **Prix** (price) — dropdown/select, not a slider: <5€, <10€, 10-15€, 15-20€, 20-25€, 25-40€, 40-60€, 60-80€
5. **Statut** (status) — binary: "déjà testé" (visited) vs "à tester" (to try). Filterable as 3 states: visited only / to-try only / all.

**Custom tags:** the admin can create a new tag on the fly, in any category, by entering an emoji + a name. When creating a **Type de lieu** tag specifically, the emoji chosen becomes available as a pin icon.

**Pin icon logic:** a place's map pin icon = the emoji of the *first* "Type de lieu" tag added to that place (not the first tag overall across all categories).

---

## Filtering logic

- Filters are grouped by category (Type de lieu, Cuisine, Spécial, Prix, Note, Statut).
- **Within a category**: OR logic (e.g. selecting "Italien" + "Mexicain" under Cuisine shows places matching either).
- **Across categories**: AND logic (e.g. Cuisine filter AND Prix filter AND Statut filter must all match).
- No user-facing AND/OR toggle needed — this fixed logic (OR within category, AND across categories) is the only mode.
- A name search bar (searching place names) should work in both map view and list view, on top of the category filters.

---

## Screens & UX flow

1. **Auth screen**: Magic Link email input. Skipped automatically on future visits if the session is still valid.
2. **Map screen** (main screen):
   - Google Map centered on the user's geolocation on open; falls back to Paris center if geolocation is denied.
   - All matching pins shown (filtered by active filters + search).
   - Pins cluster when zoomed out and close together: a light grey filled circle showing the count of aggregated places.
   - Pin design: icon = place type emoji; circle divided into colored slices representing the place's tags; a small badge in the top-right corner of the pin if status = "to try".
   - Top-left button opens a filter side panel (covers half the screen width), light grey background, listing all filter categories (order: Type de lieu, Cuisine, Spécial, Prix, Note as a two-handle 0–5 slider, Statut). Tags within a category are alphabetically sorted, ignoring any leading emoji.
   - Map updates live as filters/search change.
   - Top-right button toggles to a **list view** of the same filtered results, sortable by distance, rating, or price (not by type/cuisine/special, since those aren't ordinal).
   - Bottom white bar, persistent on the map screen, with a large yellow "+" button to add a place, and a gear icon (admin only) opening Settings.
3. **Place detail** (tap a pin or list item): opens as a sheet covering 3/4 of the screen height. Swipe down from the top to dismiss. Shows all place info (tags, rating, the 5 fields). A button at the top opens the place's Google Maps listing in a new tab/app (external link, not embedded). An "Edit" button (admin only) reopens the add/edit form pre-filled. A "Delete" button (admin only) asks for confirmation before deleting.
4. **Add/Edit place form** (admin only, opened by "+" or "Edit"):
   - Address field with live Google Places autocomplete as the admin types, to ensure a valid geocoded address.
     - If no results: show "aucun lieu trouvé".
     - If ambiguous (multiple matches): show a scrollable list of the top 4-5 suggestions to pick from.
   - Tag selection per category: click to add a tag; supports creating a new tag (emoji + name) inline within a category.
   - The 5 review fields (top / bof / remarks / rating / comment).
   - Save button → writes to Supabase, place appears on the map immediately.
5. **Settings screen** (admin only, gear icon): list of current readers with a revoke button next to each; a field to invite a new reader by email (triggers a Supabase magic link to that email, assigning them the `reader` role on first login).

---

## Data import (one-time, 307 places)

`mapstr.csv` and `mapstr.geojson` in the repo contain the real export. The original Mapstr `userComment` field is unstructured free text using markers like "Les 👍 :", "Les 🤷‍♂️ :", "Remarque 💭 :", "Note ⭐️ :" — write a parsing script that splits this into the `top` / `bof` / `remarks` / rating fields automatically. The existing `tags` column (hash-separated, e.g. `🍽️ Restaurant#🇮🇹 Italien#< 10€#⭐️ 4/5`) should be split and mapped into the categories above.

**Important:** before writing parsed data into Supabase, output the parsed result to a reviewable file (e.g. a CSV or a readable JSON) so the admin can check/correct entries first. Do not auto-import directly into the live database — build this as a two-step process: (1) parse + export for review, (2) a separate import step that reads the reviewed/corrected file into Supabase.

---

## Explicitly out of scope for v1

- Photos (Mapstr export has a photos column — ignore it; the Google Maps external link covers this need)
- Offline support
- Multi-writer / self-service signup (future idea, not now — architecture should not preclude it later, but don't build it now)
- Rate limiting, 2FA, audit logs — not needed at this scale

---

## Suggested build order

1. Supabase schema: `profiles`, `places`, `place_tags` (or similar normalized structure), tag category/tag tables. Enable RLS on all.
2. RLS policies: reads open to any authenticated user (admin + readers); writes restricted to the admin's user id (via `profiles.role = 'admin'`); reader invite/revoke restricted to admin.
3. Auth flow: Magic Link wiring, session persistence, role detection.
4. Map screen + filters + list view, wired to Supabase reads.
5. Add/Edit/Delete flow, wired to Supabase writes.
6. Settings screen (invite/revoke readers).
7. Parsing script for the 307 places → reviewable export file.
8. Import step from the reviewed file into Supabase.
9. Security review pass (this step may be done with a stronger model — flag it clearly rather than doing it silently).

Ask the user for `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the admin's email before starting step 1, if not already available in the repo.
