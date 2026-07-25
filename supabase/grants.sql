-- ============================================================================
-- grants.sql — fix for: 42501 "permission denied for table profiles"
-- ============================================================================
-- Run this ONCE on the existing project. It creates nothing and drops
-- nothing — it only hands out table privileges, so no data is touched and
-- re-running it is harmless.
--
-- WHY THIS IS NEEDED
-- Postgres checks access in two independent layers, and BOTH must pass:
--   1. GRANT — "may this role touch this table at all?" (SQL-level)
--   2. RLS   — "which rows may it see/change?"          (row-level)
-- schema.sql configured layer 2 (policies) but relied on Supabase to issue
-- layer 1 automatically. With "Automatically expose new tables" unchecked,
-- that never happened — so every query failed with 42501 regardless of how
-- correct the policies were.
--
-- These same statements are now also part of schema.sql (section 7), so a
-- fresh project set up from scratch won't hit this again.
--
-- `anon` (not logged in) is deliberately granted nothing: this app requires
-- a session for every read and write. Note that "granting nothing" is not
-- enough on a Supabase project — anon starts out holding privileges that have
-- to be revoked. See section 0 below.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. REVOKE — take back what `anon` holds by default.
-- ----------------------------------------------------------------------------
-- Nothing in this repo ever granted anon anything, yet a privilege audit found
-- REFERENCES, TRIGGER and TRUNCATE on all four tables. Those come from the
-- platform, not from this script: Supabase bootstraps every project with
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so each table is *born* holding all seven privileges for anon. The four DML
-- ones (select/insert/update/delete) were stripped on this project; the other
-- three survived because they are the ones nobody thinks to look at.
--
-- REFERENCES and TRIGGER are harmless here (both also require ownership or
-- another privilege to actually be used). TRUNCATE is not:
--
--   RLS filters SELECT / INSERT / UPDATE / DELETE. It does NOT filter
--   TRUNCATE — Postgres has no notion of "truncate these rows only", so the
--   policies below are simply not consulted. A role holding TRUNCATE empties
--   the whole table no matter what the policies say.
--
-- In practice PostgREST exposes no verb that emits TRUNCATE, and `anon` is a
-- NOLOGIN role only reachable through PostgREST's SET ROLE, so this is not
-- remotely reachable as things stand. It becomes reachable the moment any
-- SECURITY INVOKER function callable by anon builds dynamic SQL. Revoking it
-- costs nothing and removes the question entirely.
--
-- `revoke all` rather than `revoke truncate`: it also clears REFERENCES and
-- TRIGGER, which is what makes the verification query at the bottom return
-- zero rows for anon — the stated intent of this file. Re-running is harmless.
revoke all on table
  public.profiles,
  public.places,
  public.tags,
  public.place_tags
from anon;

-- Stops the next table added to `public` from being born with the same
-- privileges. Section 7 of schema.sql deliberately avoids `alter default
-- privileges` for GRANTs (new tables should start closed and be opened by
-- hand); revoking is the same policy, enforced by default instead of by
-- memory.
--
-- CAVEAT: this only neutralises the default ACL owned by the role that runs
-- it — `postgres` in the SQL editor. If Supabase also registered one under
-- `supabase_admin`, that one persists and `postgres` may not be allowed to
-- alter it. The pg_default_acl query at the bottom shows which ones exist.
alter default privileges in schema public revoke all on tables from anon;
-- ============================================================================

-- Without this, nothing in the schema is reachable at all.
grant usage on schema public to authenticated;

-- profiles: read own/all profiles, invite readers (upsert = insert + update),
-- revoke readers (update). This is the grant whose absence caused the
-- "permission denied for table profiles" error at login.
grant select, insert, update on public.profiles to authenticated;

-- tags: everyone reads the tag list; admins create custom tags.
grant select, insert on public.tags to authenticated;

-- places: full CRUD (writes stay admin-only, enforced by the RLS policies).
grant select, insert, update, delete on public.places to authenticated;

-- place_tags: read (nested inside the places query), plus replace-on-save,
-- which deletes the old rows then inserts the new ones.
grant select, insert, delete on public.place_tags to authenticated;

-- The RLS policies call these helpers on every request.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_profile() to authenticated;


-- ----------------------------------------------------------------------------
-- VERIFICATION 1 — who was granted what, explicitly.
-- Expect exactly the privileges listed in the comments above for
-- `authenticated`, and no rows at all for `anon`.
-- ----------------------------------------------------------------------------
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'tags', 'places', 'place_tags')
  and grantee in ('authenticated', 'anon')
group by table_name, grantee
order by table_name, grantee;


-- ----------------------------------------------------------------------------
-- VERIFICATION 2 — what anon can EFFECTIVELY do. Run this one too.
-- ----------------------------------------------------------------------------
-- Verification 1 alone is not proof. `role_table_grants` lists grants made to
-- a named grantee; it does not show privileges anon holds via a grant to
-- PUBLIC, nor via membership in another role. A table could show zero rows
-- above and still be truncatable by anon.
--
-- has_table_privilege answers the real question — it resolves PUBLIC and role
-- inheritance the same way the executor does at query time.
--
-- EXPECTED RESULT: zero rows. Any row is a privilege anon actually holds.
select
  t.table_name,
  p.priv as anon_still_holds
from (values ('profiles'), ('places'), ('tags'), ('place_tags')) as t(table_name),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
where has_table_privilege('anon', format('public.%I', t.table_name), p.priv)
order by t.table_name, p.priv;


-- ----------------------------------------------------------------------------
-- VERIFICATION 3 — where the privileges came from (diagnostic, not a check).
-- ----------------------------------------------------------------------------
-- Lists the default-privilege rules still registered on `public`. Any entry
-- whose ACL mentions anon= is what re-arms this problem on the next table.
-- The ACL letters that matter: a=INSERT r=SELECT w=UPDATE d=DELETE
-- D=TRUNCATE x=REFERENCES t=TRIGGER.
select
  pg_get_userbyid(d.defaclrole) as set_by_role,
  d.defaclobjtype              as object_type,   -- 'r' = tables
  d.defaclacl                  as default_acl
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public';
