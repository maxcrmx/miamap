-- ============================================================================
-- fix_tags_before_import.sql — deux corrections de tags, à passer AVANT
-- l'import des 306 lieux mapstr.
-- ============================================================================
-- À exécuter UNE FOIS sur le projet existant (SQL Editor). Re-jouable sans
-- risque : chaque instruction est conditionnelle.
--
-- POURQUOI CE FICHIER EXISTE
-- Les seeds de tags de schema.sql ont DÉJÀ été exécutés sur ce projet. Or
-- l'import (js/import-tool.js, resolveTagId) retrouve un tag existant par
-- son LABEL et réutilise cette ligne telle quelle — son emoji compris. Une
-- correction faite seulement dans schema.sql ou dans le parsing ne change
-- donc rien pour une base déjà semée : il faut la passer en UPDATE ici.
--
-- 1. Drapeau du tag Cuisine "Indonésien" : l'export mapstr porte 🇲🇨 (Monaco)
--    au lieu de 🇮🇩 (Indonésie). Corrigé aussi dans schema.sql (projet neuf)
--    et dans scripts/parse_mapstr.py (EMOJI_OVERRIDES).
--
-- 2. "Fromage" fusionné dans "Fromagerie". Le parsing ne produit plus du
--    tout "Fromage" (TYPE_DE_LIEU_ALIASES), donc si l'import n'a pas encore
--    tourné, le bloc 2 ne trouvera rien à faire — c'est normal et attendu.
--    Il n'est là que pour rattraper le cas où un tag "Fromage" aurait déjà
--    été créé par un import lancé avant cette correction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drapeau indonésien
-- ----------------------------------------------------------------------------
update public.tags
   set emoji = '🇮🇩'
 where category = 'cuisine' and label = 'Indonésien' and emoji <> '🇮🇩';

-- ----------------------------------------------------------------------------
-- 2. Fusion "Fromage" -> "Fromagerie" (filet de sécurité, voir en-tête)
-- ----------------------------------------------------------------------------
-- a. Rebasculer les lieux étiquetés "Fromage" vers "Fromagerie", sans créer
--    de doublon si un lieu porte déjà les deux.
update public.place_tags pt
   set tag_id = (select id from public.tags
                  where category = 'type_de_lieu' and label = 'Fromagerie')
 where tag_id = (select id from public.tags
                  where category = 'type_de_lieu' and label = 'Fromage')
   and not exists (
     select 1 from public.place_tags existing
      where existing.place_id = pt.place_id
        and existing.tag_id = (select id from public.tags
                                where category = 'type_de_lieu' and label = 'Fromagerie')
   );

-- b. Supprimer les liens "Fromage" restants (lieux qui avaient déjà les deux).
delete from public.place_tags
 where tag_id = (select id from public.tags
                  where category = 'type_de_lieu' and label = 'Fromage');

-- c. Supprimer le tag "Fromage" lui-même.
delete from public.tags
 where category = 'type_de_lieu' and label = 'Fromage';

-- ----------------------------------------------------------------------------
-- VÉRIFICATION — attendu :
--   - une ligne  cuisine / 🇮🇩 / Indonésien
--   - une ligne  type_de_lieu / 🧀 / Fromagerie
--   - AUCUNE ligne "Fromage"
-- ----------------------------------------------------------------------------
select category, emoji, label
from public.tags
where (category = 'cuisine' and label = 'Indonésien')
   or (category = 'type_de_lieu' and label in ('Fromage', 'Fromagerie'))
order by category, label;
