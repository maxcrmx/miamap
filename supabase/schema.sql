-- ============================================================================
-- miamap — Supabase schema + Row Level Security (RLS) policies
-- ============================================================================
-- WHAT THIS FILE IS
-- This is the entire database setup for miamap. Paste this whole file into
-- the Supabase SQL editor (Project → SQL Editor → New query) and run it once.
-- It is safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE everywhere)
-- except for the two INSERT statements at the very bottom, which you should
-- only run once (see comments there).
--
-- WHY IT LOOKS THE WAY IT DOES
-- Two roles only: "admin" (you) and "reader" (people you invite). Nobody can
-- sign up on their own — an account only works if you (the admin) have
-- pre-created a row for that email in `profiles` first. Every table has RLS
-- enabled, so access rules are enforced by Postgres itself, not just by the
-- frontend JS (a reader could open dev tools and call Supabase directly —
-- RLS is what stops them from reading/writing things they shouldn't).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- ----------------------------------------------------------------------------
-- One row per person who is allowed to use the app. `user_id` starts out
-- NULL when you invite someone (they don't have a Supabase auth account yet)
-- and gets filled in automatically the first time they click their magic
-- link (see the trigger below). `is_active` is what "revoke" flips to false
-- — access is checked live against this column on every request, so revoking
-- takes effect immediately, not just on next login.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  email       text unique not null,
  role        text not null default 'reader' check (role in ('admin', 'reader')),
  is_active   boolean not null default true,
  invited_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bootstrap trigger: link a new auth.users row to a pre-existing profile.
-- ----------------------------------------------------------------------------
-- When someone clicks a magic link for the first time, Supabase creates a row
-- in the built-in `auth.users` table. This trigger fires right after that and
-- looks for a `profiles` row with the same email that's still waiting for a
-- user_id (i.e. an invite you created earlier). If found, it links them up.
-- If NOT found (nobody invited this email), nothing happens — the account
-- exists in auth.users but has no profile, so every RLS policy below denies
-- it access. This is what keeps signup invite-only without any extra code.
--
-- SECURITY DEFINER: runs with the privileges of the function owner (not the
-- calling user), which is required here because a brand-new user has no
-- rights of their own yet to update the profiles table.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set user_id = new.id
  where email = new.email
    and user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- Helper functions used inside RLS policies (SECURITY DEFINER so they can
-- read `profiles` without themselves being blocked by profiles' own RLS —
-- this avoids infinite recursion when a profiles policy needs to check
-- "is the current user an admin", which itself requires reading profiles).
-- ----------------------------------------------------------------------------
create or replace function public.is_active_profile()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_active = true and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

-- Anyone active can see their own row (to know their own role in the app UI).
-- Admins can see every row (needed for the Settings screen reader list).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (user_id = auth.uid() or public.is_admin());

-- Only the admin can create invites (insert a new profile row).
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert
  with check (public.is_admin());

-- Only the admin can edit profiles (e.g. flip is_active to revoke a reader).
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- Only the admin can delete a profile (remove an invite/reader entirely).
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 2. TAGS
-- ----------------------------------------------------------------------------
-- Every tag (place type, cuisine, special, price bracket, status) lives in
-- one table, distinguished by `category`. This keeps "create a custom tag"
-- generic instead of needing 5 near-identical tables.
-- ----------------------------------------------------------------------------
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('type_de_lieu', 'cuisine', 'special', 'prix', 'statut')),
  emoji       text not null,
  label       text not null,
  created_at  timestamptz not null default now(),
  unique (category, label)
);

alter table public.tags enable row level security;

-- Any signed-in, active user (admin or reader) can read the tag list —
-- readers need it to see tag names/emojis and to use the filter panel.
drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags
  for select
  using (public.is_active_profile());

