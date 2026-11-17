import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`design system stays readable and usable in ${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/sign-up");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("body")).toHaveCSS("background-color", colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(10, 10, 10)");
    const fonts = await page.evaluate(async () => {
      await document.fonts.load('500 12px "Geist Mono"');
      await document.fonts.load('400 16px "Allo"');
      return [...document.fonts].filter(font => font.status === "loaded").map(font => font.family.replaceAll('"', ''));
    });
    expect(fonts).toContain("Allo");
    expect(fonts).toContain("Geist Mono");
    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toHaveCSS("color", "rgb(10, 10, 10)");
    await expect(submit).toHaveCSS("background-color", "rgb(255, 90, 0)");
    await expect(submit).toHaveCSS("text-transform", "uppercase");
    await expect(submit).toHaveCSS("font-size", "12px");
    await expect(page.getByLabel("Email")).toHaveCSS("font-size", "16px");
    await expect(page.getByLabel("Email")).toHaveCSS("text-transform", "none");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await page.getByLabel("Email").focus();
    await expect(page.getByLabel("Email")).toHaveCSS("border-color", "rgb(255, 90, 0)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({ path: testInfo.outputPath(`${colorScheme}-phone.png`), fullPage: true });
  });
}
