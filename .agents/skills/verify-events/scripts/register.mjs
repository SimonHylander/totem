#!/usr/bin/env node
// Register for an event through the events UI in headless Chrome, the way a user does, and save
// screenshots, an ARIA snapshot and result.json to <run>/evidence/<email>/.
// Usage: register.mjs --email <email> [--event "HubSpot workshop"] [--first <name>] [--last <name>]
// Exits 1 when the page shows "Registration failed".

import { mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const EVENTS = "http://localhost:3003";
const PLAYWRIGHT_HOME = join(homedir(), ".cache/totem-verify");

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    event: { type: "string", default: "HubSpot workshop" },
    first: { type: "string", default: "Verify" },
    last: { type: "string", default: "Run" },
  },
});
if (!values.email) throw new Error("--email is required");
const email = values.email.toLowerCase();

let chromium;
try {
  ({ chromium } = createRequire(join(PLAYWRIGHT_HOME, "/"))("playwright-core"));
} catch {
  throw new Error(
    `playwright-core is missing. Run: npm install --prefix ${PLAYWRIGHT_HOME} playwright-core@1.55`,
  );
}

const run = readlinkSync(join(process.env.VERIFY_EVENTS_RUNS ?? "/tmp/verify-events", "current"));
const out = join(run, "evidence", email);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.goto(`${EVENTS}/`);
  await page.getByRole("heading", { level: 1, name: "Events" }).waitFor();
  await page.screenshot({ path: join(out, "1-events.png") });

  await page.getByRole("link", { name: values.event, exact: true }).click();
  await page.getByRole("heading", { level: 1, name: values.event }).waitFor();
  const register = page.getByRole("button", { name: /^(Take seat|Join the waitlist)/ });
  // Enabled means the page has hydrated.
  await register.and(page.locator(":enabled")).waitFor();
  const seatsBefore = await page.getByText(/seats left\.|^Full\./).textContent();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("First name").fill(values.first);
  await page.getByLabel("Last name").fill(values.last);
  await page.screenshot({ path: join(out, "2-filled.png") });
  await register.click();

  const outcome = page.getByText(/^You're registered\.|^The event is full\./);
  const alert = page.getByRole("alert");
  await outcome.or(alert).waitFor();
  await page.screenshot({ path: join(out, "3-result.png") });
  writeFileSync(join(out, "3-result.aria.txt"), await page.locator("main").ariaSnapshot());

  const failed = await alert.isVisible();
  const result = {
    event: values.event,
    email,
    url: page.url(),
    seatsBefore,
    outcome: failed ? await alert.textContent() : await outcome.textContent(),
  };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  console.log(`evidence: ${out}`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
