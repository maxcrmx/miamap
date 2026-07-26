-- ============================================================================
-- add_website_phone.sql — migration : colonnes website + phone sur `places`.
-- ============================================================================
-- À exécuter UNE FOIS sur le projet existant (SQL Editor). Sans risque et
-- re-jouable : IF NOT EXISTS, aucune donnée touchée.
--
-- POURQUOI : la fiche lieu affichait Site web / Appeler en interrogeant
-- Google Places à CHAQUE ouverture (2 requêtes par fiche). Ces infos sont
-- désormais récupérées une seule fois au moment de l'ajout/édition du lieu
-- (js/place-form.js) et stockées ici. Chaîne vide = introuvable lors de la
-- sauvegarde → le bouton correspondant reste grisé sur la fiche.
--
-- Ces colonnes sont aussi dans schema.sql pour un projet créé de zéro.
-- Aucun GRANT à ajouter : les privilèges existants portent sur la table
-- entière, pas sur des colonnes.
-- ============================================================================

alter table public.places add column if not exists website text not null default '';
alter table public.places add column if not exists phone   text not null default '';

-- ----------------------------------------------------------------------------
-- VÉRIFICATION — attendu : deux lignes (website, phone), type text,
-- default ''::text, is_nullable NO.
-- ----------------------------------------------------------------------------
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'places'
  and column_name in ('website', 'phone');
