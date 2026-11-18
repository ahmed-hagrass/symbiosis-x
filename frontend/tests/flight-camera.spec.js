import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let flight;

test.beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "sx-camera-"));
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

async function openReplay(page, { width = 1440, height = 860 } = {}) {
  await page.setViewportSize({ width, height });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flight }));
  await page.goto("/flight?view=replay");
  await expect(page.locator("#stage")).toBeVisible();
}

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const scale = page => page.locator("#stage .viewport").evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a);

test("the top bar groups Mission, Crew and Ship menus under their words", async ({ page }) => {
  await openReplay(page);
  const ship = page.locator("#hud-menu-ship");
  await expect(ship).toHaveText("Ship");
  await expect(page.getByRole("button", { name: "Workflows", exact: true })).toBeHidden();
  await ship.click();
  await expect(ship).toHaveAttribute("aria-expanded", "true");
  const list = page.locator("#hud-menu-list-ship");
  await expect(list.locator(".hud-room-item")).toHaveText(
    ["Command", "Habitat", "Life support", "Engineering", "Medical", "Communications", "Cargo & docking"]);
  await expect(list.getByRole("button", { name: "Workflows", exact: true })).toBeVisible();
  const trigger = await ship.boundingBox();
  const menu = await list.boundingBox();
  // The list opens directly under its word, centred on it.
  expect(menu.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
  expect(Math.abs(menu.x + menu.width / 2 - (trigger.x + trigger.width / 2))).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(ship).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#hud-menu-crew")).toHaveText("Crew");
  await expect(page.locator("#hud-menu-mission")).toHaveText("Mission");
});

test("fixed HUD boxes never cover the ship at ship level", async ({ page }) => {
  await openReplay(page);
  await expect.poll(async () => {
    const hull = await page.locator("#hull").boundingBox();
    const others = await Promise.all(["#map-widget", "#mission-resources", "#crew-strip", "#flight-playback"]
      .map(selector => page.locator(selector).boundingBox()));
    return others.every(box => !box || !overlaps(hull, box));
  }).toBe(true);
});

test("a room click glides in, shows where you are and Esc steps back out", async ({ page }) => {
  await openReplay(page);
  const crumbs = page.getByRole("navigation", { name: "Camera location" });
  await expect(crumbs).toBeHidden();
  await page.locator("#hud-menu-ship").click();
  await page.locator("#hud-menu-list-ship").getByRole("button", { name: "Medical", exact: true }).click();
  await expect(crumbs).toBeVisible();
  await expect(crumbs).toContainText("Ship›Medical");
  await expect(page.locator("#ship")).toHaveAttribute("data-cam-room", "medical-01");
  await expect.poll(() => scale(page)).toBeGreaterThan(1.2);
  // The focused room sits fully on screen and clear of the open inspector.
  await expect.poll(async () => {
    const room = await page.locator("#ship .zone[data-cam-target]").boundingBox();
    const inspector = await page.locator("#inspector-widget").boundingBox();
    const view = page.viewportSize();
    return room.x >= 0 && room.y >= 0 && room.x + room.width <= view.width && room.y + room.height <= view.height &&
      (!inspector || !overlaps(room, inspector));
  }).toBe(true);
  await page.locator("#stage").press("Escape");
  await expect(crumbs).toBeHidden();
  await expect(page.locator("#ship")).not.toHaveAttribute("data-cam-room");
  await expect.poll(() => scale(page)).toBeLessThanOrEqual(1);
});

test("choosing a crew member zooms to their room and opens their twin", async ({ page }) => {
  await openReplay(page);
  await page.locator("#hud-menu-crew").click();
  await page.locator("#hud-menu-list-crew").getByRole("button", { name: "Sana Kepler", exact: true }).click();
  const crumbs = page.getByRole("navigation", { name: "Camera location" });
  await expect(crumbs).toContainText("Sana Kepler");
  await expect(page.locator("#personnel-widget")).toBeVisible();
  await expect(page.locator("#personnel-name")).toHaveText("Sana Kepler");
  await crumbs.getByRole("button", { name: "‹ Back" }).click();
  await expect(crumbs).not.toContainText("Sana Kepler");
  await crumbs.getByRole("button", { name: "Ship", exact: true }).click();
  await expect(crumbs).toBeHidden();
});

test("reduced motion swaps the glide for a quick fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReplay(page);
  await page.locator("#hud-menu-ship").click();
  await page.locator("#hud-menu-list-ship").getByRole("button", { name: "Habitat", exact: true }).click();
  const viewport = page.locator("#stage .viewport");
  await expect(viewport).not.toHaveClass(/cam-smooth/);
  await expect.poll(() => scale(page)).toBeGreaterThan(1.2);
});
