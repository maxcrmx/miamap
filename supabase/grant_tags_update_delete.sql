-- ============================================================================
-- grant_tags_update_delete.sql — fix for: 42501 "permission denied for
-- table tags" lors du renommage/suppression d'un tag depuis le panneau
-- filtres (appui long sur une pilule).
-- ============================================================================
-- À exécuter UNE FOIS dans le SQL Editor Supabase. Ce script ne crée ni ne
-- supprime rien : il ne distribue que des privilèges de table, aucune donnée
-- n'est touchée et le relancer est sans effet.
--
-- CE N'EST PAS UN PROBLÈME DE RLS. Postgres contrôle l'accès en deux couches
-- indépendantes, qui doivent TOUTES DEUX passer :
--   1. GRANT — « ce rôle a-t-il le droit de toucher cette table ? » (SQL)
--   2. RLS   — « quelles lignes peut-il voir/modifier ? »           (ligne)
-- Les policies `tags_update` et `tags_delete` existent depuis le début
-- (schema.sql, section 2) : la couche 2 était donc déjà bonne. En revanche
-- la couche 1 n'accordait que `select, insert` sur `tags`, volontairement —
-- le commentaire de la section 7 de schema.sql disait « éditer/supprimer un
-- tag n'est pas encore fait par l'UI, ajouter le grant quand la
-- fonctionnalité existera ». Elle existe maintenant.
--
-- Un refus RLS produit un message différent (« new row violates row-level
-- security policy ») ou zéro ligne modifiée sans erreur ; « permission denied
-- for table » vient toujours de la couche GRANT.
--
-- Ces privilèges sont désormais aussi dans schema.sql (section 7), donc un
-- projet recréé de zéro n'aura pas à rejouer ce fichier.
--
-- Note : la suppression d'un tag efface aussi ses lignes dans `place_tags`
-- via le `on delete cascade` de la clé étrangère. Aucun privilège
-- supplémentaire n'est nécessaire pour ça — une action référentielle en
-- cascade s'exécute avec les droits du propriétaire de la table référencée,
-- pas avec ceux de l'appelant.
-- ============================================================================

-- L'écriture reste réservée à l'admin : c'est la couche RLS (policies
-- tags_update / tags_delete, toutes deux en `using (public.is_admin())`) qui
-- l'impose. Le grant ci-dessous ouvre seulement la porte au rôle
-- `authenticated` ; un lecteur non-admin continuera de se voir refuser
-- l'opération, mais par les policies.
grant update, delete on public.tags to authenticated;


-- ----------------------------------------------------------------------------
-- VÉRIFICATION 1 — les privilèges effectivement posés sur `tags`.
-- Attendu pour `authenticated` : DELETE, INSERT, SELECT, UPDATE.
-- Attendu pour `anon` : aucune ligne.
-- ----------------------------------------------------------------------------
select
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'tags'
  and grantee in ('authenticated', 'anon')
group by grantee
order by grantee;


-- ----------------------------------------------------------------------------
-- VÉRIFICATION 2 — les policies RLS de `tags`, pour confirmer que la couche
-- 2 était bien en place (c'est la requête de diagnostic demandée).
-- Attendu : 4 lignes — tags_select (SELECT), tags_insert (INSERT),
-- tags_update (UPDATE), tags_delete (DELETE).
-- ----------------------------------------------------------------------------
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'tags'
order by cmd, policyname;
