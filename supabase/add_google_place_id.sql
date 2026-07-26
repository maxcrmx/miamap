-- ============================================================================
-- add_google_place_id.sql — migration : colonne google_place_id sur `places`.
-- ============================================================================
-- À exécuter UNE FOIS sur le projet existant (SQL Editor). Sans risque et
-- re-jouable : IF NOT EXISTS, aucune donnée touchée.
--
-- POURQUOI : le bouton "Y aller" de la fiche lieu construisait une URL de
-- type /maps/dir/ (itinéraire), que le système peut détourner vers une appli
-- de navigation tierce (Waze, Plans…). On veut ouvrir la FICHE Google Maps
-- du lieu, ce qui demande son identifiant Google :
--   https://www.google.com/maps/place/?q=place_id:XXX
--
-- L'identifiant est récupéré au moment de l'ajout/édition du lieu, dans la
-- même requête Google Places que l'adresse, le site web et le téléphone
-- (js/place-form.js) — donc aucun appel supplémentaire.
--
-- Chaîne vide = lieu ajouté avant cette migration : la fiche retombe alors
-- sur une URL de recherche Google Maps (qui ouvre bien une fiche de lieu, pas
-- un itinéraire). Rééditer le lieu renseigne l'identifiant.
--
-- Cette colonne est aussi dans schema.sql pour un projet créé de zéro.
-- Aucun GRANT à ajouter : les privilèges portent sur la table entière.
-- ============================================================================

alter table public.places add column if not exists google_place_id text not null default '';

-- ----------------------------------------------------------------------------
-- VÉRIFICATION — attendu : une ligne, type text, default ''::text,
-- is_nullable NO.
-- ----------------------------------------------------------------------------
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'places'
  and column_name = 'google_place_id';
