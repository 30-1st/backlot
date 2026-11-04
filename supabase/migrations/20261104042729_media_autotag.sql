-- Bil tags media himself (approved Nov 4, 2026): the phone sends a small copy of a photo, or
-- one frame of a video, and Grok 4.3 names what is in it. Non-adult clients only; the
-- server refuses adult accounts. Tags are saved only on files nobody has tagged by hand.
insert into private.spend_limits (scope, cap_usd, note) values
  ('tag', 0.01, 'Bil tags one photo or one video frame (Grok 4.3 reads a small copy made on the phone). Non-adult clients only. Approved by Khma on 2026-11-04.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
