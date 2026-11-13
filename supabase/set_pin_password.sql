-- ============================================================================
-- set_pin_password.sql — pose (ou change) le code à 4 chiffres de connexion
-- ============================================================================
-- À QUOI ÇA SERT
-- Depuis le retrait du magic link, l'app se connecte avec un code à 4
-- chiffres (voir js/auth.js). Ce code est en réalité le mot de passe du
-- compte Supabase de l'admin, précédé de « miamap- » parce que Supabase
-- refuse les mots de passe de moins de 6 caractères (voir
-- PIN_PASSWORD_PREFIX dans js/config.js).
--
-- Le tableau de bord Supabase ne permet pas de taper directement un mot de
-- passe pour un utilisateur existant : on le pose donc ici, en SQL.
--
-- COMMENT L'UTILISER
--   1. Supabase → ton projet → SQL Editor → New query.
--   2. Colle ce fichier, remplace XXXX par ton code à 4 chiffres (garde le
--      « miamap- » devant), puis Run.
--   3. Pour changer de code plus tard : refais la même chose avec le nouveau.
--
-- NE COMMITE JAMAIS ce fichier avec ton vrai code à la place de XXXX : le
-- repo est public.
-- ============================================================================

-- 1. Le mot de passe du compte admin = « miamap- » + ton code.
--    crypt()/gen_salt() viennent de l'extension pgcrypto, installée d'office
--    par Supabase dans le schéma `extensions` ; 'bf' = bcrypt, le format de
--    hachage qu'utilise Supabase Auth pour vérifier les mots de passe.
update auth.users
set encrypted_password = extensions.crypt('miamap-XXXX', extensions.gen_salt('bf')),
    updated_at = now()
where email = 'cremieux.maxime@gmail.com';

-- 2. Retrait des lecteurs : l'app n'a plus qu'un utilisateur (l'admin).
--    On désactive les profils lecteurs existants ; les règles RLS de
--    schema.sql leur refusent alors tout accès aux données. Sans risque à
--    relancer.
update public.profiles
set is_active = false
where role = 'reader';

-- 3. Vérification : doit afficher une ligne avec has_password = true.
select email, encrypted_password is not null and encrypted_password <> '' as has_password
from auth.users
where email = 'cremieux.maxime@gmail.com';