-- Only the admin can create/edit/delete tags (including the inline
-- "create a custom tag" flow in the add/edit place form).
drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags
  for insert
  with check (public.is_admin());

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags
  for delete
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 3. PLACES
-- ----------------------------------------------------------------------------
create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text not null,
  lat         double precision not null,
  lng         double precision not null,
  -- Rating is 0–5 in 0.5 steps, e.g. 3.5. NULL means "no rating yet" (the
  -- normal state for a "à tester" place that hasn't been visited) — this
  -- is deliberately NOT NULL-constrained with a 0 default, because 0 would
  -- mean "visited and rated zero", a different fact. A Postgres check
  -- constraint automatically passes when the value is NULL, so no extra
  -- handling is needed for that case here.
  rating      numeric(2, 1) check (rating >= 0 and rating <= 5 and (rating * 2) = round(rating * 2)),
  top         text not null default '',      -- "Les 👍" — what's great
  bof         text not null default '',      -- "Les 🤷" — what's meh
  remarks     text not null default '',      -- "Remarque" — general notes
  comment     text not null default '',      -- free text, unused for now, kept for future use
  -- Website + phone, fetched ONCE from Google Places when the place is
  -- added/edited (js/place-form.js) and stored here, so opening a place
  -- sheet costs zero Places API calls. Empty string = "not found at save
  -- time" — the sheet then shows the matching action button disabled.
  website     text not null default '',
  phone       text not null default '',
  -- Identifiant Google du lieu, récupéré dans la même requête Places que
  -- ci-dessus. Sert au bouton "Y aller" de la fiche, qui ouvre la FICHE
  -- Google Maps (/maps/place/?q=place_id:…) plutôt qu'un itinéraire — une
  -- URL d'itinéraire peut être détournée vers une appli de navigation tierce.
  google_place_id text not null default '',
  date_added  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Safe to re-run even if you already ran an earlier version of this file
-- that had `rating not null default 0` — this brings an existing table in
-- line with the corrected nullable version above without needing to drop it.
alter table public.places alter column rating drop not null;
alter table public.places alter column rating drop default;

alter table public.places enable row level security;

-- Any signed-in, active user can read all places (admin + readers both get
-- full read access — only writes are admin-restricted).
drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select
  using (public.is_active_profile());

drop policy if exists places_insert on public.places;
create policy places_insert on public.places
  for insert
  with check (public.is_admin());

drop policy if exists places_update on public.places;
create policy places_update on public.places
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists places_delete on public.places;
create policy places_delete on public.places
  for delete
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 4. PLACE_TAGS (join table between places and tags)
-- ----------------------------------------------------------------------------
-- `added_at` records insertion order. This is what lets the app compute
-- "the map pin icon = the emoji of the first Type de lieu tag added to this
-- place" (see SPEC.md "Pin icon logic") without needing a separate
-- ordering column that could get out of sync.
-- ----------------------------------------------------------------------------
create table if not exists public.place_tags (
  place_id  uuid not null references public.places (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (place_id, tag_id)
);

alter table public.place_tags enable row level security;

drop policy if exists place_tags_select on public.place_tags;
create policy place_tags_select on public.place_tags
  for select
  using (public.is_active_profile());

drop policy if exists place_tags_insert on public.place_tags;
create policy place_tags_insert on public.place_tags
  for insert
  with check (public.is_admin());

drop policy if exists place_tags_update on public.place_tags;
create policy place_tags_update on public.place_tags
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists place_tags_delete on public.place_tags;
create policy place_tags_delete on public.place_tags
  for delete
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 5. Keep `updated_at` current on every edit
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 6. SEED DATA — run once
-- ============================================================================
-- 6a. Starter tags, matching the categories/labels listed in SPEC.md. The
-- admin can add more later from the add/edit place form (inline "new tag"),
-- and the mapstr import script will also create any missing ones.
-- Safe to re-run: `on conflict do nothing` skips tags that already exist.
-- ----------------------------------------------------------------------------
insert into public.tags (category, emoji, label) values
  -- Type de lieu
  ('type_de_lieu', '🍽️', 'Restaurant'),
  ('type_de_lieu', '☕️', 'Café'),
  ('type_de_lieu', '🍻', 'Bar'),
  ('type_de_lieu', '🥖', 'Boulangerie'),
  ('type_de_lieu', '🍰', 'Pâtisserie'),
  ('type_de_lieu', '🍦', 'Glacier'),
  ('type_de_lieu', '🥡', 'Mercado'),
  ('type_de_lieu', '🥞', 'Crêperie'),
  ('type_de_lieu', '🧀', 'Fromagerie'),

  -- Cuisine
  ('cuisine', '🇮🇹', 'Italien'),
  ('cuisine', '🇲🇽', 'Mexicain'),
  ('cuisine', '🇯🇵', 'Japonais'),
  ('cuisine', '🇫🇷', 'Français'),
  ('cuisine', '🇰🇷', 'Coréen'),
  ('cuisine', '🇨🇳', 'Chinois'),
  ('cuisine', '🇮🇳', 'Indien'),
  ('cuisine', '🇹🇭', 'Thaï'),
  ('cuisine', '🇱🇧', 'Libanais'),
  ('cuisine', '🇪🇸', 'Espagnol'),
  ('cuisine', '🇬🇷', 'Grecque'),
  ('cuisine', '🇹🇷', 'Turque'),
  ('cuisine', '🇻🇳', 'Vietnamien'),
  ('cuisine', '🇺🇸', 'Américain'),
  ('cuisine', '🇩🇪', 'Allemand'),
  ('cuisine', '🇳🇱', 'Hollandais'),
  ('cuisine', '🇸🇪', 'Suédois'),
  ('cuisine', '🇦🇷', 'Argentin'),
  ('cuisine', '🇨🇦', 'Canadien'),
  ('cuisine', '🇨🇾', 'Chypriote'),
  ('cuisine', '🇦🇲', 'Arménien'),
  ('cuisine', '🇭🇳', 'Hondurien'),
  ('cuisine', '🇭🇷', 'Croate'),
  ('cuisine', '🇳🇮', 'Nicaraguayen'),
  ('cuisine', '🇸🇻', 'Salvadorien'),
  ('cuisine', '🇹🇼', 'Taïwanais'),
  ('cuisine', '🇪🇹', 'Ethiopien'),
  ('cuisine', '🇮🇩', 'Indonésien'),
  ('cuisine', '🌏', 'Asiatique'),
  ('cuisine', '🌞', 'Méditerranéen'),
  ('cuisine', '🥙', 'Levant'),

  -- Spécial
  ('special', '🥪', 'Sandwich'),
  ('special', '🥭', 'Bowl'),
  ('special', '🍕', 'Pizza'),
  ('special', '🍳', 'Brunch'),
  ('special', '🍔', 'Burger'),
  ('special', '🥑', 'Trendy'),
  ('special', '🌱', 'Végétarien'),
  ('special', '🌿', 'Vegan'),
  ('special', '⚓️', 'Poissons et fruits de mer'),
  ('special', '👐', 'À partager'),
  ('special', '🏳️‍🌈', 'Queer-friendly'),
  ('special', '🌾', 'Sans gluten'),
  ('special', '🏤', 'Rooftop'),

  -- Prix
  ('prix', '💶', '< 5€'),
  ('prix', '💶', '< 10€'),
  ('prix', '💶', '10 - 15€'),
  ('prix', '💶', '15 - 20€'),
  ('prix', '💶', '20 - 25€'),
  ('prix', '💶', '25 - 40€'),
  ('prix', '💶', '40 - 60€'),
  ('prix', '💶', '60 - 80€'),

  -- Statut
  ('statut', '✅', 'Déjà testé'),
  ('statut', '🕐', 'À tester')
on conflict (category, label) do nothing;

-- ----------------------------------------------------------------------------
-- 6b. Grant yourself admin access. Replace the email below if needed, then
-- run this once. This is the ONLY place an identity is tied to a specific
-- email — everywhere else (app code, RLS policies) only checks the `role`
-- column, so adding a second admin later is just another row here.
-- ----------------------------------------------------------------------------
insert into public.profiles (email, role, is_active)
values ('cremieux.maxime@gmail.com', 'admin', true)
on conflict (email) do update set role = 'admin', is_active = true;


-- ============================================================================
-- 7. TABLE PRIVILEGES (GRANTs)
-- ============================================================================
-- Postgres enforces access in TWO independent layers, and BOTH must pass:
--   1. GRANT   — "may this role touch this table at all?" (SQL-level)
--   2. RLS     — "which rows may it see/change?"          (row-level)
-- Everything above only configures layer 2. Without layer 1, every query
-- fails with: 42501 "permission denied for table ...", no matter how
-- permissive the policies are.
--
-- Supabase normally issues these grants automatically for new tables. That
-- automation is off on this project ("Automatically expose new tables"
-- unchecked, a deliberate choice to control access manually), so they are
-- declared explicitly here.
--
-- `authenticated` = any logged-in user. `anon` (not logged in) is granted
-- NOTHING on purpose: this app requires a session for every read and write,
-- and no query runs before login. The RLS policies would block anonymous
-- access anyway, but withholding the grant keeps the two layers consistent.
--
-- Withholding is not sufficient, though — see the REVOKE below.
--
-- Privileges are kept to exactly what the app performs (see js/db.js,
-- js/tags.js, js/settings.js). Some policies above anticipate operations the
-- UI doesn't do yet — deleting a profile — so those are intentionally NOT
-- granted. Add the grant here if the feature is built.
-- ----------------------------------------------------------------------------

-- Required before any table in the schema is reachable at all.
grant usage on schema public to authenticated;

-- profiles: read own/all profiles, invite readers (upsert = insert+update),
-- revoke readers (update).
grant select, insert, update on public.profiles to authenticated;

-- tags: everyone reads the tag list; admins create custom tags, and rename or
-- delete them from the filter panel (long-press on a pill — js/filters.js).
-- Deleting a tag also clears its place_tags rows through the FK's `on delete
-- cascade`; that needs no extra privilege, since a referential action runs
-- with the rights of the referenced table's owner, not the caller's.
grant select, insert, update, delete on public.tags to authenticated;

-- places: full CRUD (writes are admin-only via RLS).
grant select, insert, update, delete on public.places to authenticated;

-- place_tags: read (nested in the places query), plus replace-on-save,
-- which deletes the old rows and inserts the new ones.
grant select, insert, delete on public.place_tags to authenticated;

-- The RLS policies call these helpers. Postgres grants EXECUTE to PUBLIC by
-- default, but this project's non-default privilege setup makes it worth
-- stating explicitly rather than relying on that default.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_profile() to authenticated;

-- NOTE: no `alter default privileges` here to GRANT anything, on purpose. Any
-- table added later will again have no grants until it's added above — which
-- is the manual control this project opted into.

-- ----------------------------------------------------------------------------
-- 7b. REVOKE — `anon` does not start empty.
-- ----------------------------------------------------------------------------
-- Supabase bootstraps every project with
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
-- so each table created above is born holding all seven privileges for anon,
-- regardless of the fact that this file grants it nothing. Simply not granting
-- is therefore not the same as anon having nothing.
--
-- The one that matters is TRUNCATE. RLS filters SELECT / INSERT / UPDATE /
-- DELETE; it does NOT filter TRUNCATE — Postgres has no way to express
-- "truncate these rows only", so none of the policies above are consulted. A
-- role holding TRUNCATE empties the entire table whatever the policies say.
-- REFERENCES and TRIGGER are harmless here but are revoked in the same sweep.
revoke all on table
  public.profiles,
  public.places,
  public.tags,
  public.place_tags
from anon;

-- Same rule applied to whatever gets added next: new tables start closed for
-- anon instead of relying on someone remembering to revoke. This only affects
-- the default ACL owned by the role that runs it (`postgres` in the SQL
-- editor); check pg_default_acl for others.
alter default privileges in schema public revoke all on tables from anon;
