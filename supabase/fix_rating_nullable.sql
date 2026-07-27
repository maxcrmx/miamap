-- ============================================================================
-- fix_rating_nullable.sql — migration : s'assurer que `places.rating` accepte
-- NULL, sans valeur par défaut.
-- ============================================================================
-- À exécuter UNE FOIS sur le projet existant (SQL Editor). Sans risque et
-- re-jouable : ALTER COLUMN DROP NOT NULL/DEFAULT sont des no-ops si déjà
-- appliqués, aucune donnée touchée.
--
-- POURQUOI : enregistrer un lieu au statut "À tester" (pas encore noté) sans
-- note échouait avec une erreur Supabase. schema.sql définit bien `rating`
-- comme nullable sans défaut depuis le départ (NULL = "pas encore noté",
-- différent de 0 = "testé et noté zéro"), mais si la table `places` a été
-- créée sur ce projet AVANT cette définition (ou via un état intermédiaire),
-- la colonne peut être restée `not null default 0` côté base réelle même si
-- schema.sql a toujours été correct dans le dépôt. Ce script réaligne la
-- base sur schema.sql, indépendamment de son état actuel.
-- ============================================================================

alter table public.places alter column rating drop not null;
alter table public.places alter column rating drop default;

-- ----------------------------------------------------------------------------
-- VÉRIFICATION — attendu : is_nullable = YES, column_default = null.
-- ----------------------------------------------------------------------------
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'places'
  and column_name = 'rating';
