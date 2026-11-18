import { expect, test } from "@playwright/test";

const image = {
  contentType: "image/svg+xml",
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500"/></svg>',
};

test.use({ viewport: { width: 320, height: 640 }, colorScheme: "dark", reducedMotion: "reduce" });

test("artwork keeps its space through loading, success, and missing images", async ({ page }) => {
  const cover = "http://127.0.0.1:3101/release-group/22222222-2222-4222-8222-222222222222/front-*";
  let releaseCover = () => {};
  const coverReady = new Promise<void>((resolve) => { releaseCover = resolve; });
  await page.route(cover, async (route) => {
    await coverReady;
    await route.fulfill(image);
  });
  const portrait = "https://thumb.wikimedia.org/wikipedia/commons/thumb/example/250px-Artist.jpg";
  await page.route(portrait, (route) => route.fulfill(image));

  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Artwork Listener");
  await page.getByLabel("Email").fill(`${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("test-password-only-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/journal");

  await page.goto("/search?q=Shared", { waitUntil: "domcontentloaded" });
  const album = page.getByRole("listitem").filter({ hasText: "Second Artist" });
  const frame = album.locator(".artwork");
  try {
    await expect(frame).toHaveAttribute("data-state", "loading");
    await expect(frame).toHaveCSS("animation-name", "none");
  } finally {
    releaseCover();
  }
  await expect(frame).toHaveAttribute("data-state", "ready");
  await expect(frame).toHaveCSS("width", "64px");
  await expect(frame).toHaveCSS("height", "64px");
  await album.getByRole("link", { name: "Shared title" }).click();
  await expect(page).toHaveURL("/albums/22222222-2222-4222-8222-222222222222");
  await expect(page.locator(".artwork-detail")).toHaveAttribute("data-state", "ready");
  await expect(page.locator(".artwork-detail")).toHaveCSS("width", "256px");

  await page.goto("/search/artists?q=artwork+fixture");
  const artist = page.getByRole("listitem").filter({ hasText: "Portrait artist" });
  await expect(artist.locator(".artwork")).toHaveAttribute("data-state", "ready");
  await expect(artist.getByRole("link", { name: "Photo Author" })).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:Artist.jpg");
  await expect(artist.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  await expect(page.getByRole("listitem").filter({ hasText: "British folk singer" }).getByText("No photo")).toBeVisible();

  await page.unroute(portrait);
  await page.route(portrait, (route) => route.abort());
  await page.reload();
  await expect(artist.getByText("No photo")).toBeVisible();
  await expect(artist.getByRole("link", { name: "Photo Author" })).toHaveCount(0);
  await expect(artist.getByRole("button", { name: "Save artist" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
