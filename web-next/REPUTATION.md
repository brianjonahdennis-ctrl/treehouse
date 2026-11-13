# Bird Kingdom levels & Community Star Ratings

> Your time earns your Bird Kingdom level. Your interactions shape your reputation. Your safety is
> protected independently.

Three separate systems, kept in separate tables:

| System | What decides it | Tables / functions |
|---|---|---|
| **Bird Kingdom** | accumulated active hours only | `dating_private.bird_kingdom`, `activity_ping()`, `my_bird()` |
| **Community Star Rating** | anonymous 1–5 star ratings | `dating_private.star_ratings`, `rating_pairs`, `reputation`, `rating_config` |
| **Safety** (unchanged) | blocks, reports, moderation | `dating_blocks`, `dating_reports`, `room_reports`, … |

Block and report tables are **never** read by the rating calculation. A pgTAP test checks this.

---

## 1. Bird Kingdom

| Level | Bird | Cumulative active hours |
|---|---|---|
| 1 | Sparrow | 0–4 |
| 2 | Dove | 5–19 |
| 3 | Kingfisher | 20–49 |
| 4 | Hawk | 50–99 |
| 5 | Eagle | 100–249 |
| 6 | Owl | 250–499 |
| 7 | Falcon | 500–999 |
| 8 | Phoenix | 1,000+ |

The level is stored, and it only ever goes up: `level = greatest(level, level_for(total))`.

### Live tracking (after launch)

- **Who decides what counts.** The app calls `activity_ping()` once a minute. It only calls while the
  page is visible **and** the person has touched, typed or scrolled in the last 2 minutes. On the
  Games and Speed Dating screens, being on screen counts on its own, because the input happens
  inside a video or game.
- **How time is counted.** The server counts time from its own clock, never the phone's. A ping adds
  the time since the previous ping, at most 60 seconds, and only if the previous ping was under 90
  seconds ago. A gap longer than that means the person was idle, in the background or offline, so
  that gap adds nothing.
- **Two devices at once.** One row per person means two phones pinging alternately still add up to
  real elapsed time. Pinging faster earns nothing extra.
- **Daily cap.** At most 16 hours of active time per Lagos day.
- **Storage.** Hours live in `post_launch_seconds`, separate from `historical_seconds`.
  Total = historical + post-launch. Signing out or changing phone loses nothing.

### Recognising history (one-time import at launch)

There were no session logs before launch, so history is **estimated** from what *was* recorded:

1. **Sources:** every message a person sent, in chatrooms (`room_messages`) and chats
   (`dating_messages`), plus the time spent on Speed Dating dates (`speed_sessions`).
2. **Grouping into sessions:** sent messages are sorted by time. A gap of more than 10 minutes starts
   a new session.
3. **Session length:** last message minus first message, plus 2 minutes for reading around it.
4. **Speed Dating:** the real date length is added on top.
5. **Daily cap:** at most 16 hours per day.
6. **What can't be measured:** reading-only time and browsing were never recorded, so the estimate
   errs on the low side. It never invents time.
7. **Status:** each person's row gets a `migration_status`:
   - `migrated`: had activity
   - `no_activity_data`: nothing recorded, so they start at Sparrow
   - `suspicious`: an unusually high message rate
8. **Retries:** the import only touches rows still marked `pending`, so running it again never
   double-counts.
9. **Undo:** the import writes only to the new table. Deleting the new tables undoes it, and existing
   data is never changed.

---

## 2. Community Star Ratings

### Who can rate whom

Ratings happen **only from a profile**: "Rate this user", 1–5 stars, then press Submit. There are
no pop-ups. A person can rate someone else if one of these is true:

| Basis | Rule |
|---|---|
| Friend / dating match | An accepted chat between them that is not declined, not cleared or deleted by the rater, and not blocked either way. Both people have sent at least 2 messages in it. |
| Chatroom | Both are in the same room right now. In the last 14 days, each has sent at least 3 messages in that room, at least one message from each within 30 minutes of the other. |

On top of that:

- **No self-rating.**
- **7-day cooldown:** one rating per person every rolling 7 days, separately in each direction. It is
  enforced atomically with `rating_pairs`.
- **Daily limit:** at most 20 ratings per rater per day.
- **New accounts:** accounts younger than 2 days can't rate.

### The calculation (hourly, `refresh_reputation()`)

All the numbers below live in `dating_private.rating_config` and can be changed without new code.

| Key | Default | Meaning |
|---|---|---|
| `prior_mean` | 5.0 | Everyone starts at 5.0. |
| `prior_weight` | 5 | The 5.0 counts as 5 ratings, so a single rating can't swing the score. |
| `half_life_days` | 90 | A rating's weight halves every 90 days, so recent ratings count more. |
| `min_raters` | 5 | Below 5 different raters: "New member · not enough ratings yet". |
| `burst_threshold` / `burst_weight` | 8 / 0.5 | More than 8 ratings for one person in 60 minutes: those count half (brigading). |
| `exchange_weight` | 0.5 | A and B give each other 5 stars within 10 minutes: both count half (rating swaps). |
| `high_band` / `review_band` | 4.0 / 3.0 | The discovery bands. |
| `speed_head_start_s` | 60 | Speed Dating head start for the high band. |

The formula:

```
w(rating)  = 0.5 ^ (age_days / half_life) × burst factor × exchange factor
per rater  : value = weighted mean of that rater's ratings for this person;
             weight = max w of those ratings          (one person = at most one vote)
score      = (prior_weight × 5.0 + Σ weight·value) / (prior_weight + Σ weight)
```

`established = distinct raters ≥ min_raters`. Until then the profile shows "New member" instead of
a proven score, and the band is High.

**Bands:**

| Score | Band | What happens |
|---|---|---|
| ≥ 4.0, or not yet established | **High** | Normal priority. |
| 3.0 – 3.9 | **Lower** | Lower priority. |
| < 3.0 | **Review** | Ranked like Lower, and flagged on the owner's Stats for a human look. No automatic ban. |

### Discovery priority

- **Nearby:** results are sorted High band first, then by distance (or by "active", whichever the
  person chose). Every existing filter still applies: age, gender, interests, radius, blocks,
  paused, hidden distance.
- **Speed Dating:** the High band gets a 60-second head start in the waiting order
  (`joined_at - 60 s`). Everything else is unchanged: mutual preferences, no repeat pairing within
  24 h, blocks, the daily limit and the match break. Someone in the Lower band who has waited more
  than 60 seconds longer is always picked first, so nobody is overlooked forever.
- **Hidden:** queue positions are never shown to anyone.

### Privacy

- **Hidden from everyone:** who rated whom.
- **Your own dashboard:** your score, your number of ratings and your band. The star distribution
  and the weekly trend appear only once you have 5 or more raters, and they are never shown per
  rating.
- **Notifications:** none are sent when someone rates you.
- **Audit:** the internal records (rater, time, validity) stay in `dating_private`. Members can't
  reach them through any function.
