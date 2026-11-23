import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const miles = "8e8a594f-2175-38c7-a871-abb68ec363e7";

test.skip(process.env.CATALOG_SOURCE !== "local", "Uses the local Catalog and isolated snapshot database");

function importFixture(version: "v1" | "v2") {
  const scratch = mkdtempSync(join(tmpdir(), "music-journal-search-"));
  const fixture = join(scratch, version);
  try {
    cpSync(`tests/fixtures/catalog/${version}`, fixture, { recursive: true });
    appendFileSync(join(fixture, "mbdump", "artist_alias"),
      "3\t3\tShared artist\t\\N\t0\t\\N\t\\N\tShared artist\t\\N\t\\N\t\\N\t\\N\t\\N\t\\N\tf\tf\n");
    // Put the 2005 match below the unfiltered cap, using native release-group rows.
    for (let i = 100; i < 121; i++) {
      const id = String(i).padStart(12, "0");
      appendFileSync(join(fixture, "mbdump", "release_group"),
        `${i}\t00000000-0000-0000-0001-${id}\tShared title\t1\t1\t\t0\t\\N\n`);
      appendFileSync(join(fixture, "mbdump", "release"),
        `${i}\t00000000-0000-0000-0002-${id}\tShared title\t1\t${i}\t1\t\\N\t\\N\t\\N\t\\N\t\t0\t-1\t\\N\n`);
      appendFileSync(join(fixture, "mbdump", "release_country"), `${i}\t1\t1998\t\\N\t\\N\n`);
    }
    execFileSync(process.execPath, ["scripts/catalog-snapshot.mjs", "import", "--fixture", fixture], {
      env: { ...process.env, CATALOG_DATABASE_URL: process.env.DATABASE_URL, CATALOG_ALLOW_FIXTURES: "1" },
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("local Catalog ranking, filters and lookups work during a MusicBrainz outage", async ({ page, request }) => {
  const control = process.env.LOCAL_CATALOG_TEST_CONTROL ?? "http://127.0.0.1:3101/control";
  await request.get(`${control}?outage=true&reset=1`);
  try {
    expect((await request.get("/api/catalog/search?kind=album&q=Shared")).status()).toBe(401);
    await page.goto("/sign-up");
    await page.getByLabel("Name", { exact: true }).fill("Catalog Listener");
    await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
    await page.getByLabel("Password").fill("test-password-only-42");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();

    const search = (q: string, kind = "album", filters = {}) =>
      page.request.get(`/api/catalog/search?${new URLSearchParams({ kind, q, ...filters })}`);

    const unavailable = await search("Kind of Blue");
    expect(unavailable.status()).toBe(503);
    expect((await unavailable.json()).error).toMatch(/temporarily unavailable/);

    await page.goto("/search?q=Kind+of+Blue");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
    importFixture("v1");

    const response = await search("Kind of Blue Miles Davis");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect((await response.json()).matches[0]).toMatchObject({ id: miles, title: "Kind of Blue", detail: "Miles Davis", year: 1959 });
    for (const q of ["Kind of Blue", "Kind of Bl", "Miles Davis Kind of Blue", "Blue Davis Kind Miles of", "Kind of Bule"]) {
      const { matches } = await (await search(q)).json();
      expect(matches[0]?.id, q).toBe(miles);
    }
    for (const [q, kind, title] of [
      ["GetzGilberto", "album", "Getz / Gilberto"],
      ["Titulo compartido", "album", "Shared title"],
      ["Miles Davs", "artist", "Miles Davis"],
      ["Joao Gilberto", "artist", "João Gilberto"],
      ["宇多田", "artist", "宇多田ヒカル"],
      ["Utada Hikaru", "artist", "宇多田ヒカル"],
    ]) {
      const { matches } = await (await search(q, kind)).json();
      expect(matches[0]?.title, q).toBe(title);
    }
    const empty = await search("qzxvjk nfqzvx");
    expect(empty.status()).toBe(200);
    expect((await empty.json()).matches).toEqual([]);
    expect((await (await search("Miles Davis")).json()).matches).toEqual([]);

    const { matches } = await (await search("Shared title")).json();
    expect(matches).toHaveLength(20);
    expect(matches.map((match: { id: string }) => match.id)).not.toContain("22222222-2222-4222-8222-222222222222");
    const filtered = await search("Shared title", "album", { year: "2005", artist: "Second Artist" });
    expect(await filtered.json()).toMatchObject({
      matches: [{ id: "22222222-2222-4222-8222-222222222222" }],
      choices: { years: ["2005", "1998"], artists: ["First Artist & Guest", "Second Artist"] },
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/search?q=Shared+title&year=2005&artist=Second+Artist");
    await expect(page.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(1);
    await expect(page.getByText("Second Artist · 2005")).toBeVisible();
    await page.getByRole("button", { name: "Filters (2 active)" }).click();
    await page.getByRole("combobox", { name: "Release year" }).click();
    await expect(page.getByRole("option", { name: "1998", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear filters" }).click();
    const popup = page.getByRole("dialog", { name: "Search results" });
    await expect(popup.getByRole("link", { name: /Shared title/ })).toHaveCount(20);
    const input = page.getByRole("combobox", { name: "Album title" });
    await input.focus();
    await input.press("ArrowDown");
    await expect(popup.getByRole("link").first()).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    const { matches: artists } = await (await search("Shared artist", "artist")).json();
    await page.goto("/search/artists?q=Shared+artist");
    const rows = page.locator(".album-list > li");
    await expect(rows).toHaveCount(artists.length);
    expect(await rows.evaluateAll((items) => items.map((item) => item.id))).toEqual(
      artists.map((artist: { id: string }) => `artist-${artist.id}`),
    );
    expect(artists.slice(0, 2).map((artist: { detail: string }) => artist.detail)).toEqual([
      "British folk singer", "Mexican electronic duo",
    ]);

    await page.goto(`/albums/${miles}`);
    await expect(page.getByRole("heading", { name: "Kind of Blue", exact: true })).toBeVisible();
    await page.goto("/albums/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("This album could not be found in the catalog.");

    importFixture("v2");
    await page.goto("/albums/11111111-1111-4111-8111-111111111111");
    await expect(page.getByRole("heading", { name: "Shared title", exact: true })).toBeVisible();
    const { matches: refreshed } = await (await search("Titulo compartido")).json();
    expect(refreshed[0]?.id).toBe("00000000-0000-0000-0000-0000000000c9");

    expect(await (await request.get(control)).json()).toEqual([]);
  } finally {
    await request.get(`${control}?outage=false`);
  }
});
