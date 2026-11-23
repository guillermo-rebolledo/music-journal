# Music Journal

A private web app for keeping track of album listens, albums you want to listen to, and artists you want to explore. Listeners can search albums and artists, log dated listens on album detail pages, and keep private Want to Listen and Saved Artists lists.

## Design system

All UI follows [the Music Journal design system](DESIGN.md). Read it before adding or changing components, styles or screens. Shared primitives live in `components/ui/`; fonts and licenses are self-hosted in `public/fonts/`; tokens and both themes live in `app/globals.css`.

## Run locally

Use Node.js 22.9 or newer and a dedicated Postgres database. With Docker, start a local database and install dependencies.

```sh
docker run --detach --name music-journal-db --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=journal --env POSTGRES_PASSWORD=journal \
  --env POSTGRES_DB=music_journal --volume music-journal-data:/var/lib/postgresql/data \
  postgres:17-alpine
npm ci
cp .env.example .env.local
openssl rand -hex 32
```

Set `BETTER_AUTH_SECRET` in `.env.local` to the generated value. Then run the migrations and start the app at `http://localhost:3000`.

```sh
npm run db:migrate
npm run dev
```

For production deployment, set the three environment variables from `.env.example` before building, use an HTTPS app URL and a dedicated database, and apply committed migrations before serving traffic.

## Vercel previews

Vercel Preview has separate environment-variable scopes from Production and Development. Configure the project once for all preview branches.

