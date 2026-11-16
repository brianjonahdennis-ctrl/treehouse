# Treasure Hunt: operating and capacity notes

## Design

Camera frames, visual overlay, compass and route directions run in the member's browser or phone. The camera is never uploaded. GPS is read locally for directions and sent only after the member taps to claim a checkpoint; the database uses that one reading for the distance check and does not save it. The iOS app shell hides the camera view, while the clue and location check remain available.

The member app calls existing Supabase RPCs through `lib/api.ts`. A screen visit loads the active hunt list once (kept in a 60-second in-memory cache per open app), joining loads the route, and a claim sends one request. There is no hunt polling or new live channel. Leaderboard pages are fetched only when opened or when the member asks for another page; pages are cached in memory for 30 seconds. The active-hunt list returns counts and no checkpoint coordinates; route coordinates are returned only to a member who joins.

Checkpoint and finish RPCs lock the participant row and enforce one award per checkpoint and one completion bonus. Claims accept a client request ID for safe retries and allow at most 10 attempts per participant per minute. Leaderboards use keyset pagination, cap pages at 50, and expose a handle and game score, not account IDs or profile details. Private tables have RLS enabled, direct member access revoked, and staff edits use the existing MFA-checked role and audit log.

## Capacity model (estimates, not measured results)

Assumptions: a 90-minute hunt, five checkpoints, one catalogue open and join/resume, one final claim, and leaderboard use by a minority of participants. A typical active player is expected to make about **0.08–0.15 Treasure Hunt API requests per minute** averaged across the hunt. The average includes the first screen and later checkpoint actions; during a short launch burst, requests will be higher. A checkpoint or finish action is a single RPC transaction, with roughly 3–6 indexed reads/writes. A catalogue RPC performs a bounded set of hunt/checkpoint/participant lookups. A leaderboard page reads at most 51 ordered rows from its board index and joins profile handles.

| Concurrent players | Estimated steady Hunt requests | Estimated steady DB statements* | Estimated Hunt bandwidth** |
|---:|---:|---:|---:|
| 100 | 8–15/min (0.13–0.25/sec) | about 0.5–1.5/sec | about 0.01–0.06 Mbit/sec |
| 1,000 | 80–150/min (1.3–2.5/sec) | about 5–15/sec | about 0.1–0.6 Mbit/sec |
| 10,000 | 800–1,500/min (13–25/sec) | about 50–150/sec | about 1–6 Mbit/sec |

\*Statement estimates multiply the request rate by approximately 4–6 statements per RPC. They exclude unrelated Treehouse activity and should be replaced with observed database query counts. \**Assumes 10–30 KB round-trip per RPC with text/JSON responses, no maps or image uploads. Mobile radio/protocol overhead and initial app assets are excluded.

The normal server workload is small JSON and indexed database work; camera rendering and route math consume the member's device CPU and memory. At 10,000 concurrent participants, database connection capacity, transaction wait time, database CPU, and overlap with chat/authentication are the main unknowns. There is no test result yet: this repository has no safe staging database or load-test credentials, and the live database must not be used for this test. These estimates are not a promise that the current infrastructure supports 10,000 concurrent players.

## Safe capacity test and scaling signals

Before opening a large event, run a staged load test against a separate approved test environment with seeded hunts and accounts. Ramp 100 → 500 → 1,000 → 2,500 → 5,000 → 10,000 simulated participants. Mix catalogue opens, joins, one checkpoint every 15–20 minutes, occasional leaderboard first/next pages, and finish calls. Include a launch burst (at least 10× steady request rate for two minutes). Do not send real camera footage or member location histories. Record p50/p95/p99 RPC latency, RPC errors/timeouts, database CPU, memory, active connections, slow queries, lock waits, cache hit rates, and traffic in/out. Run a parallel Treehouse baseline and verify authentication, chat, private messages, Discover, Games and notifications stay within their normal latency/error range.

Recommended pause/escalation thresholds for the test: pause the ramp if database CPU remains above 70% for five minutes, active connections exceed 70% of the configured limit, Hunt RPC p95 exceeds 500 ms or errors exceed 1% for five minutes, or any core Treehouse service's p95 rises more than 20% above its matched baseline. Keep existing capacity until measurement shows a bottleneck. First tune query plans, indexes and event size; only then recommend an approved capacity or workload-isolation change.

Monitor and alert on Hunt RPC request count and rate-limit rejections, error rate and p95/p99 latency; database CPU, memory, connections, slow queries and lock waits; and core app authentication/chat/Discover/Games/notification latency and errors. Set alerts against the site's established service objectives where available. No server, paid service or live database change is part of this feature.
