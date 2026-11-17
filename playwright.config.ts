import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const databaseURL = process.env.DATABASE_URL;

if (!databaseURL || new URL(databaseURL).pathname !== "/music_journal_test") {
  throw new Error("Run npm test to start the isolated Journal test database.");
}

export default defineConfig({
  testDir: "./tests",
  use: { ...devices["Desktop Chrome"], baseURL },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/sign-in`,
    env: { BETTER_AUTH_URL: baseURL },
  },
});
