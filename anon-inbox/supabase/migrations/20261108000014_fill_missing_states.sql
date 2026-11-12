-- Repair: from late on 7 Nov 2026 the sign-up screen sometimes saved new dating cards without their
-- state (a feature check ran before sign-in finished). The state they picked was still saved as the
-- card's location, so copy it back, and start their Discover filter on it like everyone else's.
update public.dating_profiles
set state = location,
    pref_state = coalesce(pref_state, location)
where state is null
  and location = any (dating_private.nigerian_states());
