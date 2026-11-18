import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { hudButton } from "./support/hud.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
let outputDirectory;
let flightHtml;

test.beforeAll(() => {
  outputDirectory = mkdtempSync(join(tmpdir(), "flight-end-"));
  const output = join(outputDirectory, "flight.html");
  execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", output], { cwd: root });
  flightHtml = readFileSync(output, "utf8");
});

test.afterAll(() => {
  if (outputDirectory) rmSync(outputDirectory, { recursive: true, force: true });
});

test("End mission stops the replay, summarizes it and starts fresh", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight?view=replay");
  const dialog = page.locator("#end-mission-dialog");
  const clock = page.locator("#map-location");

  await page.getByRole("button", { name: "Skip one mission hour" }).click();
  await page.getByRole("button", { name: "Skip one mission hour" }).click();
  await expect(clock).toContainText("02:00:00");

  // Backing out keeps the flight where it was.
  await (await hudButton(page, "End mission")).click();
  await expect(dialog.getByRole("heading", { name: "End this mission?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep flying" }).click();
  await expect(dialog).toBeHidden();
  await expect(clock).toContainText("02:00:00");

  await (await hudButton(page, "#end-mission")).click();
  await dialog.getByRole("button", { name: "End mission" }).click();
  await expect(dialog.getByRole("heading", { name: "Mission ended" })).toBeVisible();
  const facts = dialog.locator("#end-mission-facts");
  await expect(facts).toContainText("Mission time02:00:00");
  await expect(facts).toContainText("Crew aboard4");
  await expect(facts).toContainText(/Cabin CO₂\d+ ppm/);
  // An ended mission needs a choice; Escape does not resume it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Replay from start" }).click();
  await expect(dialog).toBeHidden();
  await expect(clock).toContainText("00:00");
  await expect(page).toHaveURL(/view=replay/);

  await (await hudButton(page, "#end-mission")).click();
  await dialog.getByRole("button", { name: "End mission" }).click();
  await dialog.getByRole("button", { name: "Back to game menu" }).click();
  await expect(page.getByRole("heading", { name: "SYMBIOSIS X", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
});
