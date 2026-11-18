# Chat list: less work for the database (18 Nov 2026)

**Why:** at the evening peak (8:35pm, 18 Nov) the chat-list refresh took 43% of the database's time,
at about 217 ms a call, and the database was overloaded.

**What changes (members see no difference):**
- **Likes and passes:** the database only marks a chat list as changed for people whose list really
  changed. The person who sends a like isn't marked any more, and a plain pass marks nobody.
- **Profile edits:** these no longer mark the chat list of everyone that person liked.
- **Likes and requests arriving:** the app groups these into at most one chat-list refresh every
  20 seconds. New matches, accepted requests and messages in a new chat still show straight away,
  and new messages in existing chats are as instant as before.
- **Online dots:** on Home and the Inbox these are kept fresh by a small call every 2 minutes
  (about 21 ms, against about 280 ms for a full rebuild). The full chat-list rebuild now happens
  every 10 minutes instead of every 3.

**Database change to apply:** `anon-inbox/supabase/migrations/20261118200000_inbox_fewer_rebuilds.sql`
(safe to run twice). Apply it before the app goes live. Older apps keep working: they treat the new
"new chat" signal like the old one.

**Tested:** 16 checks on the live database inside a transaction that was undone (likes, passes,
removed likes, like changed to pass, profile edits, online dots matching the chat list for a member
with 238 chats, old and new refresh functions, the new-chat signal). The preview (mock mode) showed:
- a burst of likes led to one refresh
- a second burst inside 20 seconds waited
- a new chat refreshed at once
- online dots changed without a rebuild

Typecheck and build pass.

**Still to check on a real phone:** like someone and get matched (the chat appears at once), receive
likes while on the Inbox, and watch a friend's online dot change.
