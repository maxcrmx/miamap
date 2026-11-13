-- ============================================================================
-- keep_alive.sql — point d'appel du « ping » qui empêche la mise en pause
-- ============================================================================
-- POURQUOI
-- Supabase met en pause un projet Free qui ne reçoit pas assez d'activité
-- RÉELLE sur sa base pendant 7 jours. L'ancien ping (.github/workflows/
-- keep-alive.yml) lisait la table `places` sans être connecté : la base le
-- refusait (« permission denied for table places », c'est voulu, voir
-- schema.sql section 7), donc rien n'était vraiment exécuté et le projet a
-- quand même été mis en pause fin septembre 2026.
--
-- Ce fichier crée un point d'appel minuscule que le ping peut utiliser SANS
-- être connecté, et qui fait une vraie écriture en base (mise à jour d'une
-- date), sans jamais donner accès à tes lieux.
--
-- COMMENT L'UTILISER
-- Supabase → ton projet → SQL Editor → New query → colle ce fichier → Run.
-- Une seule fois. Sans risque à relancer.
-- ============================================================================

-- 1. Une table d'une seule ligne qui retient la date du dernier ping.
--    `check (id = 1)` interdit d'y ajouter d'autres lignes.
create table if not exists public.keep_alive (
  id         int primary key check (id = 1),
  pinged_at  timestamptz not null default now()
);

insert into public.keep_alive (id) values (1)
on conflict (id) do nothing;

-- RLS activée et AUCUNE policy : personne ne peut lire ni écrire cette table
-- directement par l'API. Seule la fonction ci-dessous y touche.
alter table public.keep_alive enable row level security;
revoke all on table public.keep_alive from anon, authenticated;

-- 2. La fonction appelée par le ping : elle met la date à jour et la renvoie.
--    SECURITY DEFINER = elle s'exécute avec les droits de son propriétaire,
--    ce qui lui permet d'écrire dans la table verrouillée ci-dessus alors
--    que l'appelant (anonyme) n'a, lui, aucun droit sur cette table.
--    Elle ne prend aucun paramètre et ne touche qu'à cette ligne : l'appeler
--    n'expose rien d'autre de la base.
create or replace function public.keep_alive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.keep_alive
  set pinged_at = now()
  where id = 1
  returning pinged_at;
$$;

-- 3. Seul le droit d'appeler cette fonction est donné aux visiteurs non
--    connectés (anon). Les tables de l'app restent fermées pour eux.
revoke all on function public.keep_alive() from public;
grant usage on schema public to anon;
grant execute on function public.keep_alive() to anon, authenticated;

-- 4. Vérification : doit afficher la date et l'heure de maintenant.
select public.keep_alive();
