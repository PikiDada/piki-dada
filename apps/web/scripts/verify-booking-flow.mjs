import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const email = `pwtest_${Date.now()}@test.com`;

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("requestfailed", (req) => consoleErrors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
page.on("response", (res) => {
  if (res.url().includes("/auth/register")) {
    res.text().then((body) => consoleErrors.push(`register response: ${res.status()} ${body}`)).catch(() => undefined);
  }
});
page.on("dialog", async (dialog) => {
  consoleErrors.push(`dialog: ${dialog.type()} ${dialog.message()}`);
  await dialog.dismiss().catch(() => undefined);
});

try {
  console.log("step: goto register");
  await page.goto(`${BASE_URL}/register`, { timeout: 60000, waitUntil: "networkidle" });
  await page.waitForSelector("text=Create your account");
  await page.waitForTimeout(1500); // let React hydration finish before interacting

  console.log("step: fill register form");
  await page.fill("#name", "Playwright Tester");
  await page.fill("#email", email);
  await page.fill("#phone", "0700000000");
  await page.fill("#password", "password123");
  await page.click('button:has-text("Create account")');

  console.log("step: wait for /passenger redirect (allowing for first-compile delay)");
  await page.waitForURL(`${BASE_URL}/passenger`, { timeout: 30000 });
  console.log("current URL:", page.url());

  console.log("step: fill pickup address");
  await page.fill('input[placeholder="Pickup location"]', "Kampala Rd, Kampala");

  console.log("step: click pickup manual toggle");
  await page.locator("text=Can't find it? Enter coordinates manually").first().click();

  console.log("step: fill pickup lat/lng");
  await page.locator('input[placeholder="Latitude"]').nth(0).fill("0.3476");
  await page.locator('input[placeholder="Longitude"]').nth(0).fill("32.5825");

  console.log("step: fill destination address");
  const destCount = await page.locator('input[placeholder="Destination"]').count();
  console.log("destination input count:", destCount);
  const destBox = await page.locator('input[placeholder="Destination"]').boundingBox().catch((e) => `err: ${e.message}`);
  console.log("destination bounding box:", JSON.stringify(destBox));
  const isVisible = await page.locator('input[placeholder="Destination"]').isVisible().catch((e) => `err: ${e.message}`);
  console.log("destination visible:", isVisible);
  await page.fill('input[placeholder="Destination"]', "Ntinda, Kampala", { timeout: 8000 });

  console.log("step: click destination manual toggle");
  await page.locator("text=Can't find it? Enter coordinates manually").first().click();

  console.log("step: fill destination lat/lng");
  await page.locator('input[placeholder="Latitude"]').nth(1).fill("0.3650");
  await page.locator('input[placeholder="Longitude"]').nth(1).fill("32.5950");



  console.log("step: check Request Ride button state");
  const requestButton = page.locator('button:has-text("Request Ride")');
  await requestButton.waitFor({ state: "visible" });
  const isDisabled = await requestButton.isDisabled();
  console.log("Request Ride disabled?", isDisabled);

  if (!isDisabled) {
    console.log("step: click Request Ride");
    await requestButton.click();
    await page.waitForURL(/\/passenger\/trip\//, { timeout: 30000 });

    console.log("RESULT: booking flow succeeded, navigated to", page.url());
  } else {
    console.log("RESULT: Request Ride button still disabled — canRequest condition not met");
  }

  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
} catch (err) {
  console.error("SCRIPT_ERROR:", err.message);
  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
  process.exitCode = 1;
} finally {
  await browser.close();
}
