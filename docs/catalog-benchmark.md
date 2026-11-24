# Catalog search benchmark and rollout

Use this benchmark for [issue #21](https://github.com/guillermo-rebolledo/music-journal/issues/21). Run it from one checkout against isolated test deployments and separate test data. The runner uses the signed-in `GET /api/catalog/search` endpoint with `kind` and `q` and scores the ordered `matches[].id` values. It issues search requests only. The JSON reports contain fixed corpus queries, result MBIDs and titles, timings, and outcomes.

## Corpus provenance

The [labeled corpus](../scripts/catalog-benchmark-corpus.json) contains 46 queries (24 Album, 22 Artist) and 23 verified identities. On 2026-11-23, the labels were checked against public MusicBrainz entity records, using `https://musicbrainz.org/release-group/<id>` for Album and `https://musicbrainz.org/artist/<id>` for Artist. The entity table records the intended identity and the query rows reference it by key. The 1959 Miles Davis release group is the target for every Kind of Blue variant. Alias cases include the Café Tacuba spelling and Utada Hikaru and Cubic U. [Kind of Blue release group](https://musicbrainz.org/release-group/8e8a594f-2175-38c7-a871-abb68ec363e7) · [Café Tacvba aliases](https://musicbrainz.org/artist/c2b37a39-c66a-44b2-b190-a69485ae5d95/aliases) · [Utada aliases](https://musicbrainz.org/artist/b539e453-c4fe-47e3-8a07-8517eac74429/aliases)

The title-only Greatest Hits row accepts either the Queen or 1988 Fleetwood Mac Album. The Spanish title En vivo en Buenos Aires accepts either the Los Fabulosos Cadillacs or Rata Blanca Album. The Zoé namesake row accepts the Mexican group or Belgian vocalist Zoé Dufour. These are labeled alternatives for the corresponding ambiguous queries. The two fabricated strings labeled `empty` express an expectation of zero results. Keep the corpus fixed through a comparison. If a source correction changes a label or MBID, review it against MusicBrainz and rerun both paths. [Queen](https://musicbrainz.org/release-group/69ce61c8-127f-3809-95d8-62fdf3ae1347) · [Fleetwood Mac](https://musicbrainz.org/release-group/d84bfe53-d7e6-326b-b639-e5c3951caa06) · [Los Fabulosos Cadillacs](https://musicbrainz.org/release-group/6307ddcb-3296-34af-8881-d8bae4eb49d5) · [Rata Blanca](https://musicbrainz.org/release-group/2eaf497a-e1d1-3c17-b6e7-ec0d3551b431) · [Mexican Zoé](https://musicbrainz.org/artist/5838185a-0ee6-4a0b-8d4e-76a6e15f7d4b) · [Belgian Zoé](https://musicbrainz.org/artist/3db5be93-a4de-4af4-802d-d6e32de1725a)

## Collect evidence

Prepare one remote-mode baseline running the old search path and one local-mode candidate with a validated, production-sized snapshot. Confirm the mode of each deployment before starting. Record the deployment revisions, region, database and pool setup, snapshot version, active generation and source timestamp, and the freshness threshold selected for the environment. Leave snapshot publication idle during the primary comparison. Collect the outage and refresh exercises in a separate window.

Use Node 22.9 or later. In a Bash session, use the Cookie header from an existing signed-in test listener's request on each matching origin. Paste only the header value at the hidden prompt. Collect one baseline at a time in a quiet test environment with no other benchmark or traffic sharing its provider quota. Keep the normal provider rate limiter enabled. The runner waits at least 1.1 seconds after each response, honors `Retry-After` and the endpoint's `retryAfter`, and applies a minimum five-second pause after HTTP 429 or 503. It records each query once and stops sending on redirects, 401/403, or a cooldown above 60 seconds. Preserve the partial report if that happens, and run a new full baseline after resolving the cause and waiting out the cooldown. Document whether the baseline used an existing provider cache. [MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)

```bash
export CATALOG_BENCHMARK_ORIGIN='https://remote-test.example'
read -rsp 'Remote test Cookie header: ' CATALOG_BENCHMARK_COOKIE; echo
export CATALOG_BENCHMARK_COOKIE
node scripts/catalog-benchmark.mjs baseline > /tmp/catalog-baseline.json
unset CATALOG_BENCHMARK_COOKIE

export CATALOG_BENCHMARK_ORIGIN='https://local-test.example'
read -rsp 'Local test Cookie header: ' CATALOG_BENCHMARK_COOKIE; echo
export CATALOG_BENCHMARK_COOKIE
# Set these from the active snapshot and the chosen freshness threshold.
snapshot_at='2026-11-23T08:00:00Z'
max_age_hours=168

# Only use this as cold evidence with an independently confirmed cold app/pool.
node scripts/catalog-benchmark.mjs cold "$snapshot_at" "$max_age_hours" > /tmp/catalog-cold.json
node scripts/catalog-benchmark.mjs local "$snapshot_at" "$max_age_hours" > /tmp/catalog-local.json
unset CATALOG_BENCHMARK_COOKIE CATALOG_BENCHMARK_ORIGIN

node scripts/catalog-benchmark.mjs compare /tmp/catalog-baseline.json /tmp/catalog-local.json \
  > /tmp/catalog-comparison.json
```

For the cold sample, restart the isolated app instance and clear or recycle its app connection pool before issuing the single `Kind of Blue` request. Record which layers were cold, including whether Postgres itself kept its buffers warm. When the hosting platform prevents confirming cold state, mark it as unverified.

For the warm measurement, use a stable test instance or confirm from telemetry that the measured requests reach instances with warmed database connections. The local runner sends five parallel searches across both kinds to prime the app and pool. It then measures three full passes with up to five requests in flight. Confirm pool warmup in the app or database telemetry for the measurement window. A distributed deployment may route warmup and measurement to different instances. Rerun after establishing warmed connections if that happens.

## Read the reports

- **Relevance.** `compare` requires both reports to match this checkout's corpus SHA-256 and query order. It scores the first local pass against the baseline, using queries with valid, fresh HTTP results on both sides. The correct top-five rate is the share of paired positive queries with any labeled MBID in positions 1–5. The empty cases are evaluated separately. Inspect both rates and denominators, per-query ranks, regressions, exact misses, and missing comparisons. Require a higher local rate, all labeled exact queries in the local top five, and both expected-empty queries returning zero matches. A partial baseline makes the relevance gate inconclusive even when the paired scores differ.
- **Miles Davis.** Require the 1959 MBID within the top five for `Kind of Bl`, `Kind of Blue Miles Davis`, and the reverse credit/title order. For the two credit/title orders, require it ahead of any other returned Album whose normalized title contains the phrase Kind of Blue. Review the saved titles for other similarly named Albums. The ordering check is inconclusive when the response omits a title above the expected MBID.
- **Outcomes.** A successful `matches: []` is a completed query and stays in the evidence. Non-200 status, an application error including HTTP 200 cooldown, an invalid body, network failure, timeout, and unattempted queries have their own outcomes. Successful responses served from a cache with positive HTTP `Age` or warning 110, or served after the supplied snapshot freshness deadline, are marked `stale`. Check the active generation and its source timestamp independently since the search response does not report either.
- **Latency.** Require warm local p95 of 500 ms or less. The runner uses nearest rank over successful measured HTTP requests, including valid empty results. It measures from request start through JSON parsing, so it includes transport and excludes browser debounce. Reconcile the measurement with server-side Search latency from the same window. Stale or failed warmup or measurement requests make the latency gate inconclusive. Keep the cold report separate. Report server and DB configuration, sample counts, response failures, and the UTC windows in the rollout evidence.
- **Provider traffic.** Require zero MusicBrainz requests during local search. Verify this against existing provider telemetry or an instrumented provider stub used in the isolated test deployment. The search HTTP response alone cannot establish the upstream call count. Check the JSON gates and operational evidence together before enabling local mode.

## Enablement and rollback

1. Use the Catalog import runbook to stage, validate, and activate the snapshot in the isolated test environment. Confirm the active generation and source timestamp, smoke search both kinds, and retain a previous validated generation for rollback. Capture the first full staging import's duration, storage, temporary peak, and query impact.
2. Collect the baseline, candidate and comparison evidence, and review the gates. Repeat the local search exercise during a simulated MusicBrainz outage and during a refresh. Confirm the old validated generation serves during staging, each request uses one complete generation through activation, and provider traffic stays at zero.
3. In preview, verify authenticated search, save, log, and Discover, including retained entries and known merged IDs. Keep an eye on snapshot age and import failures, request errors and timeouts, and search latency. Enable local mode for the intended environment only after the evidence is complete and deployment is authorized.
4. For a bad generation, use the import runbook's explicit rollback to reselect the previous validated generation. Verify active state, source age, signed-in searches and existing Journal records. For an emergency local read-path failure, use the deployment's explicit remote-mode setting and verify the rate limiter, cooldown and Search behavior. Restore local mode once a validated generation and the local read path are healthy. Both rollback paths preserve Journal data.
