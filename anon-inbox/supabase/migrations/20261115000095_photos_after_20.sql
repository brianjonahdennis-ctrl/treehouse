-- Photos in private chats unlock sooner (Hydra, 15 Nov 2026): after 20 text messages exchanged
-- (was 50), with at least 5 from each person (was 10), so one person alone can't unlock them.

set lock_timeout = '5s';

create or replace function dating_private.photos_unlocked(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.accepted_at is not null
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id and m.sender_id = c.user_a
                                   and m.photo is null and m.deleted_at is null limit 5) a) >= 5
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id and m.sender_id = c.user_b
                                   and m.photo is null and m.deleted_at is null limit 5) b) >= 5
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id
                                   and m.photo is null and m.deleted_at is null limit 20) t) >= 20
    from dating_conversations c where c.id = p_conv), false);
$$;
revoke execute on function dating_private.photos_unlocked(uuid) from public, anon, authenticated;
