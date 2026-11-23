import { expect, test, type Page } from "@playwright/test";

const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const control = "http://127.0.0.1:3101/control";
const password = "test-password-only-42";

async function account(page: Page) {
  const email = `${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Artist Listener");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  return email;
}

async function search(page: Page, q: string) {
  await page.goto(`/search/artists?${new URLSearchParams({ q })}`);
}

function row(page: Page, detail = "Mexican electronic duo") {
  return page.getByRole("listitem").filter({ hasText: detail });
}

test.afterEach(async ({ request }) => { await request.get(`${control}?outage=false`); });

test("ambiguous artists, concurrent saves, persistence across sessions, private removal during outages", async ({ page, browser, baseURL, request }) => {
  const email = await account(page);
  await page.getByRole("tab", { name: /^Saved Artists/ }).click();
  await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();
  await page.getByRole("link", { name: "Search artists" }).click();
  await page.getByLabel("Artist name").fill("Shared artist");
  await page.getByRole("dialog", { name: "Search results" }).getByRole("link", { name: /Mexican electronic duo/ }).click();
  await expect(row(page)).toBeVisible();
  await expect(row(page, "British folk singer")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Invalid artist")).toHaveCount(0);
  const tab = await page.context().newPage();
  const other = await browser.newContext({ baseURL });
  const device = await browser.newContext({ baseURL });
  try {
    await tab.goto(page.url());
    await request.get(`${control}?reset=true`);
    const sent = page.waitForRequest((req) => req.method() === "POST" && req.url().includes("/search/artists"));
    await Promise.all([row(page).getByRole("button", { name: "Save artist", exact: true }).click(), row(tab).getByRole("button", { name: "Save artist", exact: true }).click()]);
    const mutation = await sent;
    const headers = mutation.headers();
    const replies = await Promise.all([0, 1].map(() => page.request.post("/search/artists", {
      data: mutation.postDataBuffer()!, headers: { "content-type": headers["content-type"], "next-action": headers["next-action"], origin: baseURL! },
    })));
    for (const reply of replies) expect(reply.ok()).toBeTruthy();
    await page.goto("/journal?tab=saved-artists");
    await page.reload();
    await expect(row(page)).toHaveCount(1);
    const lookups = await (await request.get(control)).json();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].url).toContain(`/artist/${first}`);

    const returning = await device.newPage();
    await returning.goto("/sign-in");
    await returning.getByLabel("Email").fill(email);
    await returning.getByLabel("Password").fill(password);
    await returning.getByRole("button", { name: "Sign in", exact: true }).click();
    await returning.getByRole("tab", { name: /^Saved Artists/ }).click();
    await expect(row(returning)).toBeVisible();

    const second = await other.newPage();
    await account(second);
    await second.goto(`/journal?tab=saved-artists&listenerId=${email}`);
    await expect(row(second)).toHaveCount(0);
    await search(second, "Shared artist");
    await expect(row(second).getByRole("button", { name: "Save artist", exact: true })).toBeVisible();
    await row(second).getByRole("button", { name: "Save artist", exact: true }).click();
    await expect(row(second).getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();

    await request.get(`${control}?outage=true&reset=true`);
    await page.reload();
    await expect(row(page)).toBeVisible();
    await row(page).getByRole("button", { name: "Remove from Saved Artists" }).click();
    await expect(row(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();
    await returning.reload();
    await expect(row(returning)).toHaveCount(0);
    await second.goto("/journal?tab=saved-artists");
    await expect(row(second)).toBeVisible();
    await search(page, "Shared artist");
    await row(page).getByRole("button", { name: "Save artist", exact: true }).click();
    await expect(row(page).getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();
    expect(await (await request.get(control)).json()).toEqual([]);
  } finally { await tab.close(); await other.close(); await device.close(); }
});

test("first save validates identity and retains errors without trusting submitted metadata", async ({ page, request }) => {
  await account(page);
  await search(page, "Shared artist");
  const target = row(page, "British folk singer");
  await request.get(`${control}?outage=true`);
  await target.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(target.getByRole("alert")).toContainText("temporarily unavailable");
  await page.goto("/journal?tab=saved-artists");
  await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();
  await request.get(`${control}?outage=false`);
  await search(page, "Shared artist");
  await target.locator('input[name="artistId"]').evaluate((input: HTMLInputElement) => { input.value = "invalid"; });
  await target.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(target.getByRole("alert")).toContainText("Choose a valid artist");
  await target.locator('input[name="artistId"]').evaluate((input: HTMLInputElement) => { input.value = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; });
  await target.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(target.getByRole("alert")).toContainText("This artist could not be found");
  await page.goto("/journal?tab=saved-artists");
  await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();
  await page.getByRole("button", { name: /^Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/search/artists?q=Shared");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("artist searches coalesce and share provider spacing with albums", async ({ page, request }) => {
  await account(page);
  await request.get(`${control}?reset=true`);
  const q = `artist cache ${crypto.randomUUID()}`;
  const url = `/search/artists?${new URLSearchParams({ q })}`;
  for (const response of await Promise.all([page.request.get(url), page.request.get(url)])) expect(response.ok()).toBeTruthy();
  await page.goto(`/search?${new URLSearchParams({ q: crypto.randomUUID() })}`);
  const requests = await (await request.get(control)).json();
  expect(requests).toHaveLength(2);
  expect(requests[0].url).toContain("/artist/?");
  expect(requests[0].url).toContain("limit=20");
  expect(requests[0].agent).toContain("MusicJournal/0.1 (https://github.com/");
  expect(requests[1].time - requests[0].time).toBeGreaterThanOrEqual(1000);
});

test("empty artist results, malformed responses, outages, timeouts and rate limits stay distinct", async ({ page, request }) => {
  await account(page);
  await search(page, "empty");
  await expect(page.getByText("No artists found. Try another name.")).toBeVisible();
  for (const q of ["failure", "malformed"]) {
    await search(page, q);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  }
  await search(page, "timeout");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("took too long");
  await search(page, "throttled");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("catalog is busy");
  await request.get(`${control}?reset=true`);
  await page.goto(`/search?${new URLSearchParams({ q: crypto.randomUUID() })}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("catalog is busy");
  expect(await (await request.get(control)).json()).toEqual([]);
  await expect(async () => {
    await page.getByRole("link", { name: "Retry search" }).click();
    await expect(page.getByRole("heading", { name: /Albums matching/ })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 12000, intervals: [1000] });
});

