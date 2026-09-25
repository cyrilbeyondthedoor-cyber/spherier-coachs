-- Apply before deploying the matching server functions. Existing snapshots remain readable.
begin;

alter table public.notes add column if not exists revision bigint not null default 1;
create index if not exists snapshots_client_version_recent
  on public.snapshots (client_id, (blob->>'referential_version'), cree_le desc, id desc);
create index if not exists snapshots_checkpoints
  on public.snapshots (client_id, cree_le desc, id desc)
  where blob->>'kind' = 'checkpoint';

create or replace function public.save_spherier_snapshot(
  p_client_id uuid, p_base_id uuid, p_libelle text, p_blob jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare current_row public.snapshots; saved public.snapshots;
begin
  perform pg_advisory_xact_lock(hashtextextended('spherier.snapshot:' || p_client_id::text, 0));
  select * into current_row from public.snapshots
    where client_id = p_client_id
      and blob->>'referential_version' = p_blob->>'referential_version'
    order by cree_le desc, id desc limit 1;
  if current_row.id is distinct from p_base_id then
    return jsonb_build_object('conflict', true, 'current', to_jsonb(current_row));
  end if;
  insert into public.snapshots(client_id, libelle, blob, cree_le)
    values (p_client_id, p_libelle, p_blob, clock_timestamp()) returning * into saved;
  return jsonb_build_object('snapshot', to_jsonb(saved));
end $$;

create or replace function public.save_spherier_note(
  p_client_id uuid, p_code text, p_text text, p_base_revision bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare current_row public.notes; saved public.notes;
begin
  perform pg_advisory_xact_lock(hashtextextended('spherier.note:' || p_client_id::text || ':' || p_code, 0));
  select * into current_row from public.notes where client_id = p_client_id and code = p_code;
  if current_row.revision is distinct from p_base_revision then
    return jsonb_build_object('conflict', true, 'current', to_jsonb(current_row));
  end if;
  -- Empty text is a tombstone: its revision prevents an old tab from resurrecting a deleted note.
  insert into public.notes(client_id, code, texte, revision, maj_le)
    values(p_client_id, p_code, p_text, 1, clock_timestamp())
    on conflict (client_id, code) do update set texte = excluded.texte,
      revision = notes.revision + 1, maj_le = clock_timestamp()
    returning * into saved;
  return jsonb_build_object('note', to_jsonb(saved));
end $$;

revoke all on function public.save_spherier_snapshot(uuid, uuid, text, jsonb) from public;
revoke all on function public.save_spherier_note(uuid, text, text, bigint) from public;
grant execute on function public.save_spherier_snapshot(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.save_spherier_note(uuid, text, text, bigint) to service_role;
commit;
