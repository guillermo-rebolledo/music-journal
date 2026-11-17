#!/bin/sh
set -eu

container=$(docker run --detach --rm --publish 127.0.0.1::5432 \
  --env POSTGRES_USER=journal --env POSTGRES_PASSWORD=journal \
  --env POSTGRES_DB=music_journal_test postgres:17-alpine)
trap 'docker stop "$container" >/dev/null' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U journal -d music_journal_test >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

address=$(docker port "$container" 5432/tcp)
export DATABASE_URL="postgres://journal:journal@$address/music_journal_test"
export BETTER_AUTH_SECRET="$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
npm run db:migrate
playwright test "$@"
