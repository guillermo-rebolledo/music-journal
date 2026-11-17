import { expect, test, type Page, type Request } from "@playwright/test";
import { Pool } from "pg";
import { isListenDate } from "../lib/listen-date";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const direct = "55555555-5555-4555-8555-555555555555";
const control = "http://127.0.0.1:3101/control";
const today = () => new Date().toISOString().slice(0, 10);
const history = (page: Page) => page.getByRole("region", { name: "Your listens" });
const recent = (page: Page) => page.getByRole("region", { name: "Recent listens" });
const queue = (page: Page) => page.getByRole("region", { name: "Want to Listen" });
const logButton = (page: Page) => page.getByRole("button", { name: "Log listen", exact: true });

async function account(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Listen Listener");
  await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("test-password-only-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
}

async function log(page: Page, date?: string) {
  if (date) await page.getByLabel("Listen date (UTC)").fill(date);
  await logButton(page).click();
  await expect(page.getByRole("status")).toHaveText("Listen logged.");
}

async function replay(page: Page, mutation: Request, baseURL: string, data = mutation.postDataBuffer()!) {
  const headers = mutation.headers();
  return page.request.post(mutation.url(), { data, headers: {
    "content-type": headers["content-type"], "next-action": headers["next-action"], origin: baseURL,
  } });
}

test.afterEach(async ({ request }) => { await request.get(`${control}?outage=false`); });

test("search, save, log, reload, backdate, repeat, ordering and account isolation", async ({ page, browser, baseURL }) => {
  await account(page);
  await page.goto("/search?q=Shared+title");
  await page.getByRole("link", { name: "Shared title", exact: true }).first().click();
  await expect(page.getByLabel("Listen date (UTC)")).toHaveValue(today());
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await log(page);
  await expect(page.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();
  await page.reload();
  await expect(history(page).locator("time")).toHaveText([today()]);
  await expect(history(page).getByText("Listened", { exact: true })).toBeVisible();
  await log(page, "2000-02-29");
  await log(page, "2000-02-29");
  await expect(history(page).locator("time")).toHaveText([today(), "2000-02-29", "2000-02-29"]);
  await page.goto(`/albums/${second}`);
  await log(page, "2010-03-04");
  await page.goto("/journal");
  await expect(recent(page).locator("time")).toHaveText([today(), "2010-03-04", "2000-02-29", "2000-02-29"]);
  await expect(queue(page).getByRole("link")).toHaveCount(0);

  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await account(otherPage);
    await expect(recent(otherPage).locator("time")).toHaveCount(0);
    await otherPage.goto(`/albums/${first}?listenerId=someone-else`);
    await expect(history(otherPage).locator("time")).toHaveCount(0);
    await log(otherPage, "1999-01-01");
    await expect(history(otherPage).locator("time")).toHaveText(["1999-01-01"]);
    await page.goto(`/albums/${first}`);
    await expect(history(page).locator("time")).toHaveText([today(), "2000-02-29", "2000-02-29"]);
  } finally { await other.close(); }
});

test("direct logging retains Catalog details and saved albums can be logged during outages", async ({ page, request }) => {
  await account(page);
  await page.goto(`/albums/${direct}`);
  await log(page);
  await request.get(`${control}?outage=true&reset=true`);
  await page.reload();
  await expect(page.getByText("Direct Artist · 2012")).toBeVisible();
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await page.goto("/journal");
  await queue(page).getByRole("link").click();
  await log(page);
  await page.goto("/journal");
  await expect(recent(page).locator("time")).toHaveCount(2);
  await expect(queue(page).getByRole("link")).toHaveCount(0);
  expect(await (await request.get(control)).json()).toEqual([]);
});

// A browser cannot reliably resend the same submission concurrently or after a later re-save.
test("concurrent replays create one listen and old successful submissions preserve re-saves", async ({ page, browser, baseURL }) => {
  await account(page);
  await page.goto(`/albums/${first}`);
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  let mutation: Request;
  await page.route(`**/albums/${first}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    mutation = route.request();
    const responses = await Promise.all([replay(page, mutation, baseURL!), replay(page, mutation, baseURL!)]);
    for (const response of responses) expect(response.ok()).toBeTruthy();
    await route.continue();
  });
  await log(page);
  await page.unroute(`**/albums/${first}`);
  await expect(history(page).locator("time")).toHaveCount(1);
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  expect((await replay(page, mutation!, baseURL!)).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await expect(history(page).locator("time")).toHaveCount(1);
  await log(page);
  await expect(history(page).locator("time")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Save to Want to Listen", exact: true })).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await account(otherPage);
    expect((await replay(otherPage, mutation!, baseURL!)).ok()).toBeTruthy();
    await otherPage.goto(`/albums/${first}`);
    await expect(history(otherPage).locator("time")).toHaveCount(1);
  } finally { await other.close(); }
});

test("server rejects future dates even when browser validation is bypassed", async ({ page }) => {
  await account(page);
  await page.goto(`/albums/${first}`);
  const date = page.getByLabel("Listen date (UTC)");
  for (const invalid of ["9999-12-31", "2023-02-29"]) {
    await date.evaluate((input: HTMLInputElement) => { input.type = "text"; input.form!.noValidate = true; });
    await date.fill(invalid);
    await logButton(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Choose a valid listen date");
    await expect(history(page).locator("time")).toHaveCount(0);
  }
  await log(page, today());
  await expect(history(page).locator("time")).toHaveCount(1);
});

test("a queue removal failure rolls back the listen, and retry succeeds", async ({ page }) => {
  await account(page);
  await page.goto(`/albums/${first}`);
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const key = await page.locator('input[name="submissionKey"]').inputValue();
  try {
    await pool.query(`CREATE FUNCTION reject_test_removal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`);
    await pool.query(`CREATE TRIGGER reject_test_removal BEFORE DELETE ON want_to_listen FOR EACH ROW EXECUTE FUNCTION reject_test_removal()`);
    await logButton(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be logged");
    expect((await pool.query("SELECT * FROM listen WHERE submission_key = $1", [key])).rows).toHaveLength(0);
    await expect(page.locator('input[name="submissionKey"]')).toHaveValue(key);
    await expect(history(page).locator("time")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS reject_test_removal ON want_to_listen");
    await pool.query("DROP FUNCTION IF EXISTS reject_test_removal()");
    await pool.end();
  }
  await log(page);
  await expect(history(page).locator("time")).toHaveCount(1);
});

test("UTC date policy rejects future and impossible dates", () => {
  expect(isListenDate("2024-02-29", "2024-03-01")).toBe(true);
  expect(isListenDate("2024-03-01", "2024-03-01")).toBe(true);
  for (const date of ["2024-03-02", "2023-02-29", "2024-02-30", "2024-13-01", "0000-01-01", "2024-2-01", "invalid"]) {
    expect(isListenDate(date, "2024-03-01")).toBe(false);
  }
});

test.describe("phone listens", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  test("keyboard logging and backdating fit the phone", async ({ page }) => {
    await account(page);
    await page.goto(`/albums/${first}`);
    await page.getByLabel("Listen date (UTC)").fill("2001-01-01");
    await page.getByLabel("Listen date (UTC)").focus();
    await page.keyboard.press("Tab");
    await expect(logButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(history(page).locator("time")).toHaveText(["2001-01-01"]);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});
