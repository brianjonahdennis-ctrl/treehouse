-- Fix: private chats insert straight into dating_messages as the signed-in user, so the filter
-- trigger ran with that user's rights and couldn't read dating_private.filter_words
-- ("permission denied for table filter_words"). The filter now runs with the owner's rights.
create or replace function dating_private.filter_pattern() returns text
language sql stable security definer set search_path = dating_private as $$
  select '\m(' || string_agg(word, '|' order by length(word) desc) || ')\M' from dating_private.filter_words;
$$;

alter function dating_private.clean_text(text) security definer;
alter function dating_private.clean_body() security definer;
alter function dating_private.clean_bio() security definer;

revoke all on function dating_private.filter_pattern() from public, anon, authenticated;
revoke all on function dating_private.clean_text(text) from public, anon, authenticated;
