-- Backlot: people, chats, and sharing narrations.
--
-- What this adds:
--   contacts             two creators who agreed to work together
--   blocks               someone a creator never wants to hear from
--   conversations        a chat: one to one, or a group
--   conversation_members who is in each chat
--   messages             what was said, optionally pointing at a narration
--   narration_shares     who an author let into a narration, to view or to edit
--
-- Rules, in plain words:
--   * You can only add someone by their exact username, and they must accept.
--   * You can only chat with, and share with, your contacts.
--   * The author of a narration decides who gets in and whether they may edit.
--     Editors change the page. Only the author renames it, deletes it, sets its
--     save point, or shares it further.
--   * Removing a contact ends every share between the two of you. A share
--     row points at the contact row, so it goes when the contact goes.
--
-- Policies that must look at another table do it through small functions in the
-- private schema. Those run with the owner's rights, which keeps one table's
-- policy from looping back into itself through another's.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.contacts (
  requester uuid not null,
  addressee uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  -- The pair in a fixed order, so there is one row per pair whichever of the two asked.
  pair_lo uuid generated always as (least(requester, addressee)) stored,
  pair_hi uuid generated always as (greatest(requester, addressee)) stored,
  primary key (requester, addressee),
  constraint contacts_pair_key unique (pair_lo, pair_hi),
  constraint contacts_requester_fkey foreign key (requester) references public.members (id) on delete cascade,
  constraint contacts_addressee_fkey foreign key (addressee) references public.members (id) on delete cascade,
  constraint contacts_not_self check (requester <> addressee),
  constraint contacts_status_known check (status in ('pending', 'accepted'))
);
create index contacts_addressee_idx on public.contacts (addressee);

create table public.blocks (
  blocker uuid not null,
  blocked uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_blocker_fkey foreign key (blocker) references public.members (id) on delete cascade,
  constraint blocks_blocked_fkey foreign key (blocked) references public.members (id) on delete cascade,
  constraint blocks_not_self check (blocker <> blocked)
);
create index blocks_blocked_idx on public.blocks (blocked);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  is_group boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- Kept up to date by a trigger so the list of chats needs no second query.
  last_message_at timestamptz not null default now(),
  last_preview text not null default '',
  last_sender_id uuid,
  constraint conversations_created_by_fkey foreign key (created_by) references public.members (id) on delete set null,
  constraint conversations_title_length check (title is null or char_length(title) between 1 and 60)
);
create index conversations_created_by_idx on public.conversations (created_by);

create table public.conversation_members (
  conversation_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_members_conversation_id_fkey foreign key (conversation_id) references public.conversations (id) on delete cascade,
  constraint conversation_members_user_id_fkey foreign key (user_id) references public.members (id) on delete cascade
);
create index conversation_members_user_id_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid,
  -- Copied in when the message is sent, so it still reads right after the sender leaves.
  sender_name text not null default '',
  body text not null default '',
  narration_id uuid,
  created_at timestamptz not null default now(),
  constraint messages_conversation_id_fkey foreign key (conversation_id) references public.conversations (id) on delete cascade,
  constraint messages_sender_id_fkey foreign key (sender_id) references public.members (id) on delete set null,
  constraint messages_narration_id_fkey foreign key (narration_id) references public.narrations (id) on delete set null,
  constraint messages_body_length check (char_length(body) <= 4000)
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_sender_id_idx on public.messages (sender_id);
create index messages_narration_id_idx on public.messages (narration_id);

create table public.narration_shares (
  narration_id uuid not null,
  user_id uuid not null,
  -- The narration's author, copied here so the rules below stay simple and quick.
  owner_id uuid not null,
  role text not null default 'view',
  created_at timestamptz not null default now(),
  pair_lo uuid generated always as (least(owner_id, user_id)) stored,
  pair_hi uuid generated always as (greatest(owner_id, user_id)) stored,
  primary key (narration_id, user_id),
  -- A share lives only as long as the two are contacts.
  constraint narration_shares_contact_fkey foreign key (pair_lo, pair_hi)
    references public.contacts (pair_lo, pair_hi) on delete cascade,
  constraint narration_shares_narration_id_fkey foreign key (narration_id) references public.narrations (id) on delete cascade,
  constraint narration_shares_user_id_fkey foreign key (user_id) references public.members (id) on delete cascade,
  constraint narration_shares_owner_id_fkey foreign key (owner_id) references public.members (id) on delete cascade,
  constraint narration_shares_role_known check (role in ('view', 'edit')),
  constraint narration_shares_not_self check (user_id <> owner_id)
);
create index narration_shares_user_id_idx on public.narration_shares (user_id);
create index narration_shares_owner_id_idx on public.narration_shares (owner_id);
create index narration_shares_pair_idx on public.narration_shares (pair_lo, pair_hi);

