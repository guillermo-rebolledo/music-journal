import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const oldSeed = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const currentSeed = "00000000-0000-0000-0000-000000000065";
const otherSeed = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const studio = "14141414-1414-4414-8414-141414141414";
const currentStudio = "00000000-0000-0000-0000-000000000108";
const popular = "42424242-4242-4242-8242-424242424242";
const currentPopular = "00000000-0000-0000-0000-000000000206";
const lowerRanked = "41414141-4141-4141-8141-414141414141";
const starter = "6e335887-60ba-38f0-95af-fae7774336bf";

test.skip(process.env.CATALOG_SOURCE !== "local", "Uses local Catalog snapshots");

function importFixture(version: "v1" | "v2") {
  const fixture = mkdtempSync(join(tmpdir(), "music-journal-discover-"));
  try {
    cpSync(`tests/fixtures/catalog/${version}`, fixture, { recursive: true });
    const afterMerge = version === "v2";
    writeFileSync(join(fixture, "TIMESTAMP"), `2026-01-0${afterMerge ? 4 : 3} 00:00:00.123456+00\n`);
    writeFileSync(join(fixture, "REPLICATION_SEQUENCE"), afterMerge ? "4\n" : "3\n");
    if (afterMerge) {
      const dump = join(fixture, "mbdump");
      const artist = join(dump, "artist");
      const group = join(dump, "release_group");
      writeFileSync(artist, readFileSync(artist, "utf8").replace(studio, currentStudio));
      writeFileSync(group, readFileSync(group, "utf8").replace(popular, currentPopular)
        .replace(lowerRanked, "00000000-0000-0000-0000-000000000205")
        .replace(starter, "00000000-0000-0000-0000-000000000215"));
      appendFileSync(join(dump, "artist_gid_redirect"), `${studio}\t8\t2026-01-04 00:00:00+00\n`);
      appendFileSync(join(dump, "release_group_gid_redirect"),
        `${popular}\t6\t2026-01-04 00:00:00+00\n` +
        `${lowerRanked}\t5\t2026-01-04 00:00:00+00\n` +
        `${starter}\t15\t2026-01-04 00:00:00+00\n`);
    }
    execFileSync(process.execPath, ["scripts/catalog-snapshot.mjs", "import", "--fixture", fixture], {
      env: { ...process.env, CATALOG_DATABASE_URL: process.env.DATABASE_URL, CATALOG_ALLOW_FIXTURES: "1" },
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function saveArtist(page: Page, id: string) {
  const row = page.locator(`#artist-${id}`);
  await row.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(row.getByRole("button", { name: /Remove from Saved Artists/ })).toBeVisible();
}

test("Discover and Artist search use merged identities through upstream failures", async ({ page, request }) => {
  test.setTimeout(90_000);
  const control = process.env.CATALOG_TEST_PROVIDER_CONTROL ?? "http://127.0.0.1:3101/control";
  await request.get(`${control}?musicBrainzOutage=true&reset=true`);
  try {
    importFixture("v1");
    await page.goto("/sign-up");
    await page.getByLabel("Name", { exact: true }).fill("Discover Listener");
    await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
    await page.getByLabel("Password").fill("test-password-only-42");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();

    await page.goto("/search/artists?q=Shared+artist");
    await saveArtist(page, oldSeed);
    await page.goto("/search/artists?q=Related+studio+artist");
    await saveArtist(page, studio);
    await page.goto(`/albums/${popular}`);
    await page.getByRole("button", { name: "Save to Want to Listen" }).click();
    await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    await page.goto(`/albums/${lowerRanked}`);
    await page.getByRole("button", { name: "Log listen", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Listen logged.");

    importFixture("v2");
    await page.goto("/search/artists?q=Shared+artist");
    await expect(page.locator(`#artist-${currentSeed}`).getByRole("button", { name: /Remove from Saved Artists/ })).toBeVisible();
    await expect(page.locator(`#artist-${otherSeed}`).getByRole("button", { name: "Save artist", exact: true })).toBeVisible();
    await saveArtist(page, otherSeed);

    const discover = `/discover?seed=${oldSeed}`;
    const related = page.getByRole("region", { name: "Related artists" });
    const starters = page.getByRole("region", { name: "Handpicked albums" });
    await page.goto(discover);
    await expect(page.getByLabel("Seed artist")).toHaveValue(currentSeed);
    await expect(related.getByText("Based on Shared artist · Mexican electronic duo", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Seed artist").getByRole("option", { name: "Related studio artist" })).toHaveCount(1);
    await expect(related.getByRole("listitem").getByText("Related studio artist", { exact: true })).toHaveCount(1);
    await expect(related.getByText("Related fallback artist", { exact: true })).toBeVisible();
    await expect(related.getByText("Related sparse artist", { exact: true })).toBeVisible();
    await expect(related.getByText("Fourth related artist", { exact: true })).toHaveCount(0);
    await expect(related.getByText("Shared artist", { exact: true })).toHaveCount(0);
    await expect(related.getByText("Saved to Saved Artists", { exact: true })).toBeVisible();
    await expect(related.getByText("No album suggestion available.")).toBeVisible();
    await expect(related.getByRole("link", { name: "Unranked studio album", exact: true })).toBeVisible();
    await expect(related.getByRole("link", { name: "Fallback album", exact: true })).toBeVisible();
    await expect(related.getByRole("link", { name: /Popular album|Lower ranked album|Promotional album|Compilation|Upcoming album|Popular single|Undated album/ })).toHaveCount(0);

    await page.goto(`/albums/${popular}`);
    await page.getByRole("button", { name: "Remove from Want to Listen" }).click();
    await expect(page.getByRole("button", { name: "Save to Want to Listen" })).toBeVisible();
    await page.goto(discover);
    const suggestion = related.getByRole("link", { name: "Popular album", exact: true });
    await expect(suggestion).toHaveAttribute("href", `/albums/${currentPopular}`);
    await expect(related.getByRole("link", { name: "Unranked studio album", exact: true })).toHaveCount(0);

    await request.get(`${control}?outage=true`);
    await page.goto(`/discover?seed=${otherSeed}`);
    await expect(related.getByRole("status")).toContainText("Related artists are temporarily unavailable.");
    const starterLink = starters.getByRole("link", { name: "In Rainbows", exact: true });
    await expect(starterLink).toHaveAttribute("href", `/albums/${starter}`);
    await starterLink.click();
    await page.getByRole("button", { name: "Save to Want to Listen" }).click();
    await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    await page.getByRole("button", { name: "Log listen", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Listen logged.");
    await page.goto("/journal");
    await expect(page.getByRole("tabpanel", { name: /Recent listens/ }).getByRole("link", { name: "In Rainbows" })).toBeVisible();
    await page.goto("/discover");
    await expect(starters.getByRole("link", { name: "In Rainbows", exact: true })).toHaveCount(0);

    const calls: { url: string }[] = await (await request.get(control)).json();
    expect(calls.map(({ url }) => url.split("?")[0])).toEqual(expect.arrayContaining([
      `/1/lb-radio/artist/${currentSeed}`, `/1/popularity/top-release-groups-for-artist/${currentStudio}`,
      "/1/popularity/top-release-groups-for-artist/ffffffff-ffff-4fff-8fff-ffffffffffff",
      `/1/lb-radio/artist/${otherSeed}`,
    ]));
    expect(calls.every(({ url }) => url.startsWith("/1/"))).toBe(true);
  } finally {
    await request.get(`${control}?outage=false&musicBrainzOutage=false&reset=true`);
  }
});