test.describe("phone artist flow", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  test("keyboard search, save and removal work without disambiguation", async ({ page }) => {
    await account(page);
    await page.getByRole("tab", { name: /^Saved Artists/ }).click();
    await page.getByRole("link", { name: "Search artists" }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Artist name").focus();
    await page.keyboard.type("Sparse artist");
    await page.getByRole("dialog", { name: "Search results" }).getByRole("link", { name: "Sparse artist" }).focus();
    await page.keyboard.press("Enter");
    const target = row(page, "Sparse artist");
    await target.getByRole("button", { name: "Save artist", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(target.getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();
    await page.reload();
    await expect(target.getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole("link", { name: "Back to Journal" }).click();
    await target.getByRole("button", { name: "Remove from Saved Artists" }).focus();
    await page.keyboard.press("Enter");
    await expect(target).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});

test("live artist suggestions lead to the selected artist's save control", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ colorScheme: "dark" });
  await account(page);
  await page.goto("/search/artists");
  const input = page.getByLabel("Artist name");
  await page.route("**/api/catalog/search?*", (route) => route.abort(), { times: 1 });
  await input.fill("Shared artist");
  const popup = page.getByRole("dialog", { name: "Search results" });
  await expect(popup.getByRole("alert")).toContainText("temporarily unavailable");
  await popup.getByRole("button", { name: "Try again" }).click();
  await expect(input).toBeFocused();
  const bounds = await popup.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await popup.getByRole("link", { name: /Mexican electronic duo/ }).click();
  await expect(page).toHaveURL(`/search/artists?q=Shared+artist#artist-${first}`);
  await expect(popup).toBeHidden();
  await expect(row(page).getByRole("button", { name: "Save artist", exact: true })).toBeVisible();
});
