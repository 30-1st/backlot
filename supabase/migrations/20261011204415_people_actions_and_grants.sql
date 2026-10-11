-- ---------------------------------------------------------------------------
-- Actions. The work is done by functions in the private schema; the ones in
-- public only pass the call along, so nothing that runs with raised rights is
-- part of the public API on its own.
-- ---------------------------------------------------------------------------
create function private.require_member()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.members m where m.id = me) then
    raise exception 'Sign in to do that.' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- Ask someone to be a contact, by exact username.
-- Answers: sent, accepted, already, not_found, self, blocked_by_you, too_many.
create function private.add_contact(p_username text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := private.require_member();
  target uuid;
  existing public.contacts%rowtype;
begin
  select m.id into target from public.members m where m.username = lower(btrim(coalesce(p_username, ''), ' @'));
  if target is null then return 'not_found'; end if;
  if target = me then return 'self'; end if;
  if exists (select 1 from public.blocks b where b.blocker = me and b.blocked = target) then
    return 'blocked_by_you';
  end if;

  select * into existing from public.contacts c
  where (c.requester = me and c.addressee = target) or (c.requester = target and c.addressee = me);
  if found then
    if existing.status = 'accepted' then return 'already'; end if;
    if existing.requester = me then return 'sent'; end if;
    -- They had already asked you, so this is a yes.
    update public.contacts c set status = 'accepted' where c.requester = target and c.addressee = me;
    return 'accepted';
  end if;

  if (select count(*) from public.contacts c where c.requester = me and c.status = 'pending') >= 100 then
    return 'too_many';
  end if;
  insert into public.contacts (requester, addressee) values (me, target);
  return 'sent';
end;
$$;

-- The one-to-one chat with a contact, made the first time it is asked for.
create function private.open_direct(p_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := private.require_member();
  conv uuid;
begin
  if p_user is null or not private.is_contact(me, p_user) then
    raise exception 'You can only message your contacts.' using errcode = '42501';
  end if;
  select c.id into conv
  from public.conversations c
  where not c.is_group
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_user)
  order by c.created_at
  limit 1;
  if conv is null then
    insert into public.conversations (is_group, created_by) values (false, me) returning id into conv;
    insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, p_user);
  end if;
  return conv;
end;
$$;

create function private.create_group(p_title text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := private.require_member();
  conv uuid;
  ids uuid[];
  label text := nullif(btrim(coalesce(p_title, '')), '');
begin
  select coalesce(array_agg(distinct u), '{}') into ids from unnest(coalesce(p_members, '{}')) u where u <> me;
  if cardinality(ids) < 1 then
    raise exception 'Pick at least one person.' using errcode = '22023';
  end if;
  if cardinality(ids) > 49 then
    raise exception 'A group holds up to 50 people.' using errcode = '22023';
  end if;
  if label is not null and char_length(label) > 60 then
    raise exception 'Use 60 characters or fewer for the name.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(ids) u where not private.is_contact(me, u)) then
    raise exception 'You can only add your contacts.' using errcode = '42501';
  end if;
  insert into public.conversations (title, is_group, created_by) values (label, true, me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id)
  select conv, me union all select conv, u from unnest(ids) u;
  return conv;
end;
$$;

create function private.add_to_group(p_conversation uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := private.require_member();
  ids uuid[];
begin
  if not exists (
    select 1 from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    where c.id = p_conversation and c.is_group and m.user_id = me
  ) then
    raise exception 'That group is not open to you.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct u), '{}') into ids
  from unnest(coalesce(p_members, '{}')) u
  where not exists (
    select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = u
  );
  if exists (select 1 from unnest(ids) u where not private.is_contact(me, u)) then
    raise exception 'You can only add your contacts.' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members m where m.conversation_id = p_conversation) + cardinality(ids) > 50 then
    raise exception 'A group holds up to 50 people.' using errcode = '22023';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation, u from unnest(ids) u;
end;
$$;

create function public.add_contact(username text)
returns text
language sql security invoker set search_path = ''
as $$ select private.add_contact(username); $$;

create function public.open_direct(member uuid)
returns uuid
language sql security invoker set search_path = ''
as $$ select private.open_direct(member); $$;

create function public.create_group(title text, members uuid[])
returns uuid
language sql security invoker set search_path = ''
as $$ select private.create_group(title, members); $$;

create function public.add_to_group(conversation uuid, members uuid[])
returns void
language sql security invoker set search_path = ''
as $$ select private.add_to_group(conversation, members); $$;

-- ---------------------------------------------------------------------------
-- Who may call and touch what
-- ---------------------------------------------------------------------------
-- Other people may now see a member, but only the id and username.
revoke select on public.members from authenticated;
grant select (id, username) on public.members to authenticated;

revoke all on public.contacts, public.blocks, public.conversations, public.conversation_members,
  public.messages, public.narration_shares
  from anon, authenticated, service_role;

grant select, delete on public.contacts to authenticated;
grant update (status) on public.contacts to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select on public.conversations to authenticated;
grant update (title) on public.conversations to authenticated;
grant select, delete on public.conversation_members to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, delete on public.narration_shares to authenticated;
grant update (role) on public.narration_shares to authenticated;

grant select, insert, update, delete on public.contacts, public.blocks, public.conversations,
  public.conversation_members, public.messages, public.narration_shares
  to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.is_contact(uuid, uuid),
  private.i_blocked(uuid),
  private.my_conversation_ids(),
  private.can_post(uuid),
  private.owns_narration(uuid),
  private.can_open_narration(uuid),
  private.shared_account_ids(),
  private.can_see_member(uuid),
  private.can_read_shared_media(text),
  private.can_add_shared_media(text),
  private.add_contact(text),
  private.open_direct(uuid),
  private.create_group(text, uuid[]),
  private.add_to_group(uuid, uuid[])
  to authenticated;

revoke execute on function
  public.add_contact(text),
  public.open_direct(uuid),
  public.create_group(text, uuid[]),
  public.add_to_group(uuid, uuid[])
  from public, anon;
grant execute on function
  public.add_contact(text),
  public.open_direct(uuid),
  public.create_group(text, uuid[]),
  public.add_to_group(uuid, uuid[])
  to authenticated;

-- New messages reach open chats straight away.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
