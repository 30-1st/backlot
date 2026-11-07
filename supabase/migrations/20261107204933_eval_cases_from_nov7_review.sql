-- Nov 7, 2026: eight cases from Khma's review of the @litax333 chat (approved), replayed by the
-- quality gate from the turn they came from. Each says what a good answer does.
insert into public.eval_cases (agent, client_id, source, input)
select 'chat', c.id, v.source, jsonb_build_object('text', v.text, 'role', 'client', 'fromTurn', v.turn, 'expectLead', v.lead, 'expect', v.expect)
from public.clients c
cross join (values
  ('review:107', 107, 'lets keep building the excitement to close him on paying for my nails what do my next few messages look like including this next one', 'xev', 'Xev writes the actual next DM plus what comes after, as real texts that build on the nail pattern he already picked (named specifically, from her earlier reads). No offering, no hashtags, no caption tone.'),
  ('review:114', 114, 'yeah but we already know which oattern he likes??', 'xev', 'Names the specific pattern he picked (from Xev''s earlier reads in the chat) and writes the line around it.'),
  ('review:116', 116, 'its not warm enough, this is someone whose already sent over $400 we can make it more special', 'xev', 'A warmer DM that treats him like a regular who is remembered, without telling him how much he spent and without inventing an upsell.'),
  ('review:123', 123, 'i think he knows what he spent? anyone have anything better than this??', 'xev', 'A clearly better DM that drops the spend reference, plus a genuinely different alternative, not a reword.'),
  ('review:128', 128, 'context is that we havent spoken for 2 days so i figured its best to be softer', 'xev', 'Takes the 2-day gap as a fact and adjusts: warm and easy first, the ask after he replies. May note once why a clear ask still matters, then goes with the softer approach. Does not argue the same point again.'),
  ('review:131', 131, 'give me the exact message then Xev since i already said that youre gonna have to play off of it', 'xev', 'Writes the message that comes after her line "theyre cute right, wanna get me them ?", never repeating her line, and only asks for what she is selling (the nails), no invented custom clip.'),
  ('review:134', 134, 'okay cool any text only opportunitrs on X right now for me that can gain lets 10,000 impressions in my niche?', 'rein', 'Concrete text-only opportunities from the trend brief and how to use each, a path toward the reach goal, never a verdict that it is out of reach.'),
  ('review:142', 142, 'okay yeah bil thats what my post reached i get that but theres an algorithm that youre literally trained. you know exactly how tweet to go viral', 'bil', 'Explains from X''s ranking code which signals make a post spread (replies, reposts, dwell, negative feedback) and what that means for her next text post, without repeating the 21.4 per 1,000 statistic or the afternoon media post again.')
) as v(source, turn, text, lead, expect)
where c.x_handle = 'litax333'
on conflict do nothing;
