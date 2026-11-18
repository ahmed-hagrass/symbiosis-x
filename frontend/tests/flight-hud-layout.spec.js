import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { hudButton } from "./support/hud.js";

let flight;

test.beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "sx-hud-layout-"));
  try {
    const output = join(directory, "flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", output], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
    });
    flight = readFileSync(output, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const overlaps = (first, second) => first.x < second.x + second.width &&
  first.x + first.width > second.x && first.y < second.y + second.height &&
  first.y + first.height > second.y;

for (const width of [1280, 390]) {
  test(`Crew roster, portraits and Noor’s twin coexist at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 730 : 800 });
    await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flight }));
    await page.goto("/flight?view=replay");
    const crew = await hudButton(page, "Crew roster");
    await expect(crew).toBeVisible();
    await crew.click();
    const roster = page.locator("#crew-widget");
    const portraits = page.getByRole("navigation", { name: "Astronaut portraits" });
    await expect(roster).toBeVisible();
    await expect(portraits.getByRole("button")).toHaveCount(4);
    await expect.poll(async () => {
      const portraitBox = await portraits.boundingBox();
      const otherBoxes = await Promise.all([roster, page.locator("#flight-playback"), page.locator("#mission-resources")]
        .map(element => element.boundingBox()));
      return otherBoxes.every(box => !box || !overlaps(portraitBox, box));
    }).toBe(true);
    const noor = portraits.getByRole("button", { name: /^Inspect Noor Okafor/ });
    await noor.click();
    const twin = page.locator("#personnel-widget");
    await expect(twin).toBeVisible();
    await expect(twin.locator("#personnel-name")).toHaveText("Noor Okafor");
    await expect(twin).toHaveCSS("scrollbar-width", "none");
    const otherSelectors = ["#crew-strip", "#crew-widget", "#flight-playback", "#map-widget", "#orbit-map-widget", "#mission-resources"];
    await expect.poll(async () => {
      const box = await twin.boundingBox();
      const others = await Promise.all(otherSelectors.map(selector => page.locator(selector).boundingBox()));
      return others.every(other => !other || !overlaps(box, other));
    }).toBe(true);
  });
}

test("the Orbit Map and Mission overview share the current objective", async ({ page }) => {
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flight }));
  await page.goto("/flight");
  await page.getByRole("button", { name: "New run", exact: true }).click();
  const tutorial = page.locator("#flight-tutorial");
  for (let step = 0; step < 3; step++) await tutorial.getByRole("button", { name: "Next" }).click();
  await tutorial.getByRole("button", { name: "Open checkout" }).click();
  const progress = page.locator("#map-route-progress");
  await expect(progress).toHaveText(/^0 \/ \d+ objectives verified$/);
  const opener = page.locator("#open-orbit-minimap");
  await opener.click();
  const orbit = page.getByRole("dialog", { name: "Orbit map" });
  const trajectory = orbit.getByRole("tab", { name: "Trajectory" });
  const guidance = orbit.getByRole("tab", { name: "Guidance" });
  await expect(trajectory).toHaveAttribute("aria-selected", "true");
  await expect(orbit.getByRole("img", { name: /spacecraft trajectory/ })).toBeVisible();
  await trajectory.press("ArrowRight");
  await expect(guidance).toBeFocused();
  await expect(guidance).toHaveAttribute("aria-selected", "true");
  await expect(orbit.getByRole("tabpanel", { name: "Guidance" })).toContainText("Next decision");
  await expect(orbit.getByRole("button", { name: "Rotate +15°" })).toBeVisible();
  await guidance.press("ArrowRight");
  await expect(orbit.getByRole("tabpanel", { name: "Mission" })).toContainText(/objective/i);
  await expect(orbit.locator("#orbit-mission-progress")).toHaveText(await progress.innerText());
  await expect(orbit.locator("#orbit-mission-objective")).toHaveText(await page.locator("#map-current-objective").innerText());
  await orbit.getByRole("tab", { name: "Mission" }).press("Home");
  await expect(trajectory).toHaveAttribute("aria-selected", "true");
  await orbit.getByRole("button", { name: "Close" }).click();
  await expect(opener).toBeFocused();
});
