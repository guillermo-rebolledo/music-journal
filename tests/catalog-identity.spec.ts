import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

const oldAlbum = "11111111-1111-4111-8111-111111111111";
const currentAlbum = "00000000-0000-0000-0000-0000000000c9";
const oldArtist = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const currentArtist = "00000000-0000-0000-0000-000000000065";
const otherArtist = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const unknownAlbum = "55555555-5555-4555-8555-555555555555";
const control = process.env.CATALOG_TEST_PROVIDER_CONTROL ?? "http://127.0.0.1:3101/control";

function snapshot(...args: string[]) {
  execFileSync(process.execPath, ["scripts/catalog-snapshot.mjs", ...args], {
    env: { ...process.env, CATALOG_DATABASE_URL: process.env.DATABASE_URL, CATALOG_ALLOW_FIXTURES: "1" },
  });
}

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Catalog Listener");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test-password-only-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();
}

const albumPath = (id: string) => `/albums/${id}`;
const queuePath = "/journal?tab=want-to-listen";
const artistsPath = "/journal?tab=saved-artists";
const save = (page: Page) => page.getByRole("button", { name: "Save to Want to Listen" });
const remove = (page: Page) => page.getByRole("button", { name: "Remove from Want to Listen" });
const queue = (page: Page) => page.getByRole("tabpanel", { name: /Want to Listen/ });
const artists = (page: Page) => page.getByRole("tabpanel", { name: /Saved Artists/ });
const history = (page: Page) => page.getByRole("region", { name: "Your listens" }).locator("time");
const artistRow = (page: Page, id: string) => artists(page).locator(`#artist-${id}`);

