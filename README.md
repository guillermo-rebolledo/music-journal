# Music Journal

A private web app for keeping track of album listens, albums you want to listen to, and artists you want to explore. This first slice opens an empty Journal after sign-in.

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

For deployment, set the three environment variables from `.env.example` before building, use an HTTPS app URL and a dedicated database, and apply committed migrations before serving traffic.

## Sign-in

Listeners create an account with a name, email address, and password. Email and password is the initial method so local development and tests can run without a mail service or identity provider. The email serves as the sign-in identifier. Email verification and password recovery are outside this initial flow. Reuse the same credentials on another device to open the same Journal.

Better Auth stores users, credentials, and sessions in Postgres through Drizzle. The Journal resolves the listener from the validated session on the server. Sign-out revokes the current session. Journal entries will need to be scoped to that same server-resolved listener when those features land.

## Verify

```sh
npm run typecheck
npx playwright install chromium
npm test
```

The browser suite starts a fresh Postgres container on a Docker-assigned loopback port, applies the committed migrations, and removes the container when the run finishes. It uses port 3100 for its own app server and generates a fresh auth secret. To run one test, use `npm test -- -g "returning listener"`.