- Connect the Neon database to Preview and enable **Create database branch for deployment → Preview**. Each deployment must receive an isolated branch connection, rather than the production connection string. See [Neon's preview-branching setup](https://neon.com/docs/guides/vercel-managed-integration#enable-automated-preview-branching-recommended).
- Generate a separate `BETTER_AUTH_SECRET` for Preview (at least 32 characters), stored as sensitive. Keep the Production secret scoped to Production.
- Keep [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) enabled. Better Auth allows the exact hosts in `VERCEL_URL` and `VERCEL_BRANCH_URL` over HTTPS. Production and local development use the configured `BETTER_AUTH_URL`.
- Apply committed migrations to the preview database if its schema is behind. Redeploy after changing environment scopes; existing deployments retain their original environment.

## Sign-in

Listeners create an account with a name, email address, and password. Email and password is the initial method so local development and tests can run without a mail service or identity provider. The email serves as the sign-in identifier. Email verification and password recovery are outside this initial flow. Reuse the same credentials on another device to open the same Journal.

Better Auth stores users, credentials, and sessions in Postgres through Drizzle. The Journal resolves the listener from the validated session on the server. Sign-out revokes the current session. Dated listens, Want to Listen, and Saved Artists actions use that same server-resolved listener.

## Verify

```sh
npm run typecheck
npx playwright install chromium
npm run test:catalog-browser
```

The Catalog browser command runs the existing suite in explicit remote mode, then runs local search, merged identity, Discover, and SQL outage scenarios in local mode and the snapshot rollback scenario in remote mode. Each run starts its own disposable Postgres container on a Docker-assigned loopback port, applies migrations, and generates a fresh auth secret. The app and provider stub use ports 3100 and 3101. To run only the regular remote suite, use `CATALOG_SOURCE=remote npm test`. To run one test in that suite, use `npm test -- -g "returning listener"`.

## Album catalog and Want to Listen

Set the server-only `CATALOG_SOURCE=local` after publishing a validated Catalog snapshot in the target database. Local mode uses the snapshot for search and fresh Album and Artist lookups. If a refresh fails, the active snapshot keeps serving reads. Set `CATALOG_SOURCE=remote` (the default) for initial setup or to switch those reads back to MusicBrainz. Both modes use known snapshot redirects for Journal identity when the active snapshot is readable. Retained records remain usable by their exact IDs when redirects are unavailable. See the [import runbook](docs/catalog-import.md) and [benchmark and rollout runbook](docs/catalog-benchmark.md).

The public API request controls described below apply in remote mode.

Search uses MusicBrainz release groups with primary type Album. Common reissues share a release-group detail page. Saving validates that identity against the local Catalog or a MusicBrainz lookup, then persists the title, credited artist, and original year. Want to Listen has a unique listener–album key; actions resolve the listener from the server session. Removal is idempotent and never deletes Catalog metadata.

Apply the new migration before serving this version. Album metadata remains available locally after removal, so existing saved album pages and wishlist actions work during provider outages.

All app instances must share the same Postgres database. A transaction advisory lock serializes MusicBrainz requests, rechecks a shared cache after acquiring the lock, and coalesces repeated requests. Requests are separated by at least one second after completion, with a four-second upstream timeout, a five-second lock wait, a bounded connection pool/queue, a 1 MB response cap, and at most 20 search results. The provider's Retry-After response blocks further requests across instances. Successful search results are cached for 15 minutes, identity lookups for one day, and errors for three seconds; expired cache entries are pruned on a provider request. Database connection limits remain deployment-specific; tune the app instance count against available Postgres connections.

`MUSICBRAINZ_BASE_URL` can point server-side requests at a trusted MusicBrainz-compatible endpoint (default: `https://musicbrainz.org/ws/2`). The browser suite starts its own local stub through this setting and never calls the live catalog. It covers ambiguous titles, missing metadata, concurrent/replayed saves, two-account isolation, outages, rate limits, timeout recovery, and phone keyboard use. Before beta, separately spot-check the live provider from the deployment host, including multilingual titles.

See [Catalog snapshot operations](docs/catalog-import.md) for isolated import, validation and rollback.

## Catalog artwork

Album covers use [Cover Art Archive release-group thumbnails](https://musicbrainz.org/doc/Cover_Art_Archive/API). Artist photos match the MusicBrainz artist ID to a Wikidata item, then use its image claim and fetch thumbnail and credit metadata from Wikimedia Commons. Those server lookups reuse the shared provider cache and rate limits. The browser loads thumbnails directly from the image hosts without a referrer. Missing or failed images show an illustrated fallback.

## Listen dates

Listen dates are calendar dates, stored without a time or timezone. “Today” is
the current UTC calendar date, both for the form default and server validation.
The form labels this explicitly. Earlier dates are allowed; future dates and
invalid calendar dates are rejected. Separate submissions may share a date.

Logging directly from an album page validates and retains its Catalog details.
The Journal shows the 50 most recent listens by listen date (newest first), and
each album page shows that listener's full history. Listened status comes from
those records; it does not prevent saving the album again.

Each form submission carries a listener-scoped submission key. Creating its
listen and removing current Want to Listen membership share one transaction.
Replaying a successful key does neither operation again, preserving later
re-saves. Failed submissions keep their key for retry. Apply the dated-listens
migration before serving this version.

## Saved Artists

Use Search artists from the Journal or album search to find MusicBrainz artists
by name. Results show optional disambiguation so artists with the same name can
be distinguished. Saving validates the artist MusicBrainz ID against the local
Catalog or a provider identity lookup and persists its name and disambiguation.
The unique listener–artist key makes repeated and concurrent saves idempotent.
Removal only affects the signed-in listener's membership and retains Catalog
metadata, so the list stays readable, removable, and re-saveable during outages.
Artist and album lookups share the same provider cache, concurrency lock,
rate limits, timeout, response bounds, and error handling described above.

Apply `0003_saved-artists` before serving this version. This also versions the
provider cache keys for the shared album/artist result format; existing cached
album searches will refill under the same provider rate limit. Browser tests
cover ambiguous names, optional disambiguation, identity validation, concurrent
and repeated saves, cross-session persistence, account isolation, provider
failures, shared rate limits, and phone keyboard operation.

## Discover

Discover offers a handpicked shelf before a listener saves any artists. The
`0004_handpicked-shelf` migration retains three Albums in the Journal database,
so the shelf and its Album details work during provider outages.
Albums leave the shelf when the listener saves or logs them. Removing an
unlogged album from Want to Listen makes it eligible again.

Choose a seed from Saved Artists to see up to three Related artists from
ListenBrainz Radio. In local mode, Discover resolves those Artists and checks
ListenBrainz popularity results against the active snapshot. If no ranked
Album qualifies, it checks the local discography newest first with the
MusicBrainz website-default release status policy. The Handpicked shelf
remains available when there is no readable local index.

In remote mode, Discover uses the Radio names, checks the first eight ranked
ListenBrainz release groups against MusicBrainz, and checks one MusicBrainz
discography page of up to twelve release groups. Both modes require a primary
type of Album, exclude compilations, and require a known first release date no
later than today (UTC) at its available precision. The app uses snapshot
redirects when available to identify equivalent Albums and exclude anything
already saved or logged. Provider requests contain public IDs only. Both providers use the
shared Postgres request controls described above, with independent limits and
a minimum one-second gap for each. ListenBrainz success responses are cached for
one day and honor the rate-limit reset headers. Set `LISTENBRAINZ_BASE_URL` to
use a trusted compatible endpoint (default `https://api.listenbrainz.org`).
The browser suite uses the stub for both providers.
