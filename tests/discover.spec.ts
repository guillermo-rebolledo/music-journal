import { expect, test, type Page } from "@playwright/test";

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Discover Listener");
  await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("test-password-only-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
}

test.describe("phone Discover", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("a new listener can save and log a starter album by keyboard during an outage", async ({ page, request }) => {
    const control = "http://127.0.0.1:3101/control";
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/sign-in$/);
    await signUp(page);

    await request.get(`${control}?outage=true&reset=true`);
    try {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Music Journal" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Journal", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Discover", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
      await expect(page.getByRole("listitem")).toHaveCount(3);
      const starter = page.getByRole("listitem").filter({ hasText: "In Rainbows" });
      await expect(starter.getByText("Radiohead · 2007")).toBeVisible();
      await expect(starter.getByText("No cover", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

      await starter.getByRole("link", { name: "In Rainbows" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "In Rainbows" })).toBeVisible();
      await expect(page.getByText("No cover available")).toBeVisible();
      await page.getByRole("button", { name: "Save to Want to Listen" }).press("Enter");
      await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
      await page.getByRole("button", { name: "Log listen" }).press("Enter");
      await expect(page.getByRole("status")).toHaveText("Listen logged.");
      await expect(page.getByRole("button", { name: "Save to Want to Listen" })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
      await expect(starter).toHaveCount(0);
      expect(await (await request.get(control)).json()).toEqual([]);
    } finally {
      await request.get(`${control}?outage=false`);
    }
  });
});

