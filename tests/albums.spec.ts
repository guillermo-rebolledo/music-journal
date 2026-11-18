import { expect, test, type Page } from "@playwright/test";

const first = "11111111-1111-4111-8111-111111111111";
const sparse = "33333333-3333-4333-8333-333333333333";
const control = "http://127.0.0.1:3101/control";

async function account(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Album Listener");
  await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("test-password-only-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
}

async function search(page: Page, q: string) {
  await page.goto("/search");
  await page.getByLabel("Album title").fill(q);
  await page.getByLabel("Album title").press("Enter");
}

test.afterEach(async ({ request }) => { await request.get(`${control}?outage=false`); });

test("ambiguous albums, concurrent saves, reloads, removal, outages and account isolation", async ({ page, browser, baseURL, request }) => {
  await account(page);
  await page.getByRole("link", { name: "Search albums" }).click();
  await page.getByLabel("Album title").fill("Shared title");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("First Artist & Guest · 1998")).toBeVisible();
  await expect(page.getByText("Second Artist · 2005")).toBeVisible();
  await expect(page.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(2);
  await expect(page.getByText("Unknown artist · Year unknown")).toBeVisible();
  await page.getByRole("link", { name: "Shared title", exact: true }).first().click();
  await expect(page).toHaveURL(`/albums/${first}`);
  await expect(page.getByText("No cover available")).toBeVisible();
  const anotherTab = await page.context().newPage();
  await anotherTab.goto(`/albums/${first}`);
  const save = page.getByRole("button", { name: "Save to Want to Listen", exact: true });
  // Replay the same mutation concurrently at the server boundary as well as using two tabs.
  const sent = page.waitForRequest((req) => req.method() === "POST" && req.url().includes(`/albums/${first}`));
  await save.click();
  const mutation = await sent;
  const headers = mutation.headers();
  const replies = await Promise.all([0, 1].map(() => page.request.post(`/albums/${first}`, {
    data: mutation.postDataBuffer()!, headers: { "content-type": headers["content-type"], "next-action": headers["next-action"], origin: baseURL! },
  })));
  for (const reply of replies) expect(reply.ok()).toBeTruthy();
  await anotherTab.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await page.goto("/journal");
  await expect(page.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(1);

  const other = await browser.newContext({ baseURL });
  try {
    const second = await other.newPage();
    await account(second);
    await expect(second.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(0);
    await second.goto(`/albums/${first}?listenerId=someone-else`);
    await expect(second.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
    await expect(second.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    await request.get(`${control}?outage=true&reset=true`);
    await page.reload();
    await page.getByRole("link", { name: "Shared title", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Shared title", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove from Want to Listen" }).click();
    await expect(page.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    await page.getByRole("button", { name: "Remove from Want to Listen" }).click();
    await expect(page.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();
    await page.goto("/journal");
    await expect(page.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(0);
    await second.reload();
    await expect(second.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    expect(await (await request.get(control)).json()).toEqual([]);
  } finally { await other.close(); await anotherTab.close(); }
});

test("search coalesces repeated requests, bounds results and spaces provider calls", async ({ page, request }) => {
  await account(page);
  await request.get(`${control}?reset=true`);
  const q = `cache ${crypto.randomUUID()}`;
  const url = `/search?${new URLSearchParams({ q })}`;
  const responses = await Promise.all([page.request.get(url), page.request.get(url)]);
  for (const response of responses) expect(response.ok()).toBeTruthy();
  await search(page, `different ${crypto.randomUUID()}`);
  await expect(page.getByRole("link", { name: "Shared title", exact: true })).toHaveCount(2);
  const requests = await (await request.get(control)).json();
  expect(requests).toHaveLength(2);
  expect(requests[1].time - requests[0].time).toBeGreaterThanOrEqual(1000);
  expect(requests[0].agent).toContain("MusicJournal/0.1 (https://github.com/");
  expect(requests[0].url).toContain("limit=20");
});

test("no matches, upstream failures, timeout and rate limits have distinct recovery paths", async ({ page, request }) => {
  await account(page);
  await search(page, "empty");
  await expect(page.getByText("No albums found. Try another title.")).toBeVisible();
  await search(page, "failure");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await page.getByRole("link", { name: "Retry search" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await search(page, "malformed");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await search(page, "timeout");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("took too long");
  await search(page, "throttled");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("catalog is busy");
  await request.get(`${control}?reset=true`);
  await search(page, "must respect retry after");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("catalog is busy");
  expect(await (await request.get(control)).json()).toEqual([]);
  await expect(async () => {
    await page.getByRole("link", { name: "Retry search" }).click();
    await expect(page.getByRole("heading", { name: /Albums matching/ })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 12000, intervals: [1000] });
  await page.goto("/albums/not-a-valid-id");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be found");
});

test.describe("phone album flow", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  test("keyboard search and wishlist controls work with missing metadata", async ({ page }) => {
    await account(page);
    await page.goto("/search");
    await page.getByLabel("Album title").focus();
    await page.keyboard.type("Sparse album");
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "Sparse album", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/albums/${sparse}`);
    await expect(page.getByText("Unknown artist · Year unknown")).toBeVisible();
    await expect(page.getByText("No cover available")).toBeVisible();
    await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole("button", { name: "Remove from Want to Listen" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();
  });
});

test("live album suggestions filter and open by keyboard", async ({ page, request }) => {
  expect((await request.get("/api/catalog/search?kind=album&q=Shared")).status()).toBe(401);
  await account(page);
  await page.goto("/search");
  await page.keyboard.press("Control+k");
  const input = page.getByLabel("Album title");
  await expect(input).toBeFocused();
  await input.fill("Shared title");
  const popup = page.getByRole("dialog", { name: "Search results" });
  await expect(popup.getByRole("link", { name: /Shared title/ })).toHaveCount(2);
  await popup.getByText("Filters", { exact: true }).click();
  await popup.getByLabel("Release year").selectOption("2005");
  await expect(popup.getByRole("link")).toHaveCount(1);
  await input.focus();
  await input.press("ArrowDown");
  const result = popup.getByRole("link", { name: /Shared title.*Second Artist.*2005/ });
  await expect(result).toBeFocused();
  await result.press("Escape");
  await expect(popup).toBeHidden();
  await expect(input).toBeFocused();
  await input.press("ArrowDown");
  await expect(result).toBeVisible();
  await expect(result).toBeFocused();
  await result.press("Enter");
  await expect(page).toHaveURL("/albums/22222222-2222-4222-8222-222222222222");
});
