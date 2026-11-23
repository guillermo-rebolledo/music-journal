import { expect, test, type Page } from "@playwright/test";

const password = "test-password-only-42";

async function createAccount(page: Page, name: string) {
  const email = `${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  return email;
}

test("a returning listener can sign in from another browser and sign out", async ({ page, browser, baseURL }) => {
  const email = await createAccount(page, "Nora Listener");
  await page.reload();
  await expect(page.getByText("Nora Listener", { exact: true })).toBeVisible();

  const device = await browser.newContext({ baseURL });
  try {
    const otherPage = await device.newPage();
    await otherPage.goto("/journal");
    await expect(otherPage).toHaveURL(/\/sign-in$/);
    await otherPage.getByLabel("Email").fill(email);
    await otherPage.getByLabel("Password").fill(password);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(otherPage.getByText("Nora Listener", { exact: true })).toBeVisible();

    const signedIn = await device.storageState();
    await otherPage.getByRole("button", { name: /^Account menu/ }).click();
    await otherPage.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(otherPage).toHaveURL(/\/sign-in$/);
    await device.addCookies(signedIn.cookies);
    await otherPage.goto("/journal");
    await expect(otherPage).toHaveURL(/\/sign-in$/);
    await expect(otherPage.getByText("Nora Listener", { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Nora Listener", { exact: true })).toBeVisible();
  } finally {
    await device.close();
  }
});

test("each account sees only its own private Journal", async ({ page, browser, baseURL }) => {
  const email = await createAccount(page, "Ada Listener");

  const secondAccount = await browser.newContext({ baseURL });
  try {
    const otherPage = await secondAccount.newPage();
    await createAccount(otherPage, "Bill Listener");
    const journal = await otherPage.goto(`/journal?${new URLSearchParams({ email })}`);
    expect(journal?.headers()["cache-control"]).toContain("no-store");
    await expect(otherPage.getByText("Bill Listener", { exact: true })).toBeVisible();
    await expect(otherPage.getByText("Ada Listener", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Ada Listener", { exact: true })).toBeVisible();
    await expect(page.getByText("Bill Listener", { exact: true })).toHaveCount(0);
    const sections = otherPage.getByRole("tablist", { name: "Journal sections" });
    await expect(sections.getByRole("tab")).toHaveText([/Recent listens/, /Want to Listen/, /Saved Artists/]);
    await expect(sections.getByRole("tab", { name: "Recent listens, 0" })).toHaveAttribute("aria-selected", "true");
    await expect(sections.getByRole("tab", { name: "Want to Listen, 0" })).toHaveAttribute("aria-selected", "false");
    await expect(sections.getByRole("tab", { name: "Saved Artists, 0" })).toContainText("00");
    await expect(otherPage.getByRole("tabpanel", { name: /Recent listens/ }).getByRole("heading", { name: "Recent listens", level: 2 })).toBeAttached();
    await expect(otherPage.getByText("Albums you log will appear here by listen date.")).toBeVisible();
  } finally {
    await secondAccount.close();
  }
});

async function fillJournal(page: Page) {
  await page.goto("/albums/33333333-3333-4333-8333-333333333333");
  await page.getByLabel("Listen date (UTC)").fill("2026-01-15");
  await page.getByRole("button", { name: "Log listen" }).click();
  await expect(page.getByRole("status")).toHaveText("Listen logged.");
  await page.goto("/albums/11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: "Save to Want to Listen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Want to Listen" })).toBeVisible();
  await page.goto("/search/artists?q=Shared+artist");
  const duo = page.getByRole("listitem").filter({ hasText: "Mexican electronic duo" });
  await duo.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(duo.getByRole("button", { name: "Remove from Saved Artists" })).toBeVisible();
}

test("Journal tabs switch lists by pointer, keyboard and URL", async ({ page, browser, baseURL }) => {
  await createAccount(page, "Tab Listener");
  await fillJournal(page);
  await page.goto("/search");
  await page.goto("/journal");
  const sections = page.getByRole("tablist", { name: "Journal sections" });
  const recent = sections.getByRole("tab", { name: "Recent listens, 1" });
  const queue = sections.getByRole("tab", { name: "Want to Listen, 1" });
  const saved = sections.getByRole("tab", { name: "Saved Artists, 1" });
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await expect(recent).toContainText("01");
  const listens = page.getByRole("tabpanel", { name: /Recent listens/ });
  await expect(listens.getByRole("link", { name: "Sparse album" })).toBeVisible();
  await expect(listens.locator("time").first()).toHaveText("2026-01-15");
  await expect(listens.getByText("Newest first, by listen date")).toBeVisible();
  await expect(page.getByRole("link", { name: "Shared title" })).toHaveCount(0);

  await queue.click();
  await expect(page).toHaveURL(/\/journal\?tab=want-to-listen$/);
  await expect(page.getByRole("tabpanel", { name: /Want to Listen/ }).getByRole("link", { name: "Shared title" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sparse album" })).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(saved).toBeFocused();
  await expect(saved).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?tab=saved-artists$/);
  await page.keyboard.press("Home");
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/journal$/);
  await expect(recent).toBeFocused();
  await page.keyboard.press("End");
  await expect(saved).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: /Saved Artists/ })).toBeFocused();

  await page.reload();
  await expect(saved).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/search$/);

  await page.goto("/journal?tab=not-a-tab");
  await expect(recent).toHaveAttribute("aria-selected", "true");

  // Arrive on the default tab, then switch: a Remove must keep the listener on Saved Artists.
  await page.goto("/journal");
  await page.getByRole("tab", { name: /^Saved Artists/ }).click();
  const artist = page.getByRole("tabpanel", { name: /Saved Artists/ }).getByRole("listitem").filter({ hasText: "Mexican electronic duo" });
  await expect(artist.getByRole("button", { name: "Remove from Saved Artists: Shared artist", exact: true })).toHaveText("Remove from Saved Artists");
  await artist.getByRole("button", { name: "Remove from Saved Artists" }).click();
  await expect(sections.getByRole("tab", { name: "Saved Artists, 0" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Keep track of artists you want to explore.")).toBeVisible();

  const noScript = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const server = await noScript.newPage();
    await server.goto("/journal?tab=want-to-listen");
    await expect(server.getByRole("tab", { name: "Want to Listen, 1" })).toHaveAttribute("aria-selected", "true");
    await expect(server.getByRole("link", { name: "Shared title" })).toBeVisible();
    await expect(server.getByRole("link", { name: "Sparse album" })).toBeHidden();
  } finally {
    await noScript.close();
  }
});

test("Want to Listen shows the date added in the listener's time zone, and UTC when it is unknown", async ({ browser, baseURL }) => {
  // UTC+14 and UTC-11 are 25 hours apart, so the same moment always falls on a later date in the east.
  const east = await browser.newContext({ baseURL, timezoneId: "Pacific/Kiritimati" });
  const west = await browser.newContext({ baseURL, timezoneId: "Pacific/Pago_Pago" });
  const unknown = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const eastPage = await east.newPage();
    await createAccount(eastPage, "Zone Listener");
    await fillJournal(eastPage);
    const session = (await east.storageState()).cookies.filter((cookie) => cookie.name !== "tz");
    await west.addCookies(session);
    await unknown.addCookies(session);

    const added = async (page: Page) => {
      await page.goto("/journal?tab=want-to-listen");
      const date = page.getByRole("tabpanel", { name: /Want to Listen/ }).locator("time").first();
      await expect(date).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
      return date.getAttribute("datetime");
    };
    const westPage = await west.newPage();
    await westPage.goto("/search");
    const eastDate = await added(eastPage);
    const westDate = await added(westPage);
    expect(eastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(eastDate! > westDate!).toBe(true);
    expect(await added(await unknown.newPage())).toBe(new Date().toISOString().slice(0, 10));

    await westPage.goto("/journal");
    await expect(westPage.getByRole("tabpanel", { name: /Recent listens/ }).locator("time").first()).toHaveText("2026-01-15");
  } finally {
    await Promise.all([east.close(), west.close(), unknown.close()]);
  }
});

test("the Journal does not shift while it loads or when tabs switch", async ({ page, browser, baseURL }) => {
  await createAccount(page, "Still Listener");
  await fillJournal(page);
  await page.addInitScript(() => {
    (window as unknown as { shift: number }).shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) (window as unknown as { shift: number }).shift += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const shift = () => page.evaluate(() => (window as unknown as { shift: number }).shift);
  await page.goto("/journal");
  await page.waitForLoadState("networkidle");
  expect(await shift()).toBe(0);
  for (const name of [/^Want to Listen/, /^Saved Artists/, /^Recent listens/]) {
    await page.getByRole("tab", { name }).click();
    await page.waitForTimeout(700);
    expect(await shift()).toBe(0);
  }

  const noScript = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const server = await noScript.newPage();
    await server.goto("/journal?tab=saved-artists");
    const rule = await server.getByRole("tab", { name: /^Saved Artists/ }).evaluate((tab) => {
      const after = getComputedStyle(tab, "::after");
      return [after.opacity, after.backgroundColor, after.height];
    });
    expect(rule).toEqual(["1", "rgb(255, 90, 0)", "2px"]);
  } finally {
    await noScript.close();
  }
});

test.describe("phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("every Journal tab fits a 320px screen with touch-sized tabs", async ({ page }) => {
    await createAccount(page, "Small Listener");
    await fillJournal(page);
    await page.goto("/journal");
    for (const name of [/^Recent listens/, /^Want to Listen/, /^Saved Artists/]) {
      const tab = page.getByRole("tab", { name });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const panel = page.getByRole("tabpanel", { name: new RegExp((await tab.getAttribute("aria-label"))!.split(",")[0]) });
      expect((await panel.boundingBox())!.width).toBe((await page.getByRole("tablist").boundingBox())!.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    }
    await page.getByRole("tab", { name: /^Recent listens/ }).click();
    await expect(page.getByRole("tabpanel", { name: /Recent listens/ }).getByText("· Listened 2026-01-15")).toBeVisible();
  });

  test("the sign-in and Journal entry flow works with a keyboard", async ({ page }) => {
    const email = await createAccount(page, "Sam Listener");
    await page.getByRole("button", { name: /^Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Music Journal" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.type("wrong-password");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your email and password");
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Password").press("Enter");
    await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Music Journal" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Journal", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Discover", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Search", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^Account menu/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