test("saving, removing and logging starter albums updates only the current listener’s shelf", async ({ page, browser, baseURL }) => {
  await signUp(page);
  const discover = async () => {
    await page.getByRole("link", { name: "Discover", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  };
  const starter = (name: string) => page.getByRole("region", { name: "Handpicked albums" }).getByRole("link", { name, exact: true });
  const journal = async () => {
    await page.getByRole("link", { name: "Back to Journal" }).click();
    await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  };
  const save = page.getByRole("button", { name: "Save to Want to Listen", exact: true });
  const remove = page.getByRole("button", { name: "Remove from Want to Listen", exact: true });
  const queue = page.getByRole("region", { name: "Want to Listen" });
  const recent = page.getByRole("region", { name: "Recent listens" });

  await discover();
  await starter("In Rainbows").click();
  await save.click();
  await expect(remove).toBeVisible();

  await journal();
  await page.reload();
  await expect(queue.getByRole("link", { name: "In Rainbows" })).toBeVisible();
  await discover();
  await expect(starter("In Rainbows")).toHaveCount(0);
  await page.reload();
  await expect(starter("In Rainbows")).toHaveCount(0);

  await starter("Getz / Gilberto").click();
  await expect(save).toBeVisible();
  await page.getByRole("button", { name: "Log listen" }).click();
  await expect(page.getByRole("status")).toHaveText("Listen logged.");
  await journal();
  await page.reload();
  await expect(recent.getByRole("link", { name: "Getz / Gilberto" })).toBeVisible();
  await expect(queue.getByRole("link", { name: "Getz / Gilberto" })).toHaveCount(0);
  await discover();
  await expect(starter("Getz / Gilberto")).toHaveCount(0);
  await page.reload();
  await expect(starter("Getz / Gilberto")).toHaveCount(0);

  await starter("Discovery").click();
  await save.click();
  await expect(remove).toBeVisible();
  await journal();
  await discover();
  await expect(page.getByText("You’ve saved or logged every starter album.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Search albums" })).toHaveAttribute("href", "/search");

  const other = await browser.newContext({ baseURL });
  try {
    const second = await other.newPage();
    await signUp(second);
    await second.getByRole("navigation").getByRole("link", { name: "Discover", exact: true }).click();
    await expect(second.getByRole("listitem")).toHaveCount(3);
  } finally {
    await other.close();
  }

  await page.getByRole("navigation").getByRole("link", { name: "Journal", exact: true }).click();
  await queue.getByRole("link", { name: "In Rainbows" }).click();
  await remove.click();
  await expect(save).toBeVisible();
  await journal();
  await expect(queue.getByRole("link", { name: "In Rainbows" })).toHaveCount(0);
  await discover();
  await expect(starter("In Rainbows")).toBeVisible();
});

async function saveSeed(page: Page, name: string, q = "shared") {
  await page.goto(`/search/artists?${new URLSearchParams({ q })}`);
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Save artist" }).click();
  await expect(row.getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();
}

test("Discover suggests released albums, refreshes after journal actions, and scopes the seed", async ({ page, request, browser, baseURL }) => {
  const control = "http://127.0.0.1:3101/control";
  await signUp(page);
  await page.goto("/discover");
  await expect(page.getByText("Save an artist to find related artists.", { exact: true })).toBeVisible();
  await saveSeed(page, "Mexican electronic duo");
  await request.get(`${control}?reset=true`);
  await page.goto("/discover");
  await page.getByLabel("Seed artist").selectOption({ label: "Shared artist · Mexican electronic duo" });
  await page.getByRole("button", { name: "Find related artists" }).click();
  const shelf = page.getByRole("region", { name: "Related artists" });
  await expect(shelf.getByText("Based on Shared artist · Mexican electronic duo", { exact: true })).toBeVisible({ timeout: 15000 });
  const seedUrl = page.url();
  const studio = shelf.getByRole("listitem").filter({ has: page.getByText("Related studio artist", { exact: true }) });
  const sparse = shelf.getByRole("listitem").filter({ has: page.getByText("Related sparse artist", { exact: true }) });
  await expect(studio.getByRole("link", { name: "Popular album", exact: true })).toBeVisible();
  await expect(shelf.getByRole("link", { name: "Fallback album", exact: true })).toBeVisible();
  await expect(sparse.getByText("No album suggestion available.")).toBeVisible();
  await expect(shelf.getByText("Fourth related artist")).toHaveCount(0);
  await expect(shelf.getByText("Shared artist", { exact: true })).toHaveCount(0);
  const providerCalls = await (await request.get(control)).json();
  const radioCalls = providerCalls.filter(({ url }: { url: string }) => url.startsWith("/1/"));
  expect(radioCalls).toHaveLength(4);
  for (const [i, call] of radioCalls.entries()) {
    expect(new URL(call.url, control).pathname).toMatch(
      /^\/1\/(?:lb-radio\/artist|popularity\/top-release-groups-for-artist)\/[a-f0-9-]{36}$/,
    );
    expect(call.agent).toContain("MusicJournal/");
    expect(call.privateHeaders).toBe(false);
    if (i) expect(call.time - radioCalls[i - 1].time).toBeGreaterThanOrEqual(950);
  }
  expect(JSON.stringify(providerCalls)).not.toMatch(/example\.test|Discover Listener|Mexican electronic duo/);

  await studio.getByRole("button", { name: "Save artist" }).click();
  await expect(studio.getByText("Saved to Saved Artists")).toBeVisible();
  await expect(page.getByLabel("Seed artist").getByRole("option", { name: "Related studio artist" })).toHaveCount(1);
  await studio.getByRole("link", { name: "Popular album" }).click();
  await page.getByRole("button", { name: "Save to Want to Listen" }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await page.goBack();
  await expect(shelf.getByRole("link", { name: "Popular album", exact: true })).toHaveCount(0);
  await studio.getByRole("link", { name: "Lower ranked album" }).click();
  await page.getByRole("button", { name: "Log listen" }).click();
  await expect(page.getByText("Listen logged.")).toBeVisible();
  await page.goBack();
  await expect(studio.getByRole("link", { name: "Unranked studio album" })).toBeVisible();
  await expect(shelf.getByRole("link", { name: "Lower ranked album" })).toHaveCount(0);

  await page.goto("/journal");
  await expect(page.getByRole("region", { name: "Want to Listen" }).getByRole("link", { name: "Popular album" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent listens" }).getByRole("link", { name: "Lower ranked album" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Saved Artists" }).getByText("Related studio artist")).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    const second = await other.newPage();
    await signUp(second);
    await request.get(`${control}?reset=true`);
    await second.goto(seedUrl);
    await expect(second.getByText("This seed artist is no longer in your Saved Artists.")).toBeVisible();
    await expect(second.getByText(/Based on Shared artist/)).toHaveCount(0);
    expect(await (await request.get(control)).json()).toEqual([]);

    await saveSeed(second, "Mexican electronic duo");
    await request.get(`${control}?reset=true`);
    await second.goto(seedUrl);
    await expect(second.getByRole("link", { name: "Popular album", exact: true })).toBeVisible();
    const repeated = await (await request.get(control)).json();
    expect(repeated.every(({ url }: { url: string }) => url.startsWith("/1/popularity/"))).toBe(true);
  } finally {
    await other.close();
  }
});

test.describe("phone related artists", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("keyboard seed selection keeps starters through empty results, outages, and throttling", async ({ page, request }) => {
    const control = "http://127.0.0.1:3101/control";
    await signUp(page);
    await saveSeed(page, "British folk singer");
    await saveSeed(page, "Sparse artist");
    await saveSeed(page, "Related studio artist", "discovery test seeds");
    await saveSeed(page, "Related fallback artist", "discovery test seeds");
    await page.goto("/discover");
    const select = page.getByLabel("Seed artist");
    const submit = page.getByRole("button", { name: "Find related artists" });
    await select.focus();
    await select.press("End");
    await select.press("ArrowUp");
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Based on Shared artist · British folk singer", { exact: true })).toBeVisible();
    await expect(page.getByText("No related artists found. Try another Saved Artist.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    const unavailable = page.getByRole("status").filter({ hasText: "Related artists are temporarily unavailable." });
    const starters = page.getByRole("region", { name: "Handpicked albums" });
    await request.get(`${control}?outage=true`);
    try {
      await select.selectOption({ label: "Related studio artist" });
      await submit.press("Enter");
      await expect(page.getByText("Based on Related studio artist", { exact: true })).toBeVisible();
      await expect(unavailable).toBeVisible();
      await expect(starters.getByRole("link", { name: "In Rainbows" })).toBeVisible();
    } finally {
      await request.get(`${control}?outage=false`);
    }

    await request.get(`${control}?radioThrottled=true&reset=true`);
    try {
      await select.selectOption({ label: "Sparse artist" });
      await submit.press("Enter");
      await expect(page.getByText("Based on Sparse artist", { exact: true })).toBeVisible();
      await expect(unavailable).toBeVisible();
      await select.selectOption({ label: "Related fallback artist" });
      await submit.press("Enter");
      await expect(page.getByText("Based on Related fallback artist", { exact: true })).toBeVisible();
      await expect(unavailable).toBeVisible();
      await expect(starters.getByRole("link", { name: "In Rainbows" })).toBeVisible();
      expect(await (await request.get(control)).json()).toHaveLength(1);
    } finally {
      await request.get(`${control}?radioThrottled=false`);
    }
  });
});
