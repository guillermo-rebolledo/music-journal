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
