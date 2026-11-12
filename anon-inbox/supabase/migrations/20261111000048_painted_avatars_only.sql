-- Cartoon avatars are retired: every saved cartoon avatar becomes the closest painted one
-- (same gender, similar skin tone, hair, beard, glasses, outfit and the same background colour).
-- Painted avatars: { st: 'paint', k, s: 1-3, h, fh: n|b, g: none|glasses|shades, o: hoodie|denim, b }.
-- Featured looks ({ st: 'modern', … }) are untouched. The app does the same conversion for anything
-- it meets, so this only tidies what's stored.

set lock_timeout = '5s';

update public.user_avatars a set config = jsonb_strip_nulls(jsonb_build_object(
  'st', 'paint',
  'k', x.k,
  's', case when x.s >= 5 then '3' when x.s >= 3 then '2' else '1' end,
  'h', x.h,
  'fh', case when x.k = 'm' and a.config ->> 'fh' in ('beard', 'goatee', 'stache') then 'b' else 'n' end,
  'g', case a.config ->> 'g' when 'shades' then 'shades' when 'round' then 'glasses' when 'square' then 'glasses' else 'none' end,
  'o', case when a.config ->> 'o' in ('denim', 'bomber') then 'denim' else 'hoodie' end,
  'b', coalesce(a.config ->> 'b', 'pink')))
from (
  select user_id, k,
    coalesce(case when k = 'f' then
        case config ->> 'h' when 'puff' then 'puff' when 'braids' then 'braids' when 'curly' then 'afro' when 'bun' then 'puff'
                           when 'long' then 'silk' when 'bob' then 'bob' when 'ftwists' then 'braids' when 'wrap' then 'wrap' end
      else
        case when config ->> 'hw' in ('cap', 'durag') then config ->> 'hw' else
          case config ->> 'h' when 'fade' then 'fade' when 'waves' then 'fade' when 'hightop' then 'curly' when 'twists' then 'locs'
                             when 'afro' then 'curly' when 'locsm' then 'locs' when 'buzz' then 'fade' when 'bald' then 'bald' when 'none' then 'bald' end end
      end, case when k = 'f' then 'braids' else 'fade' end) as h,
    case when config ->> 's' ~ '^[0-7]$' then (config ->> 's')::int else 3 end as s
  from (
    select user_id, config,
      case when config ->> 'k' = 'f' then 'f'
           when config ->> 'k' = 'x' and config ->> 'h' in ('puff', 'braids', 'curly', 'bun', 'long', 'bob', 'ftwists', 'wrap') then 'f'
           else 'm' end as k
    from public.user_avatars
    where coalesce(config ->> 'st', '') not in ('paint', 'modern')
  ) y
) x
where a.user_id = x.user_id;
