import { expect, test } from "@playwright/test";

test("sign in, join league, and submit picks", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const inviteCode = process.env.E2E_INVITE_CODE;
  const displayName = process.env.E2E_DISPLAY_NAME ?? "E2E Tester";

  test.skip(
    !email || !password || !inviteCode,
    "Set E2E_EMAIL, E2E_PASSWORD, and E2E_INVITE_CODE to run this flow.",
  );

  await page.goto("/");

  const toggleToSignUp = page.getByRole("button", { name: /Need an account\? Create one/i });
  if (await toggleToSignUp.isVisible()) {
    await toggleToSignUp.click();
    await page.fill("#auth-email", email!);
    await page.fill("#auth-password", password!);
    await page.getByRole("button", { name: /Create Account/i }).click();

    const alreadyExistsError = page.getByText(/already|exists|in use/i).first();
    if (await alreadyExistsError.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await page.getByRole("button", { name: /Already have an account\? Sign in/i }).click();
    }
  }

  if (await page.locator("#auth-email").isVisible().catch(() => false)) {
    await page.fill("#auth-email", email!);
    await page.fill("#auth-password", password!);
    await page.getByRole("button", { name: /^Sign In$/i }).click();
  }

  if (await page.locator("#invite-code").isVisible().catch(() => false)) {
    await page.fill("#invite-code", inviteCode!);
    await page.fill("#display-name", displayName);
    await page.getByRole("button", { name: /Join League/i }).click();
  }

  await page.getByRole("tab", { name: /Picks/i }).click();

  const lockedMessage = page.getByText(/Picks are locked for this race/i);
  test.skip(await lockedMessage.isVisible().catch(() => false), "Race is locked, cannot submit picks in this environment.");

  const tierCards = page.locator(".tier-card");
  await expect(tierCards.first()).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await tierCards.nth(0).locator("button.tier-driver-row").nth(index).click();
  }
  for (let index = 0; index < 2; index += 1) {
    await tierCards.nth(1).locator("button.tier-driver-row").nth(index).click();
  }
  await tierCards.nth(2).locator("button.tier-driver-row").first().click();

  await page.getByRole("button", { name: /Save picks/i }).click();
  await expect(page.getByText(/Picks saved\./i)).toBeVisible();
});
