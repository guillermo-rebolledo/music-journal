import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const databaseURL = process.env.DATABASE_URL;

if (!databaseURL || new URL(databaseURL).pathname !== "/music_journal_test") {
  throw new Error("Run npm test to start the isolated Journal test database.");
}

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/catalog-import.test.mjs",
  workers: 1,
  timeout: 45000,
  use: { ...devices["Desktop Chrome"], baseURL },
  webServer: [{
    command: "node tests/provider-stub.mjs",
    url: "http://127.0.0.1:3101/health",
  }, {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/sign-in`,
    env: {
      BETTER_AUTH_URL: baseURL,
      MUSICBRAINZ_BASE_URL: "http://127.0.0.1:3101",
      LISTENBRAINZ_BASE_URL: "http://127.0.0.1:3101",
      COVER_ART_ARCHIVE_BASE_URL: "http://127.0.0.1:3101",
      WIKIDATA_BASE_URL: "http://127.0.0.1:3101/wikidata",
      COMMONS_BASE_URL: "http://127.0.0.1:3101/commons",
    },
  }],
});
