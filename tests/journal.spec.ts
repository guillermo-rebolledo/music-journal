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
    await otherPage.getByRole("button", { name: "Sign out" }).click();
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
    for (const name of ["Recent listens", "Want to Listen", "Saved Artists"]) {
      await expect(otherPage.getByRole("heading", { name })).toBeVisible();
    }
  } finally {
    await secondAccount.close();
  }
});

test.describe("phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("the sign-in and Journal entry flow works with a keyboard", async ({ page }) => {
    const email = await createAccount(page, "Sam Listener");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

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
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