-- Counts up every time the page changes. Two people saving at once is caught
-- by comparing this number, so nobody silently overwrites someone else.
alter table public.narrations add column revision integer not null default 0;

alter table public.contacts enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.narration_shares enable row level security;

-- ---------------------------------------------------------------------------
-- Questions the policies ask. All of them answer for the signed-in caller.
-- ---------------------------------------------------------------------------
create function private.is_contact(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.contacts c
    where c.status = 'accepted'
      and ((c.requester = a and c.addressee = b) or (c.requester = b and c.addressee = a))
  )
  -- A block cuts the tie at once, even before the contact row is removed.
  and not exists (
    select 1 from public.blocks k
    where (k.blocker = a and k.blocked = b) or (k.blocker = b and k.blocked = a)
  );
$$;

create function private.i_blocked(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b where b.blocker = (select auth.uid()) and b.blocked = other
  );
$$;

create function private.my_conversation_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.conversation_id from public.conversation_members m where m.user_id = (select auth.uid());
$$;

-- In a group, any member may post. One to one, only while the two are still contacts.
create function private.can_post(conv uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    where me.conversation_id = conv
      and me.user_id = (select auth.uid())
      and (
        c.is_group
        or exists (
          select 1 from public.conversation_members other
          where other.conversation_id = conv
            and other.user_id <> me.user_id
            and private.is_contact(me.user_id, other.user_id)
        )
      )
  );
$$;

create function private.owns_narration(narration uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.narrations n where n.id = narration and n.user_id = (select auth.uid())
  );
$$;

create function private.can_open_narration(narration uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.narrations n
    where n.id = narration
      and (
        n.user_id = (select auth.uid())
        or exists (
          select 1 from public.narration_shares s
          where s.narration_id = n.id and s.user_id = (select auth.uid())
        )
      )
  );
$$;

create function private.shared_account_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select n.account_id
  from public.narration_shares s
  join public.narrations n on n.id = s.narration_id
  where s.user_id = (select auth.uid());
$$;

-- You may see the name of anyone you have some tie to: a contact or a request
-- in either direction, a chat you are both in, a share between you, or a block
-- you placed.
create function private.can_see_member(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    exists (
      select 1 from public.contacts c
      where (c.requester = (select auth.uid()) and c.addressee = target)
         or (c.requester = target and c.addressee = (select auth.uid()))
    )
    or exists (
      select 1
      from public.conversation_members a
      join public.conversation_members b on b.conversation_id = a.conversation_id
      where a.user_id = (select auth.uid()) and b.user_id = target
    )
    or exists (
      select 1 from public.narration_shares s
      where (s.owner_id = (select auth.uid()) and s.user_id = target)
         or (s.owner_id = target and s.user_id = (select auth.uid()))
    )
    or exists (
      select 1 from public.blocks b where b.blocker = (select auth.uid()) and b.blocked = target
    );
$$;

-- A photo or video is readable by someone it was shared with when a narration
-- shared with them, or that narration's save point, lists the file.
create function private.can_read_shared_media(object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.narration_shares s
    join public.narrations n on n.id = s.narration_id
    where s.user_id = (select auth.uid())
      and n.user_id::text = (storage.foldername(object_name))[1]
      and (
        jsonb_exists(n.sandbox -> 'media', storage.filename(object_name))
        or jsonb_exists(n.save_point -> 'sandbox' -> 'media', storage.filename(object_name))
      )
  );
$$;

-- An editor's new photos and videos go into the author's folder, next to the
-- rest of the narration, so everyone the narration is shared with can see them.
create function private.can_add_shared_media(object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.narration_shares s
    join public.narrations n on n.id = s.narration_id
    where s.user_id = (select auth.uid())
      and s.role = 'edit'
      and n.user_id::text = (storage.foldername(object_name))[1]
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy "Members see the people they are tied to"
  on public.members for select to authenticated
  using (private.can_see_member(id));

-- Contacts. Requests are made through add_contact() below.
-- A request from someone you blocked stays out of your sight.
create policy "People see their own contacts and requests"
  on public.contacts for select to authenticated
  using (
    requester = (select auth.uid())
    or (addressee = (select auth.uid()) and not private.i_blocked(requester))
  );

create policy "People accept requests sent to them"
  on public.contacts for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status = 'accepted');

create policy "People remove contacts and requests"
  on public.contacts for delete to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));

-- Blocks.
create policy "People see who they blocked"
  on public.blocks for select to authenticated
  using (blocker = (select auth.uid()));

create policy "People block others"
  on public.blocks for insert to authenticated
  with check (blocker = (select auth.uid()));

create policy "People lift their own blocks"
  on public.blocks for delete to authenticated
  using (blocker = (select auth.uid()));

