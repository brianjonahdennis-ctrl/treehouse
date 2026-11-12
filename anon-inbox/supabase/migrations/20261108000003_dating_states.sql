-- Location by Nigerian state. Each dating profile has a state (picked from a list, not typed), and a
-- Discover filter (pref_state) that starts as their own state. pref_state null = anywhere in Nigeria.

create function dating_private.nigerian_states() returns text[]
language sql immutable as $$
  select array['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
    'Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara',
    'Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
$$;

alter table public.dating_profiles
  add column state      text check (state is null or state = any (dating_private.nigerian_states())),
  add column pref_state text check (pref_state is null or pref_state = any (dating_private.nigerian_states()));
grant update (state, pref_state) on public.dating_profiles to authenticated;

-- Existing profiles: work out the state from what they typed, where it's clear.
with places(word, st) as (values
  ('lagos','Lagos'),('lekki','Lagos'),('ikeja','Lagos'),('yaba','Lagos'),('surulere','Lagos'),('ajah','Lagos'),('ikorodu','Lagos'),('victoria island','Lagos'),('festac','Lagos'),
  ('port harcourt','Rivers'),('portharcourt','Rivers'),('ph','Rivers'),('rivers','Rivers'),
  ('abuja','FCT'),('fct','FCT'),('gwagwalada','FCT'),
  ('ibadan','Oyo'),('oyo','Oyo'),('ogbomoso','Oyo'),('enugu','Enugu'),('nsukka','Enugu'),('kano','Kano'),('kaduna','Kaduna'),('zaria','Kaduna'),
  ('benin','Edo'),('edo','Edo'),('owerri','Imo'),('imo','Imo'),('uyo','Akwa Ibom'),('akwa ibom','Akwa Ibom'),('calabar','Cross River'),('cross river','Cross River'),
  ('jos','Plateau'),('plateau','Plateau'),('warri','Delta'),('asaba','Delta'),('delta','Delta'),('abeokuta','Ogun'),('ogun','Ogun'),('ota','Ogun'),
  ('ilorin','Kwara'),('kwara','Kwara'),('akure','Ondo'),('ondo','Ondo'),('osogbo','Osun'),('ile-ife','Osun'),('ife','Osun'),('osun','Osun'),
  ('ado ekiti','Ekiti'),('ekiti','Ekiti'),('makurdi','Benue'),('benue','Benue'),('lokoja','Kogi'),('kogi','Kogi'),('minna','Niger'),
  ('sokoto','Sokoto'),('maiduguri','Borno'),('borno','Borno'),('yola','Adamawa'),('adamawa','Adamawa'),('bauchi','Bauchi'),('gombe','Gombe'),
  ('jalingo','Taraba'),('taraba','Taraba'),('lafia','Nasarawa'),('nasarawa','Nasarawa'),('katsina','Katsina'),('kebbi','Kebbi'),('gusau','Zamfara'),('zamfara','Zamfara'),
  ('dutse','Jigawa'),('jigawa','Jigawa'),('damaturu','Yobe'),('yobe','Yobe'),('awka','Anambra'),('onitsha','Anambra'),('nnewi','Anambra'),('anambra','Anambra'),
  ('abakaliki','Ebonyi'),('ebonyi','Ebonyi'),('umuahia','Abia'),('aba','Abia'),('abia','Abia'),('yenagoa','Bayelsa'),('bayelsa','Bayelsa')
), guesses as (
  select p.user_id, (array_agg(distinct pl.st))[1] as st, count(distinct pl.st) as n
  from public.dating_profiles p
  join places pl on lower(p.location) ~ ('(^|[^a-z])' || pl.word || '($|[^a-z])')
  where p.state is null
  group by p.user_id
)
update public.dating_profiles p set state = g.st
from guesses g where g.user_id = p.user_id and g.n = 1;   -- only when exactly one state matched

-- The filter starts as their own state.
update public.dating_profiles set pref_state = state where pref_state is null and state is not null;

-- Discover: also filter by the chosen state (no filter = anywhere in Nigeria).
create or replace function public.discover_cards(p_limit int default 20)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[])
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests
  from dating_profiles me
  join dating_profiles p on p.user_id <> me.user_id
  where me.user_id = auth.uid()
    and p.is_active and not p.suspended
    and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
    and p.age between me.min_age and me.max_age
    and (me.pref_state is null or p.state = me.pref_state)
    and not exists (select 1 from dating_likes l where l.from_user = me.user_id and l.to_user = p.user_id)
    and dating_conversation_between(me.user_id, p.user_id) is null
    and not dating_is_blocked(me.user_id, p.user_id)
  order by exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = me.user_id and l.liked) desc,
           p.created_at desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- How many people are in each state right now (counts only), for the filter's picker.
create function public.dating_state_counts()
returns table (state text, people int)
language sql stable security definer set search_path = public, dating_private as $$
  select p.state, count(*)::int from dating_profiles p
  where p.state is not null and p.is_active and not p.suspended and p.user_id is distinct from auth.uid()
  group by p.state;
$$;
revoke execute on function public.dating_state_counts() from public, anon;
grant execute on function public.dating_state_counts() to authenticated;
