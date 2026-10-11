-- A block should hide new requests from that person, not an existing contact
-- row. With the row hidden, the blocker could not remove the contact, so the
-- contact and its shares would have stayed behind.
alter policy "People see their own contacts and requests" on public.contacts
  using (
    requester = (select auth.uid())
    or (
      addressee = (select auth.uid())
      and (status = 'accepted' or not private.i_blocked(requester))
    )
  );
