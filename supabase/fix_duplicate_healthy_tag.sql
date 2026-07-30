-- ============================================================================
-- fix_duplicate_healthy_tag.sql — fusionne le tag "Healthy" en double créé
-- pendant la préparation du batch 2.
-- ============================================================================
-- À exécuter dans Supabase → SQL Editor. Re-jouable sans risque : une fois
-- fusionné, les blocs suivants ne trouvent plus rien à faire.
--
-- CE QUI S'EST PASSÉ
-- Un tag "Healthy" existait déjà (créé à la main dans l'app avant le batch),
-- mais resolveTagId (js/import-batch2.js) ne l'a pas retrouvé et en a créé
-- un second. L'ancienne comparaison était un simple lowercase strict, ET
-- limitée à la catégorie attendue ('special') : un espace de début/fin, un
-- accent en forme Unicode décomposée, ou un tag rangé dans une autre
-- catégorie passaient au travers. Le bloc 1 ci-dessous montre lequel de ces
-- cas s'est produit. La logique de matching est corrigée côté JS
-- (js/tags.js normalizeLabel/findTagByLabel) ; ce fichier ne répare que les
-- données.
--
-- CE QUE FAIT LA FUSION (bloc 2)
-- - garde la ligne "Healthy" la PLUS ANCIENNE (celle créée à la main) ;
-- - re-pointe les place_tags des doublons vers elle (en sautant les lieux
--   qui la portent déjà — pas de violation de la clé primaire) ;
-- - supprime le(s) doublon(s). INSERT/UPDATE/DELETE limités aux lignes
--   "healthy" uniquement, aucun lieu supprimé ni modifié.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DIAGNOSTIC — à lire avant/après. Les chevrons « » rendent visibles les
--    espaces parasites ; length() démasque les accents décomposés (un
--    "Healthy" à 8+ caractères en contient un ou un espace de trop) ;
--    is_nfc dit si le libellé est en forme Unicode composée.
-- ----------------------------------------------------------------------------
select id,
       category,
       emoji,
       '«' || label || '»'                as label_quoted,
       length(label)                      as label_len,
       label is nfc normalized            as is_nfc,
       created_at,
       (select count(*) from public.place_tags pt where pt.tag_id = t.id) as nb_places
from public.tags t
where lower(btrim(normalize(label, NFC))) = 'healthy'
order by created_at;

-- ----------------------------------------------------------------------------
-- 2. FUSION
-- ----------------------------------------------------------------------------
do $$
declare
  keeper uuid;
  dupe   record;
  moved  integer;
begin
  -- La plus ancienne ligne "healthy" = celle créée à la main avant le batch.
  select id into keeper
  from public.tags
  where lower(btrim(normalize(label, NFC))) = 'healthy'
  order by created_at asc
  limit 1;

  if keeper is null then
    raise notice 'Aucun tag "Healthy" trouvé — rien à faire.';
    return;
  end if;

  for dupe in
    select id, category, label
    from public.tags
    where lower(btrim(normalize(label, NFC))) = 'healthy'
      and id <> keeper
  loop
    -- Re-pointe les lieux du doublon vers le tag conservé. added_at est
    -- conservé tel quel (l'ordre d'ajout pilote l'icône de pin, mais
    -- seulement pour les tags Type de lieu — sans enjeu ici, on le garde
    -- par principe).
    update public.place_tags pt
       set tag_id = keeper
     where pt.tag_id = dupe.id
       and not exists (
         select 1 from public.place_tags k
         where k.place_id = pt.place_id and k.tag_id = keeper
       );
    get diagnostics moved = row_count;

    -- Les liens restants sont ceux de lieux qui portaient DÉJÀ le tag
    -- conservé — de purs doublons de lien, à supprimer avec le tag.
    delete from public.place_tags where tag_id = dupe.id;
    delete from public.tags where id = dupe.id;

    raise notice 'Doublon supprimé (catégorie %, « % ») : % lieu(x) re-pointé(s).',
      dupe.category, dupe.label, moved;
  end loop;

  -- Nettoie le libellé conservé (espaces, forme Unicode) sans toucher à sa
  -- casse d'origine ni à sa catégorie : s'il n'est pas rangé dans 'special',
  -- l'import le SIGNALERA (erreur explicite) au lieu de recréer un doublon —
  -- à toi d'arbitrer la catégorie à ce moment-là.
  update public.tags
     set label = btrim(regexp_replace(normalize(label, NFC), '\s+', ' ', 'g'))
   where id = keeper
     and label <> btrim(regexp_replace(normalize(label, NFC), '\s+', ' ', 'g'));
end $$;

-- ----------------------------------------------------------------------------
-- 3. VÉRIFICATION — il doit rester exactement UNE ligne, avec la somme des
--    lieux des deux tags d'avant (sans double compte).
-- ----------------------------------------------------------------------------
select id,
       category,
       emoji,
       '«' || label || '»' as label_quoted,
       (select count(*) from public.place_tags pt where pt.tag_id = t.id) as nb_places
from public.tags t
where lower(btrim(normalize(label, NFC))) = 'healthy';
