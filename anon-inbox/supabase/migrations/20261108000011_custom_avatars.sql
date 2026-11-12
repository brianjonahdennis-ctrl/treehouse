-- Custom avatars: people build an emoji-style avatar (skin tone, hair, eyes, mouth, extras).
-- Only the avatar's settings are stored (small short codes, no images), and anyone signed in can see
-- the avatar that goes with a nickname, like they can see the nickname itself.

create table public.user_avatars (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  config      jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 400),
  updated_at  timestamptz not null default now()
);
alter table public.user_avatars enable row level security;
revoke all on public.user_avatars from anon, authenticated;

-- Save (or with null, remove) your avatar. Every setting is a short code like "afro" or "3".
create function public.set_my_avatar(p_config jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text;
  v jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_config is null then delete from user_avatars where user_id = auth.uid(); return; end if;
  if jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 400 then
    raise exception 'That avatar isn''t valid.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_config) loop
    if k !~ '^[a-z]{1,8}$' or jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-z0-9]{1,12}$' then
      raise exception 'That avatar isn''t valid.' using errcode = '22023';
    end if;
  end loop;
  -- Male profiles get male avatars, female profiles female ones (non-binary profiles can use either).
  if (select gender::text from dating_profiles where user_id = auth.uid()) in ('male', 'female')
     and coalesce(p_config ->> 'k', '') <> left((select gender::text from dating_profiles where user_id = auth.uid()), 1) then
    raise exception 'Pick an avatar that matches your profile.' using errcode = '22023';
  end if;
  insert into user_avatars (user_id, config) values (auth.uid(), p_config)
  on conflict (user_id) do update set config = excluded.config, updated_at = now();
end $$;

-- Avatars for a batch of nicknames (dating nicknames and chatroom names).
create function public.get_avatars(p_handles text[])
returns table (handle text, config jsonb)
language sql stable security definer set search_path = public, dating_private as $$
  select n.handle, a.config
  from (select distinct unnest(p_handles[1:100]) as handle) n
  cross join lateral (
    select coalesce(
      (select p.user_id from dating_profiles p where p.handle = n.handle),
      (select r.user_id from room_aliases r where r.handle = n.handle)) as uid
  ) u
  join user_avatars a on a.user_id = u.uid;
$$;

revoke execute on function public.set_my_avatar(jsonb), public.get_avatars(text[]) from public, anon;
grant execute on function public.set_my_avatar(jsonb), public.get_avatars(text[]) to authenticated;
