-- ===========================================================================
-- Schéma Supabase du sphérier — identique à celui du club b2c.
-- ===========================================================================
--
-- Deux tables, deux régimes d'écriture volontairement opposés.
--
-- Ce fichier est la référence : il a été relevé sur la base du premier club, et
-- c'est lui qui est appliqué sur le projet du club de coachs. Le garder à jour
-- si le schéma évolue.
--
-- RLS active sans policy sur les deux tables : rien n'est accessible depuis un
-- navigateur, même avec la clé publique. Tout passe par les fonctions Netlify,
-- qui utilisent la clé de service et contournent RLS. C'est le seul rempart
-- entre les données d'un membre et le reste du monde — ne jamais ajouter de
-- policy « pour tester ».

-- --- snapshots : APPEND-ONLY -----------------------------------------------
--
-- Chaque enregistrement crée une ligne, jamais de modification ni de
-- suppression. C'est ce qui permet de comparer deux moments et de montrer au
-- membre ce qui a bougé entre deux mois.
--
-- `blob` contient les niveaux et les sélections, identifiés par CODE de
-- compétence. Il n'est pas interprétable seul : il faut le référentiel Notion
-- du moment pour lui donner sens. D'où la règle : un code de compétence est
-- permanent.
create table if not exists public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,
  cree_le    timestamptz not null default now(),
  libelle    text,
  blob       jsonb not null
);

-- La lecture courante est « le dernier snapshot de ce membre » : l'index porte
-- donc sur le couple, en date décroissante.
create index if not exists snapshots_client_recent
  on public.snapshots (client_id, cree_le desc);

-- --- notes : MODIFIABLE ----------------------------------------------------
--
-- Une note appartient à la COMPÉTENCE, pas au moment : on la relit, on la
-- complète, on la corrige. D'où la contrainte d'unicité, sur laquelle s'appuie
-- l'upsert du serveur (`onConflict: 'client_id,code'`). Sans elle, l'upsert
-- empile des doublons au lieu de remplacer.
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,
  code       text not null,
  texte      text not null,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint notes_client_code_unique unique (client_id, code)
);

create index if not exists notes_client_id_idx
  on public.notes (client_id);

-- --- Verrouillage ----------------------------------------------------------
alter table public.snapshots enable row level security;
alter table public.notes     enable row level security;

-- Aucune policy, volontairement. Vérification attendue après application :
--   select tablename, rowsecurity from pg_tables where schemaname='public';
--     -> snapshots | true
--     -> notes     | true
--   select count(*) from pg_policies where schemaname='public';
--     -> 0
