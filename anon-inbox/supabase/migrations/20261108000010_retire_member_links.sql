-- treehouse is for anonymous dating only. Members' anonymous links are retired: nobody can claim a
-- link or send to one any more. (The owner's own link on the home page runs on the treehouse server
-- itself and isn't affected.) Existing link data is left in place here; deleting it is a separate step.
revoke execute on function public.send_link_message(text, text), public.public_link(text),
  public.claim_link(text, text, text), public.username_available(text) from public, anon, authenticated;
