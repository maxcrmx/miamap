-- ============================================================================
-- link_profile.sql — diagnose & repair the "login succeeds but the app stays
-- on the login screen" bug.
-- ============================================================================
-- THE PROBLEM THIS FIXES
-- Logging in creates a row in Supabase's built-in `auth.users` table. The app
-- then looks up `public.profiles` WHERE user_id = auth.uid() to find out your
-- role. If no row matches, you are authenticated but have no profile, so the
-- app treats you as unauthorized — silently, in the original version.
--
-- `profiles.user_id` is normally filled in by the on_auth_user_created trigger
-- (see schema.sql), which fires when a NEW row is inserted into auth.users.
-- It does nothing in two very common situations:
--   1. Your auth.users row already existed BEFORE you ran schema.sql (i.e. you
--      had already requested a magic link at least once) — the trigger fired
--      back then, when no profiles row existed yet to link to.
--   2. Creating a trigger on auth.users failed with a permissions error
--      ("must be owner of relation users") when you ran schema.sql, which is
--      easy to miss in the SQL editor output.
-- Either way the profile row stays with user_id = NULL forever.
--
-- Run STEP 1 to see the state, then STEP 2 to repair it.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Diagnose (read-only, safe to run any time)
-- ----------------------------------------------------------------------------
-- Compares every profile against every auth account, matching on email, and
-- tells you exactly what's wrong. A FULL OUTER JOIN is used so you also see
-- accounts that exist on only one side.
-- ----------------------------------------------------------------------------
select
  coalesce(p.email, u.email)          as email,
  p.role,
  p.is_active,
  p.user_id                           as profil_user_id,
  u.id                                as compte_auth_id,
  u.email_confirmed_at,
  case
    when p.id is null then
      'PAS DE PROFIL — ce compte auth n''a aucune ligne dans profiles (jamais invité)'
    when u.id is null then
      'PAS DE COMPTE AUTH — le profil existe mais personne ne s''est jamais connecté avec cette adresse'
    when p.user_id is null then
      'NON LIÉ  <-- C''EST LE BUG : lance l''ÉTAPE 2 ci-dessous'
    when p.user_id = u.id then
      'OK — correctement lié, la connexion doit fonctionner'
    else
      'INCOHÉRENT — profiles.user_id pointe vers un autre compte auth'
  end                                 as diagnostic
from public.profiles p
full outer join auth.users u
  on lower(u.email) = lower(p.email)
order by email;


-- ----------------------------------------------------------------------------
-- STEP 2 — Repair
-- ----------------------------------------------------------------------------
-- Links every unlinked profile to its matching auth account by email.
-- Idempotent: only touches rows where user_id is still NULL, so re-running it
-- is harmless. Emails are compared case-insensitively because GoTrue stores
-- addresses lowercased while a profile may have been inserted with other casing.
-- ----------------------------------------------------------------------------
update public.profiles p
set user_id = u.id
from auth.users u
where lower(u.email) = lower(p.email)
  and p.user_id is null;

-- Re-run STEP 1 afterwards: every row you care about should now read "OK".
