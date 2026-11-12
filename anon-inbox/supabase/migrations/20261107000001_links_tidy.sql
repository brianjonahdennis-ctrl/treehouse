-- Sign-in-only link functions: remove the default visitor (anon) access Supabase grants new functions.
revoke execute on function public.claim_link(text, text, text), public.report_link_message(bigint, text) from anon;
