import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const albumId = "00000000-0000-0000-0000-0000000000c9";
const oldAlbumId = "11111111-1111-4111-8111-111111111111";
const artistId = "00000000-0000-0000-0000-000000000065";
const freshAlbum = "8e8a594f-2175-38c7-a871-abb68ec363e7";
const control = "http://127.0.0.1:3101/control";

test("Catalog SQL failures preserve retained Journal pages and actions", async ({ page, request }) => {
  test.skip(process.env.CATALOG_SOURCE !== "local", "Exercises SQL failures under local transport.");
  test.setTimeout(90_000);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const path = `/albums/${albumId}`;
  const savedArtists = "/journal?tab=saved-artists";
  const saveAlbum = page.getByRole("button", { name: "Save to Want to Listen" });
  const removeAlbum = page.getByRole("button", { name: "Remove from Want to Listen" });
  const artistRow = page.locator(`#artist-${artistId}`);
  await request.get(`${control}?musicBrainzOutage=true&reset=true`);
  try {
    execFileSync(process.execPath, ["scripts/catalog-snapshot.mjs", "import", "--fixture", "tests/fixtures/catalog/v2"], {
      env: { ...process.env, CATALOG_DATABASE_URL: process.env.DATABASE_URL, CATALOG_ALLOW_FIXTURES: "1" },
    });
    await page.goto("/sign-up");
    await page.getByLabel("Name", { exact: true }).fill("Catalog Listener");
    await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
    await page.getByLabel("Password").fill("test-password-only-42");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();

    await pool.query("INSERT INTO album (id, title, credited_artist) VALUES ($1, 'Former title', 'Former credit')", [oldAlbumId]);
    await page.goto(`/albums/${oldAlbumId}`);
    await expect(page.getByRole("heading", { name: "Shared title" })).toBeVisible();
    await saveAlbum.click();
    await expect(removeAlbum).toBeVisible();
    await page.goto("/search/artists?q=Shared+artist");
    await artistRow.getByRole("button", { name: "Save artist", exact: true }).click();
    await expect(artistRow.getByRole("button", { name: /Remove from Saved Artists/ })).toBeVisible();

    await pool.query("ALTER TABLE catalog.state RENAME TO unavailable_state");
    await page.goto(savedArtists);
    await expect(artistRow).toBeVisible();
    await page.goto("/discover");
    await expect(page.getByLabel("Seed artist").getByText("Shared artist · Mexican electronic duo")).toHaveCount(1);
    await page.goto(path);
    await expect(removeAlbum).toBeVisible();
    await page.getByRole("button", { name: "Log listen", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Listen logged.");
    await expect(saveAlbum).toBeVisible();
    await pool.query("ALTER TABLE catalog.unavailable_state RENAME TO state");

    await pool.query(`
      ALTER TABLE catalog.album_redirect RENAME TO unavailable_album_redirect;
      ALTER TABLE catalog.artist_redirect RENAME TO unavailable_artist_redirect
    `);
    await page.goto(path);
    await expect(page.getByRole("region", { name: "Your listens" }).locator("time")).toHaveCount(1);
    await saveAlbum.click();
    await expect(removeAlbum).toBeVisible();
    await removeAlbum.click();
    await expect(saveAlbum).toBeVisible();
    await page.goto(savedArtists);
    await artistRow.getByRole("button", { name: /Remove from Saved Artists/ }).click();
    await expect(artistRow).toHaveCount(0);
    await page.goto(`/albums/${freshAlbum}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
    const search = await page.request.get("/api/catalog/search?kind=album&q=Kind+of+Blue");
    // Search reads indexed terms directly and can still use an intact active generation.
    expect(search.status()).toBe(200);

    await pool.query("ALTER TABLE catalog.unavailable_album_redirect RENAME TO album_redirect");
    await page.goto(`/albums/${freshAlbum}`);
    await expect(page.getByRole("heading", { name: "Kind of Blue" })).toBeVisible();
    await pool.query("ALTER TABLE catalog.album RENAME TO unavailable_album");
    await saveAlbum.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
    await page.reload();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
    expect(await (await request.get(control)).json()).toEqual([]);
  } finally {
    await request.get(`${control}?musicBrainzOutage=false&reset=true`);
    await pool.end();
  }
});