-- Chats. Started through open_direct() and create_group() below.
create policy "People see the chats they are in"
  on public.conversations for select to authenticated
  using (id in (select private.my_conversation_ids()));

create policy "People rename group chats they are in"
  on public.conversations for update to authenticated
  using (is_group and id in (select private.my_conversation_ids()))
  with check (is_group and id in (select private.my_conversation_ids()));

create policy "People see who is in their chats"
  on public.conversation_members for select to authenticated
  using (conversation_id in (select private.my_conversation_ids()));

create policy "People mark their own chats as read"
  on public.conversation_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "People leave chats"
  on public.conversation_members for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "People read messages in their chats"
  on public.messages for select to authenticated
  using (conversation_id in (select private.my_conversation_ids()));

-- A message needs words or a narration, and you can only point at a narration
-- you can open yourself.
create policy "People post in their chats"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.can_post(conversation_id)
    and (btrim(body) <> '' or narration_id is not null)
    and (narration_id is null or private.can_open_narration(narration_id))
  );

create policy "People take back their own messages"
  on public.messages for delete to authenticated
  using (sender_id = (select auth.uid()));

-- Sharing.
create policy "Authors and the people they share with see shares"
  on public.narration_shares for select to authenticated
  using (owner_id = (select auth.uid()) or user_id = (select auth.uid()));

create policy "Authors share their own narrations with contacts"
  on public.narration_shares for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.owns_narration(narration_id)
    and private.is_contact(owner_id, user_id)
  );

create policy "Authors change what a person may do"
  on public.narration_shares for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Authors stop sharing, and people remove themselves"
  on public.narration_shares for delete to authenticated
  using (owner_id = (select auth.uid()) or user_id = (select auth.uid()));

-- Narrations and accounts: let in the people a narration is shared with.
create policy "People read narrations shared with them"
  on public.narrations for select to authenticated
  using (
    exists (
      select 1 from public.narration_shares s
      where s.narration_id = narrations.id and s.user_id = (select auth.uid())
    )
  );

create policy "Editors change narrations shared with them"
  on public.narrations for update to authenticated
  using (
    exists (
      select 1 from public.narration_shares s
      where s.narration_id = narrations.id and s.user_id = (select auth.uid()) and s.role = 'edit'
    )
  )
  with check (
    exists (
      select 1 from public.narration_shares s
      where s.narration_id = narrations.id and s.user_id = (select auth.uid()) and s.role = 'edit'
    )
  );

create policy "People read the account behind a narration shared with them"
  on public.accounts for select to authenticated
  using (id in (select private.shared_account_ids()));

-- Media.
create policy "Media: people read files in narrations shared with them"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.can_read_shared_media(name));

create policy "Media: editors add files to narrations shared with them"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.can_add_shared_media(name));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- What may change on a narration, and counting its revisions.
create function private.narrations_guard()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  new.id := old.id;
  new.created_at := old.created_at;
  if me is not null and me <> old.user_id then
    -- Someone the narration is shared with: the page may change, nothing else.
    new.user_id := old.user_id;
    new.account_id := old.account_id;
    new.name := old.name;
    new.save_point := old.save_point;
  end if;
  if new.sandbox is distinct from old.sandbox then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

create trigger narrations_guard
  before update on public.narrations
  for each row execute function private.narrations_guard();

-- A message is always from the caller, named and timed by the server.
create function private.messages_stamp()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is not null then
    new.sender_id := me;
    new.sender_name := coalesce((select m.username from public.members m where m.id = me), '');
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger messages_stamp
  before insert on public.messages
  for each row execute function private.messages_stamp();

-- Keep each chat's "latest message" line current.
create function private.conversations_summarise()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conv uuid;
  latest record;
begin
  if tg_op = 'DELETE' then
    conv := old.conversation_id;
  else
    conv := new.conversation_id;
  end if;

  select m.created_at, m.body, m.sender_id into latest
  from public.messages m
  where m.conversation_id = conv
  order by m.created_at desc
  limit 1;

  if found then
    update public.conversations c
    set last_message_at = latest.created_at,
        last_preview = case when btrim(latest.body) <> '' then left(latest.body, 140) else 'Shared a narration' end,
        last_sender_id = latest.sender_id
    where c.id = conv;
  else
    update public.conversations c
    set last_preview = '', last_sender_id = null
    where c.id = conv;
  end if;
  return null;
end;
$$;

create trigger messages_summarise
  after insert or delete on public.messages
  for each row execute function private.conversations_summarise();

-- Reading a chat is stamped with the server's clock.
create function private.conversation_members_stamp()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.conversation_id := old.conversation_id;
    new.user_id := old.user_id;
    new.joined_at := old.joined_at;
    new.last_read_at := now();
  end if;
  return new;
end;
$$;

create trigger conversation_members_stamp
  before update on public.conversation_members
  for each row execute function private.conversation_members_stamp();