async function log(page: Page, date: string) {
  await page.getByLabel("Listen date (UTC)").fill(date);
  await page.getByRole("button", { name: "Log listen", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Listen logged.");
}

test.use({ timezoneId: "UTC" });

test("a Catalog merge combines memberships and preserves repeat listens through either link", async ({ page, context, browser, baseURL, request }) => {
  test.skip(process.env.CATALOG_SOURCE !== "local", "Uses the local Catalog with an isolated fixture database.");
  test.setTimeout(90_000);
  const email = `${crypto.randomUUID()}@example.test`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const other = await browser.newContext({ baseURL });
  await request.get(`${control}?outage=true&reset=true`);
  try {
    await signUp(page, email);
    await page.goto(albumPath(unknownAlbum));
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
    expect(await (await request.get(control)).json()).toEqual([]);

    snapshot("import", "--fixture", "tests/fixtures/catalog/v1");
    await page.goto(albumPath(oldAlbum));
    await log(page, "2000-02-29");
    await save(page).click();
    await expect(remove(page)).toBeVisible();

    // Model retained rows from before the fixture feed, when the IDs were distinct.
    await pool.query("INSERT INTO album (id, title, credited_artist, original_year) VALUES ($1, 'Shared title', 'First Artist & Guest', 1998)", [currentAlbum]);
    await pool.query("INSERT INTO want_to_listen (listener_id, album_id, created_at) SELECT id, $1, '2001-04-05T12:00:00Z' FROM \"user\" WHERE email = $2", [currentAlbum, email]);
    await pool.query("INSERT INTO artist (id, name, disambiguation) VALUES ($1, 'Shared artist', 'Mexican electronic duo'), ($2, 'Shared artist', 'British folk singer')", [currentArtist, otherArtist]);
    await pool.query("INSERT INTO saved_artist (listener_id, artist_id) SELECT listener.id, artist.id FROM \"user\" AS listener CROSS JOIN artist WHERE listener.email = $1 AND artist.id IN ($2, $3)", [email, currentArtist, otherArtist]);

    await page.goto(artistsPath);
    // Submit a first-time save through the Artist action without relying on search ranking.
    await artistRow(page, otherArtist).locator("form").evaluate((form: HTMLFormElement, id) => {
      (form.elements.namedItem("artistId") as HTMLInputElement).value = id;
      (form.elements.namedItem("intent") as HTMLInputElement).value = "save";
    }, oldArtist);
    await artistRow(page, otherArtist).getByRole("button").click();
    await expect(artistRow(page, oldArtist)).toBeVisible();

    const oldLink = await context.newPage();
    await oldLink.goto(albumPath(oldAlbum));
    const oldArtistForm = await context.newPage();
    await oldArtistForm.goto(artistsPath);
    await expect(artistRow(oldArtistForm, oldArtist)).toBeVisible();

    snapshot("import", "--fixture", "tests/fixtures/catalog/v2");
    await page.goto(queuePath);
    await expect(queue(page).getByRole("listitem")).toHaveCount(1);
    await expect(queue(page).locator("time").first()).toHaveText("2001-04-05");
    await expect(queue(page).getByRole("link", { name: "Shared title" })).toHaveAttribute("href", albumPath(currentAlbum));

    await page.goto(artistsPath);
    await expect(artists(page).getByRole("listitem")).toHaveCount(2);
    await artistRow(oldArtistForm, oldArtist).getByRole("button", { name: /Remove from Saved Artists/ }).click();
    await expect(artists(oldArtistForm).getByRole("listitem")).toHaveCount(1);
    await expect(artists(oldArtistForm).getByText("British folk singer")).toBeVisible();

    await page.goto(albumPath(currentAlbum));
    await expect(history(page)).toHaveText(["2000-02-29"]);
    await expect(remove(page)).toBeVisible();
    const otherPage = await other.newPage();
    await signUp(otherPage, `${crypto.randomUUID()}@example.test`);
    await otherPage.goto(albumPath(oldAlbum));
    await save(otherPage).click();
    await expect(remove(otherPage)).toBeVisible();

    const logRequest = oldLink.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(albumPath(oldAlbum)));
    await log(oldLink, "2000-02-29");
    await page.reload();
    await expect(history(page)).toHaveText(["2000-02-29", "2000-02-29"]);
    await expect(save(page)).toBeVisible();
    await otherPage.reload();
    await expect(remove(otherPage)).toBeVisible();
    await expect(history(otherPage)).toHaveCount(0);

    await oldLink.reload();
    await Promise.all([save(oldLink).click(), save(page).click()]);
    await Promise.all([expect(remove(oldLink)).toBeVisible(), expect(remove(page)).toBeVisible()]);
    const submission = await logRequest;
    const headers = submission.headers();
    const replay = await oldLink.request.post(submission.url(), {
      data: submission.postDataBuffer()!,
      headers: { "content-type": headers["content-type"], "next-action": headers["next-action"], origin: baseURL! },
    });
    expect(replay.ok()).toBeTruthy();

    snapshot("rollback");
    await page.goto(queuePath);
    await expect(queue(page).getByRole("listitem")).toHaveCount(1);
    await expect(queue(page).getByRole("link", { name: "Shared title" })).toHaveAttribute("href", albumPath(currentAlbum));
    snapshot("rollback");

    await oldLink.reload();
    await remove(oldLink).click();
    await expect(save(oldLink)).toBeVisible();
    await page.goto(queuePath);
    await expect(queue(page).getByRole("listitem")).toHaveCount(0);

    // A missing active generation leaves existing durable actions available.
    await pool.query("UPDATE catalog.state SET active_generation = NULL");
    await page.goto(albumPath(currentAlbum));
    await expect(history(page)).toHaveText(["2000-02-29"]);
    await page.goto(albumPath(oldAlbum));
    await expect(history(page)).toHaveText(["2000-02-29"]);
    await save(page).click();
    await expect(remove(page)).toBeVisible();
    await remove(page).click();
    await expect(save(page)).toBeVisible();
    expect(await (await request.get(control)).json()).toEqual([]);
  } finally {
    await request.get(`${control}?outage=false&reset=true`);
    await other.close();
    await pool.end();
  }
});

test("remote rollback keeps snapshot aliases for Journal writes and Discover exclusions", async ({ page, request }) => {
  test.skip(process.env.CATALOG_SOURCE !== "remote" || process.env.CATALOG_TEST_REMOTE_SNAPSHOT !== "1",
    "Uses an isolated remote run with its own active snapshot.");
  test.setTimeout(90_000);
  const email = `${crypto.randomUUID()}@example.test`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await request.get(`${control}?reset=true`);
  try {
    await signUp(page, email);
    await page.goto(albumPath(oldAlbum));
    await log(page, "2000-02-29");
    await save(page).click();
    await expect(remove(page)).toBeVisible();

    await page.goto("/search/artists?q=Shared+artist");
    await page.locator(`#artist-${oldArtist}`).getByRole("button", { name: "Save artist", exact: true }).click();
    await expect(page.locator(`#artist-${oldArtist}`).getByRole("button", { name: /Remove from Saved Artists/ })).toBeVisible();

    snapshot("import", "--fixture", "tests/fixtures/catalog/v2");
    // Model a MusicBrainz merge from a release group still returned by remote Discover.
    await pool.query(`
      INSERT INTO catalog.album_redirect (generation, old_mbid, mbid)
      SELECT active_generation, '42424242-4242-4242-8242-424242424242', $1
      FROM catalog.state
    `, [currentAlbum]);

    await page.goto(queuePath);
    await expect(queue(page).getByRole("link", { name: "Shared title" })).toHaveAttribute("href", albumPath(currentAlbum));
    await page.goto(albumPath(currentAlbum));
    await expect(history(page)).toHaveText(["2000-02-29"]);
    await expect(remove(page)).toBeVisible();
    await log(page, "2004-02-29");
    await expect(save(page)).toBeVisible();
    await page.goto(albumPath(oldAlbum));
    await expect(history(page)).toHaveText(["2004-02-29", "2000-02-29"]);
    await page.goto(queuePath);
    await expect(queue(page).getByRole("listitem")).toHaveCount(0);

    await page.goto("/search/artists?q=Shared+artist");
    await expect(page.locator(`#artist-${oldArtist}`).getByRole("button", { name: /Remove from Saved Artists/ })).toBeVisible();
    await page.goto(`/discover?seed=${oldArtist}`);
    await expect(page.getByLabel("Seed artist")).toHaveValue(currentArtist);
    const related = page.getByRole("region", { name: "Related artists" });
    await expect(related.getByRole("link", { name: "Lower ranked album" })).toBeVisible();
    await expect(related.getByRole("link", { name: "Popular album" })).toHaveCount(0);
    const calls: { url: string }[] = await (await request.get(control)).json();
    expect(calls.some(({ url }) => url.startsWith("/release-group/?") && url.includes("rgid"))).toBe(true);
  } finally {
    await pool.end();
  }
});
