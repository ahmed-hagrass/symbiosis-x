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
  outputDirectory = mkdtempSync(join(tmpdir(), "asteria-flight-"));
  const output = join(outputDirectory, "flight.html");
  execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", output], {
    cwd: root,
    stdio: "inherit",
  });
  flightHtml = readFileSync(output, "utf8");
});

test.afterAll(() => {
  if (outputDirectory) rmSync(outputDirectory, { recursive: true, force: true });
});

test("Horizon burns into orbit, reaches ISS and returns to Earth in one saved mission", async ({ page }) => {
  test.setTimeout(80_000);
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  const button = name => page.getByRole("button", { name, exact: true });

  await button("New run").click();
  const tutorial = page.locator("#flight-tutorial");
  await expect(tutorial.getByRole("heading")).toHaveText("Your mission");
  await expect(tutorial.getByRole("list",{name:"Mission route"}).getByRole("listitem")).toHaveText([
    /Launch.*Horizon/, /Orbit.*175 × 185 km/, /Rendezvous & dock.*ISS/, /Research/, /Recovery/,
  ]);
  for (const title of ["Bring the ship online","Assign astronauts to checks","Clear the pad"]) {
    await tutorial.getByRole("button", {name:"Next"}).click();
    await expect(tutorial.getByRole("heading")).toHaveText(title);
  }
  await tutorial.getByRole("button", {name:"Open checkout"}).click();
  await expect(page.locator("#launch-status")).toHaveText("Launchpad");
  const guide = page.getByRole("complementary",{name:"Mission guide"});
  await expect(guide.locator("#guide-next")).toHaveText("Start ship systems");
  await guide.getByRole("button",{name:"Go to control"}).click();
  await expect(button("Start ship systems")).toBeFocused();

  await (await hudButton(page, "Briefing")).click();
  await expect(page.getByRole("dialog", { name:"ISS Research and Return briefing" })).toBeVisible();
  await button("Close").click();
  for (const crew of ["Sana", "Ivo", "Noor"]) {
    await button("Assign " + crew).click();
    await expect(button("Assigned " + crew)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(button("Arm countdown")).toBeDisabled();
  await button("Start ship systems").click();
  await expect(page.locator("#startup-status [data-state=starting]")).toHaveCount(1);
  const advance = async count => {
    const tick = button("Advance 15 s").or(button("Advance one mission tick"));
    for (let i = 0; i < count; i++) await tick.click();
  };
  const liftoff = page.getByRole("button", { name: /^(Commit liftoff|Launch)$/ });
  const transport = page.getByRole("group", { name:"Launch time controls" });
  await transport.getByRole("button", { name:"Cycle launch speed" }).click();
  await transport.getByRole("button", { name:"Cycle launch speed" }).click();
  await transport.getByRole("button", { name:"Play", exact:true }).click();
  await expect(button("Arm countdown")).toBeEnabled({ timeout:9000 });
  await expect(page.locator("#startup-status")).toHaveAttribute("data-online", "true");
  await expect(page.locator("#startup-status [data-state=online]")).toHaveCount(4);
  await expect(page.locator("#launch-jobs [data-state=verified]")).toHaveCount(3);
  await (await hudButton(page, "Workflows")).click();
  await expect(page.getByRole("region",{name:"Process event log"})).toContainText("Crew checks verified");
  await button("Close").click();
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Arm countdown").click();
  await expect(liftoff).toBeDisabled();
  await advance(1);
  const missionUrl = page.url();
  await liftoff.click();
  await expect(button("Open orbit minimap")).toBeVisible();
  await expect(transport.getByRole("button", { name:"Pause", exact:true })).toBeVisible();
  await transport.getByRole("button", { name:"Pause", exact:true }).click();
  await transport.getByRole("button", { name:"Play", exact:true }).click();
  await expect(button("Separate booster")).toBeVisible();
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Separate booster").click();
  await expect(page.locator("#launch-status")).toHaveText("Upper stage coast");
  await expect(button("Commit orbital insertion")).toBeVisible();
  await expect(page.locator("#maneuver-target")).toContainText("66.9 m/s");
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Commit orbital insertion").click();
  await expect(page.locator("#launch-status")).toHaveText("Orbital insertion burn");
  await expect(page.getByRole("progressbar",{name:"Engine burn progress"})).toBeVisible();
  await expect(page.locator("#ship canvas")).toBeVisible({timeout:12_000});
  await expect(guide.locator("#guide-next")).toContainText("Coast to the departure point");
  await guide.getByRole("button",{name:"Flight plan"}).click();
  await expect(page.locator("#mission-objective-list [data-status=next]")).toContainText("commit the ISS transfer burn");
  await button("Close").click();
  await expect(page.locator("#ship .pawn:visible")).toHaveCount(4);
  const flightPlayback = page.getByRole("group", { name:"Flight playback" });
  await expect(flightPlayback.getByRole("button", { name:"Cycle speed" })).toHaveText("4×");
  await expect(flightPlayback.getByRole("button", { name:"Advance one mission tick" })).toBeVisible();
  await (await hudButton(page, "Orbit map")).click();
  const navigation = page.getByRole("dialog", { name:"Orbit map" });
  await expect(navigation).toContainText("175 km");
  await expect(navigation.locator("#navigation-speed")).toHaveText(/km\/s/);
  await button("Rotate +15°").click();
  await expect(navigation.locator("#navigation-attitude")).toContainText("15°");
  await expect(navigation.locator("#navigation-reserve")).toContainText("11 cold-gas pulses");
  await expect(page.locator("#solid-propellant")).toHaveText("Stage detached");
  await expect(page.locator("#orbital-propellant")).toHaveText("11.6 kg fuel / 17.4 kg oxidizer");
  await expect(page.locator("#return-propellant")).toHaveText("8.8 kg fuel / 13.2 kg oxidizer");
  await button("Close").click();
  await expect(page).toHaveURL(missionUrl);
  const instrument = page.getByRole("button",{name:"Steer spacecraft"});
  await instrument.focus();
  await instrument.press("w");
  await expect(page.locator("#navigation-heading")).toHaveText("Yaw 15° · Pitch 15°");
  await instrument.press("ArrowDown");
  await expect(page.locator("#navigation-heading")).toHaveText("Yaw 15° · Pitch 0°");
  const clockBeforePlay = await page.locator("#hud-clock").innerText();
  await flightPlayback.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.locator("#hud-clock")).not.toHaveText(clockBeforePlay);
  await flightPlayback.getByRole("button",{name:"Pause",exact:true}).click();

  await page.locator("#crew-strip .crew-portrait").first().click();
  const twin = page.locator("#personnel-widget");
  await twin.getByRole("button", { name:"Head on body map" }).click();
  await expect(twin.locator("#crew-camera")).toContainText(/Moving|At station/);
  await expect(page.getByRole("group",{name:"Mission resources"})).toContainText("40 meals");
  await expect(page.locator("#ship .pawn .action-marker meter:visible").first()).toBeVisible();
  await (await hudButton(page, "Orders")).click();
  await button("Request crewmate check").click();
  await expect(twin.locator("#peer-check-status")).toContainText("due T+");
  const tick = flightPlayback.getByRole("button", { name:"Advance one mission tick" });
  await tick.click();
  await tick.click();
  await expect(twin.locator("#peer-check-status")).toContainText("recorded a visual check");
  await expect(twin.locator("#region-reading")).toHaveText("Normal · visual check");
  await button("Close orders").click();
  await twin.getByRole("button", { name:"Close Digital twin widget" }).click();

  const groundTab = page.getByRole("button",{name:"Ground",exact:true});
  await groundTab.click();
  const ground = page.getByRole("region",{name:"Ground relay"});
  await ground.getByRole("button",{name:"Simulate Ground direction"}).click();
  await advance(3);
  await (await hudButton(page, "Orders")).click();
  await button("Assign Ivo to readiness check").click();
  const readiness = await page.evaluate(()=>
    JSON.parse(localStorage.getItem("sx:launch-checkout:v1")));
  await advance(Math.ceil((readiness.groundDirection.work.finishes-readiness.time)/15));
  await button("Ivo · Send readiness report").click();
  await advance(2);
  await expect(ground).toContainText("Ground received readiness verified");
  await button("Close orders").click();

  const command = page.getByRole("region", { name: "Flight command" });
  await guide.getByRole("button",{name:"Go to control"}).click();
  await expect(button("Coast to ISS departure window")).toBeFocused();
  await expect(button("Commit ISS transfer burn")).toBeDisabled();
  await button("Coast to ISS departure window").click();
  await expect(page.getByRole("progressbar",{name:"Coast progress"})).toBeVisible();
  await command.getByRole("button", { name: "Commit ISS transfer burn", exact: true }).click();
  await expect(page.locator("#maneuver-target")).toContainText("71.3 m/s");
  await expect(page.locator("#maneuver-track")).toBeVisible();
  await expect(page.locator("#flight-guidance")).toHaveAttribute("data-mode","burn");
  await expect(page.getByRole("button",{name:"3 min before checkpoint"})).toHaveAccessibleDescription(/current maneuver/);
  await expect(page.locator("#docking-view")).toBeHidden();
  await expect(button("Coast to transfer apoapsis")).toBeEnabled({timeout:12_000});
  await page.reload();
  await expect(page.locator("#launch-status")).toHaveText("Transfer coast · engines off");
  await expect(page.locator("#orbital-propellant")).toHaveText("8.0 kg fuel / 12.0 kg oxidizer");
  await expect(flightPlayback.getByRole("button",{name:"Play",exact:true})).toBeEnabled();
  await guide.getByRole("button",{name:"Go to control"}).click();
  await expect(button("Match station orbit")).toBeHidden();
  await button("Coast to transfer apoapsis").click();
  await expect(page.getByRole("progressbar",{name:"Coast progress"})).toBeVisible();
  await expect(button("Match station orbit")).toBeVisible();
  await expect(page.locator("#maneuver-target")).toContainText("420 × 420 km");
  await button("Match station orbit").click();
  await expect(page.locator("#launch-status")).toHaveText("Orbit matching burn");
  await expect(page.locator("#docking-view")).toBeVisible({timeout:12_000});
  await button("Hold approach").click();
  await expect(page.locator("#docking-caption")).toContainText("Approach held");
  await button("Resume approach").click();
  await expect(button("Capture station")).toBeDisabled();
  await advance(3);
  await button("Capture station").click();
  await expect(page.locator("#docking-caption")).toContainText("Docking contact");
  const authorize = button("Authorize hatch opening");
  await expect(authorize).toBeDisabled();
  await button("Check seal").click();
  await advance(2);
  await button("Compare pressure").click();
  await expect(authorize).toBeDisabled();
  await expect(page.locator("#launch-seal")).toHaveText(/Expired/);
  await button("Check seal").click();
  await authorize.click();

  await button("Hand off research kit").click();
  await button("Assign Sana to station research").click();
  await advance(2);
  await expect(button("Seal hatch and board return capsule")).toBeHidden();
  await button("Verify and archive research").click();
  await expect(page.locator("#station-research-status")).toContainText("Paired sample archived");
  await button("Seal hatch and board return capsule").click();
  await expect(page.locator("#orbital-propellant")).toHaveText("Stage left at station");
  await expect(page.locator("#return-propellant")).toHaveText("7.2 kg fuel / 10.8 kg oxidizer");
  await expect(page.locator("#maneuver-target")).toContainText("synthetic entry corridor");
  await expect(page.locator("#docking-caption")).toContainText("Undocking");
  await button("Commit deorbit").click();
  await expect(page.locator("#return-propellant")).toHaveText("2.4 kg fuel / 3.6 kg oxidizer");
  const returnScene = page.getByRole("figure",{name:"Command pod Earth return"});
  await expect(returnScene).toHaveAttribute("data-phase","separation");
  await advance(2);
  await expect(returnScene).toHaveAttribute("data-phase","chutes");
  await advance(2);
  await button("Confirm landing").click();
  await expect(returnScene).toHaveAttribute("data-phase","splashdown");
  await button("Confirm crew recovery").click();

  await page.reload();
  await expect(page.locator("#launch-status")).toHaveText("Crew recovered on Earth");
  await expect(guide).toHaveAttribute("data-state","complete");
  await expect(guide.locator("#guide-count")).toHaveText("14 / 14 complete");
  await expect(returnScene).toHaveAttribute("data-phase","recovered");
  await expect(page.locator("#return-sea-backdrop")).toBeVisible();
  await expect(page).toHaveURL(missionUrl);
  await button("Open orbit minimap").click();
  await expect(navigation.locator("#navigation-reserve")).toContainText("9 cold-gas pulses");
});

test("Kestrel onboarding shows its own route and checkout controls on mobile", async ({ page }) => {
  await page.setViewportSize({width:320,height:568});
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.getByRole("radio",{name:"Orbital Systems Checkout"}).check();
  await page.getByRole("button",{name:"New run"}).click();
  const tutorial = page.getByRole("dialog");
  const next = tutorial.getByRole("button",{name:"Next",exact:true});
  const heading = tutorial.getByRole("heading");
  const assertLayout = async () => {
    expect(await tutorial.evaluate(dialog=>dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await expect(tutorial.getByRole("button",{name:"Skip"})).toBeInViewport();
  };

  await expect(tutorial).toContainText("Orbital Systems Checkout · Kestrel");
  await expect(tutorial.getByRole("list",{name:"Mission route"}).getByRole("listitem")).toHaveText([
    /Launch.*Kestrel/, /Orbit.*160 × 170 km/, /Systems checkout/, /Recovery/,
  ]);
  await assertLayout();
  await next.click();
  await expect(heading).toBeFocused();
  await expect(tutorial.getByRole("listitem")).toHaveText([
    /Electrical bus.*Online/, /Hydraulics.*Online/, /Oxygen supply.*Online/, /CO₂ scrubber.*Online/,
  ]);
  await expect(tutorial).toContainText("Start ship systems");
  await expect(tutorial).toContainText("Launch time controls");
  await assertLayout();

  await next.click();
  await expect(tutorial.getByRole("listitem")).toHaveText([
    /Verify restraints and suit seals.*Assign Sana/,
    /Confirm propulsion readiness.*Assign Ivo/,
    /Read back range clearance.*Assign Noor/,
  ]);
  await expect(tutorial.locator(".crew-face")).toHaveCount(3);
  await expect(tutorial).toContainText("Verified");
  await assertLayout();
  await tutorial.getByRole("button",{name:"Back"}).click();
  await expect(heading).toHaveText("Bring the ship online");
  await tutorial.getByRole("button",{name:"Skip"}).click();
  await expect(tutorial).toBeHidden();
  await expect(page.getByRole("button",{name:"Start ship systems"})).toBeEnabled();
});

test("the exterior workflow recalls on link loss and verifies a later repair once", async ({ page }) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>{
    if (!localStorage.getItem("eva-test-initialized")) {
      localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
        time:135,jobs:{},ignition:60,separation:105,insertion:135,
      }));
      localStorage.setItem("eva-test-initialized","1");
    }
  });
  await page.goto("/flight?view=launch");
  const button = name => page.getByRole("button",{name,exact:true});
  const process = page.getByRole("dialog",{name:"Ship workflows"});
  async function openExterior() {
    await (await hudButton(page, "Workflows")).click();
    await process.getByRole("button",{name:"Exterior inspection",exact:true}).click();
  }
  async function step(count) {
    for (let i=0;i<count;i++) await button("Advance one mission tick").click();
  }
  await openExterior();
  await process.getByLabel("Qualified assignee").selectOption("0");
  await button("Save procedure").click();
  await button("Assign spacewalk").click();
  await expect(process.locator("#process-crew-board")).toContainText("Airlock watch for Mara");
  await expect(process.locator("#process-summary")).toContainText("v2 · Mara");
  await button("Close").click();
  await expect(page.locator("#guide-next")).toContainText("Wait for the spacewalker");
  const checkpoint = button("3 min before checkpoint");
  await expect(checkpoint).toHaveAccessibleDescription(/Wait for the spacewalker/);
  const clock = page.locator("#hud-clock");
  const heldAt = await clock.innerText();
  await checkpoint.press("Enter");
  await expect(clock).toHaveText(heldAt);
  await step(3);
  const suited = page.locator("#ship .pawn[data-suited=true]");
  await expect(suited).toHaveCount(1);
  await expect(suited.locator("meter")).toBeVisible();
  await suited.click();
  await expect(page.locator("#region-detail")).toContainText("O₂ reserve 76%");
  await expect(page.locator("#region-detail")).toContainText("inner hatch closed · outer hatch open");
  await button("Close Digital twin widget").click();
  await page.reload();
  await expect(suited).toHaveCount(1);
  await openExterior();
  await button("Simulate suit link loss").click();
  await expect(process.locator("#process-events")).toContainText("Recall ordered");
  await button("Close").click();
  await step(2);
  await expect(suited).toHaveCount(0);
  await expect(page.locator("#guide-next")).toContainText("verify safe return in Workflows");
  await expect(checkpoint).toHaveAccessibleDescription(/verify safe return in Workflows/);
  await openExterior();
  await expect(button("Verify safe return")).toBeHidden();
  await expect(button("Assign spacewalk")).toBeDisabled();
  await button("Restore suit link").click();
  await button("Assign spacewalk").click();
  await button("Close").click();
  await step(7);
  await openExterior();
  await button("Verify safe return").click();
  await expect(process.locator("#process-events")).toContainText("Commander verified antenna service");
  await expect(button("Verify safe return")).toBeHidden();
  await button("Close").click();
  await expect(page.locator("#eva-antenna")).toHaveText("Antenna · link verified");
  await expect(page.locator("#guide-next")).toContainText("Coast to the departure point");
  await expect(checkpoint).toBeEnabled();
  await openExterior();
  await process.getByLabel("Repeat after completion").selectOption("300");
  await button("Save procedure").click();
  await button("Close").click();
  await expect(checkpoint).toHaveAccessibleDescription(/Exterior inspection is due/);
});

test("airlock rehearsal shows pressure and interlocks without moving the mission clock", async ({ page }) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.goto("/flight?view=replay");
  const clock = await page.locator("#hud-clock").innerText();
  await page.getByRole("button",{name:"Atmosphere",exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"Atmosphere rehearsal"});
  const hatches = dialog.locator("#airlock-readings");
  await expect(hatches).toContainText("Inner hatch open · Outer hatch sealed");
  await dialog.getByRole("button",{name:"Depressurize chamber"}).click();
  await expect(hatches).toContainText("Inner hatch sealed · Outer hatch open");
  await expect(dialog.locator("#airlock-gases")).toContainText(/Airlock · 0\./);
  await expect(dialog.locator("#airlock-exposure")).toContainText("Keep unsuited crew out");
  await dialog.getByRole("button",{name:"Repressurize chamber"}).click();
  await expect(hatches).toContainText("Inner hatch open · Outer hatch sealed");
  await expect(dialog.locator("#airlock-exposure")).toContainText("within rehearsal limits");
  await dialog.getByRole("button",{name:"Close"}).click();
  await expect(page.locator("#hud-clock")).toHaveText(clock);
});

test("ISS replay portraits and pawns open crew anatomy with evidence for the selected region", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 820 });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.getByRole("button", { name: "Open replay", exact: true }).click();

  await page.locator("#crew-strip .crew-portrait").first().click();
  const twin = page.locator("#personnel-widget");
  await expect(twin).toBeVisible();
  const firstMember = await twin.locator("#personnel-name").innerText();
  await twin.getByRole("tab", { name: "Anatomy", exact: true }).press("ArrowRight");
  await expect(twin.getByRole("tab", { name: "Skeleton" })).toBeFocused();
  await expect(twin.locator("#region-reading")).toHaveText("Unobserved");

  await twin.getByRole("button", { name: "Wristband · left wrist" }).click();
  await expect(twin.locator("#wrist-bpm")).toHaveText(/\d+ bpm/);
  await expect(twin.locator("#region-source")).toHaveText("Simulated optical wristband");
  await expect(twin.locator("#region-reading")).toHaveText(/\d+ bpm/);
  await expect(twin.locator("#region-time")).toHaveText(/Observed T\+/);
  await twin.getByRole("button", { name: "Back pod · upper back" }).click();
  await expect(twin.locator("#region-source")).toHaveText("Simulated back pod");
  await expect(twin.locator("#region-detail")).toContainText("synthetic EMG");
  await twin.getByRole("tab", { name: "Suit", exact: true }).click();
  await expect(twin.locator("[data-anatomy-suit]")).toBeVisible();
  await expect(twin.locator("#region-reading")).toHaveText("Suit status unavailable");
  await expect(twin.locator("#region-time")).toBeEmpty();
  await twin.getByRole("button", { name: "Close Digital twin widget" }).click();

  await page.locator("#ship .pawn").nth(1).click();
  await expect(twin).toBeVisible();
  await expect(twin.locator("#personnel-name")).not.toHaveText(firstMember);
  await expect(twin.getByRole("tab", { name: "Anatomy", exact: true })).toHaveAttribute("aria-selected", "true");
  await twin.getByRole("button",{name:"Close Digital twin widget"}).click();
  await (await hudButton(page, "Workflows")).click();
  const process = page.getByRole("dialog",{name:"Ship workflows"});
  await process.getByLabel("Qualified assignee").selectOption("0");
  await process.getByRole("button",{name:"Save procedure"}).click();
  await process.getByRole("button",{name:"Release inspection"}).click();
  await expect(process.locator("#process-summary")).toContainText(/v2 · Mara/);
  await process.getByRole("button",{name:"Close"}).click();
  const resources = page.getByRole("group", {name:"Mission resources"});
  await expect(resources).toContainText("40 meals");
  await page.getByRole("button", {name:"Skip one mission hour"}).click();
  await page.getByRole("button", {name:"Skip one mission hour"}).click();
  await expect(resources).not.toContainText("40 meals");
  await (await hudButton(page, "Workflows")).click();
  await expect(process.getByRole("region",{name:"Process event log"})).toContainText("Result recorded");
  await expect(process.locator("#process-summary")).toContainText("45 s from release to result");
  await process.getByLabel("Qualified assignee").selectOption("2");
  await process.getByRole("button",{name:"Save procedure"}).click();
  await expect(process.locator("#process-config")).toContainText("Procedure v3 · Ivo");
  await expect(process.locator("#process-summary")).toContainText("v2 · Mara");
  const [download] = await Promise.all([
    page.waitForEvent("download"), process.getByRole("button",{name:"Export case events"}).click(),
  ]);
  const events = JSON.parse(readFileSync(await download.path(),"utf8"));
  expect(events.map(event=>event.event)).toEqual(["Released","Travelling","Inspection started","Result recorded"]);
  expect(events.every(event=>event.assignee === "SIM-01" && event.version === 2)).toBe(true);
});

test("Flight resumes independent campaigns and preserves the legacy Asteria save", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.evaluate(() => localStorage.setItem("sx:launch-checkout:v1",
    JSON.stringify({time:15, jobs:{engine:{due:45}},startupAt:0,hold:true})));
  await page.reload();
  const button = name => page.getByRole("button", { name, exact: true });
  await expect(page.getByRole("heading", { name:"SYMBIOSIS X", exact:true })).toBeVisible();
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await button("Resume").click();
  await expect(page.locator("#launch-status")).toHaveText("Launch held");
  await expect(button("Assigned Ivo")).toBeDisabled();
  await (await hudButton(page, "Save and exit")).click();

  await page.getByRole("radio", { name:"Orbital Systems Checkout" }).check();
  await expect(page.locator("#campaign-ship")).toContainText("Kestrel");
  await expect(page.locator("#campaign-save")).toHaveText("Available · no saved run");
  await (await hudButton(page, "Briefing")).click();
  await expect(page.getByRole("dialog", { name:"Orbital Systems Checkout briefing" })).toContainText("4–6 minutes");
  await button("Close").click();
  await button("New run").click();
  await button("Skip").click();
  await expect(page.locator("#launch-mission-name")).toHaveText("Orbital Systems Checkout");
  for (const crew of ["Sana", "Ivo", "Noor"]) await button("Assign " + crew).click();
  await button("Start ship systems").click();
  const step = button("Advance 15 s");
  for (let i = 0; i < 3; i++) await step.click();
  await button("Arm countdown").click();
  await step.click();
  await button("Launch").click();
  await expect(button("Separate booster")).toBeVisible();
  await (await hudButton(page, "Save and exit")).click();

  const reopened = await context.newPage();
  await page.close();
  await reopened.emulateMedia({ reducedMotion: "reduce" });
  await reopened.goto("/flight");
  const reopenedButton = name => reopened.getByRole("button", { name, exact: true });
  await expect(reopened.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await reopened.getByRole("radio", { name:"Orbital Systems Checkout" }).check();
  await expect(reopened.locator("#campaign-save")).toHaveText("Booster burnout · T+1:30");
  await reopenedButton("Resume").click();
  await expect(reopened.locator("#pad-clock")).toHaveText("T+1:30");
  await reopenedButton("Separate booster").click();
  await reopenedButton("Commit orbital insertion").click();
  await expect(reopened.locator("#flight-mission-name")).toHaveText("Orbital Systems Checkout");
  await expect(reopenedButton("Commit ISS transfer burn")).toBeHidden();
  await (await hudButton(reopened, "Orbit map")).click();
  await expect(reopened.locator("#navigation-pe")).toHaveText("160 km");
  await expect(reopened.locator("#navigation-approach")).toHaveText("Orbital checkout");
  await reopenedButton("Close").click();
  await reopenedButton("Go to control").click();
  await reopenedButton("Assign Ivo to orbital systems check").click();
  const orbitStep = reopenedButton("Advance one mission tick");
  await orbitStep.click();
  await orbitStep.click();
  await expect(reopened.locator("#resource-phase")).toContainText("Orbital systems verified");
  await reopenedButton("Commit deorbit").click();
  for (let i = 0; i < 3; i++) await orbitStep.click();
  await reopenedButton("Confirm landing").click();
  await reopenedButton("Confirm crew recovery").click();
  await (await hudButton(reopened, "Save and exit")).click();
  await reopenedButton("New run").click();
  await reopenedButton("Keep saved run").click();
  await expect(reopened.locator("#campaign-save")).toContainText("Crew recovered on Earth");
  await reopenedButton("New run").click();
  await reopenedButton("Replace saved run").click();
  await expect(reopened.locator("#pad-clock")).toHaveText("T+0:00");
  await (await hudButton(reopened, "Save and exit")).click();
  await reopened.getByRole("radio", { name:"ISS Research and Return" }).check();
  await expect(reopened.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
});

test("Flight Command shows guidance and stops three minutes before each coast checkpoint", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>{
    const key = "sx:launch-checkout:v1";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key,JSON.stringify({time:135,jobs:{},ignition:60,separation:105,insertion:135}));
    }
  });
  await page.goto("/flight?view=launch");

  const transport = page.getByRole("group",{name:"Flight playback"});
  const checkpoint = transport.getByRole("button",{name:"3 min before checkpoint"});
  const tick = transport.getByRole("button",{name:"Advance one mission tick"});
  const resources = page.getByRole("group",{name:"Mission resources"});
  const guide = page.getByRole("complementary",{name:"Mission guide"});
  const clock = page.locator("#hud-clock");
  const command = page.getByRole("region",{name:"Flight command"});
  const guidance = command.getByRole("region",{name:"Flight guidance"});
  const savedTime = ()=>page.evaluate(()=>JSON.parse(localStorage.getItem("sx:launch-checkout:v1")).time);

  await expect(resources).toContainText("CO₂");
  await expect(resources).toContainText("Headroom");
  await expect(resources.locator("#command-phase")).toContainText("waiting for ISS window");
  await expect(resources.locator("#command-next")).toContainText("Coast to the departure point");
  await expect(resources.locator("#command-reserve")).toHaveText("29 kg liquid propellant");
  const playbackBox = await transport.boundingBox();
  const resourceBox = await resources.boundingBox();
  const guideBox = await guide.boundingBox();
  expect(resourceBox.y).toBeGreaterThanOrEqual(playbackBox.y+playbackBox.height);
  expect(resourceBox.x+resourceBox.width).toBeLessThan(guideBox.x);
  expect(playbackBox.x+playbackBox.width).toBeLessThanOrEqual(390);

  await guide.getByRole("button",{name:"Go to control"}).click();
  await expect(guidance).toHaveAttribute("data-mode","coast");
  await expect(guidance.getByRole("img",{name:"Horizon · coast guidance"})).toBeVisible();

  const timings = await page.locator("#flight-data").evaluate(script=>{
    const {navigation} = JSON.parse(script.textContent).missions[0];
    return navigation;
  });
  const departure = 135+timings.departureS;
  await checkpoint.focus();
  await expect(checkpoint).toBeFocused();
  await checkpoint.press("Enter");
  await expect.poll(savedTime).toBe(departure-180);
  const stopped = await clock.innerText();
  await expect(checkpoint).toBeDisabled();
  await expect(checkpoint).toHaveAccessibleDescription(/Within 3 mission minutes/);
  await checkpoint.press("Enter");
  await expect(clock).toHaveText(stopped);
  await tick.click();
  await expect.poll(savedTime).toBe(departure-165);

  await command.getByRole("button",{name:"Coast to ISS departure window"}).click();
  await expect.poll(savedTime).toBe(departure);
  await expect(guidance).toHaveAttribute("data-mode","burn");
  await expect(guidance).toContainText("71.3 m/s");
  await expect(checkpoint).toHaveAccessibleDescription(/Commit ISS transfer burn/);
  await checkpoint.press("Enter");
  await expect.poll(savedTime).toBe(departure);

  await command.getByRole("button",{name:"Commit ISS transfer burn"}).click();
  await expect(guidance).toHaveAttribute("data-mode","coast");
  const apoapsis = departure+timings.transferS;
  await checkpoint.press("Enter");
  await expect.poll(savedTime).toBe(apoapsis-180);
  await expect(command.getByRole("button",{name:"Match station orbit"})).toBeHidden();
  await command.getByRole("button",{name:"Coast to transfer apoapsis"}).click();
  await expect(guidance).toHaveAttribute("data-mode","burn");
  await expect(checkpoint).toHaveAccessibleDescription(/Match the station’s orbit/);
  await command.getByRole("button",{name:"Match station orbit"}).click();
  await expect(guidance).toHaveAttribute("data-mode","docking");
  await expect(guidance.getByRole("img",{name:/ship and the International Space Station/})).toBeVisible();
  await expect(checkpoint).toHaveAccessibleDescription(/Within 3 mission minutes/);
});

test("Orbit guidance shows Kestrel during systems checkout", async ({ page }) => {
  await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>localStorage.setItem("sx:orbital-systems-checkout:v1",JSON.stringify({
    time:105,jobs:{},ignition:60,separation:90,insertion:105,
  })));
  await page.goto("/flight?view=launch&mission=orbital-systems-checkout");
  await page.getByRole("complementary",{name:"Mission guide"}).getByRole("button",{name:"Go to control"}).click();
  const guidance = page.getByRole("region",{name:"Flight guidance"});
  await expect(guidance).toHaveAttribute("data-mode","orbit");
  await expect(guidance.getByRole("img",{name:"Kestrel · orbit guidance"})).toBeVisible();
  const checkpoint = page.getByRole("button",{name:"3 min before checkpoint"});
  await expect(checkpoint).toHaveAccessibleDescription(/Assign Ivo/);
  await page.getByRole("button",{name:"Assign Ivo to orbital systems check"}).click();
  await expect(checkpoint).toHaveAccessibleDescription(/Within 3 mission minutes/);
});

test("mission plan and orbit map stay in their own corners from checkout through recovery", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.addInitScript(() => {
    if (!localStorage.getItem("sx:launch-checkout:v1")) {
      localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({time:15,jobs:{},hold:true}));
    }
  });
  await page.setViewportSize({width:1920,height:1080});
  await page.goto("/flight?view=launch");
  const overview = page.getByRole("region", { name:"Mission Overview" });
  const orbit = page.getByRole("region", { name:"Orbital navigation" });
  const attitude = page.getByRole("region", { name:"Flight attitude instrument" });

  async function verifyCorners(width, height, steering) {
    await expect(overview).toBeInViewport({ratio:1});
    await expect(orbit).toBeInViewport({ratio:1});
    const left = await overview.boundingBox();
    const right = await orbit.boundingBox();
    expect(left.x).toBeLessThan(12);
    expect(width-right.x-right.width).toBeLessThan(12);
    expect(height-left.y-left.height).toBeLessThan(12);
    expect(height-right.y-right.height).toBeLessThan(12);
    expect(left.x+left.width).toBeLessThan(right.x);
    if (steering) {
      const center = await attitude.boundingBox();
      expect(Math.abs(center.x+center.width/2-width/2)).toBeLessThan(1);
      expect(left.x+left.width).toBeLessThan(center.x);
      expect(center.x+center.width).toBeLessThan(right.x);
    }
  }

  await verifyCorners(1920,1080,false);
  await expect(overview.locator('[aria-current="step"]')).toHaveAccessibleName("Checkout · Held");
  await expect(overview).toContainText("Verify crew and ground station checks");
  await expect(orbit).toContainText("Pad · trajectory preview");
  await overview.getByRole("button", { name:"Open plan" }).click();
  const plan = page.getByRole("dialog", { name:"Flight plan" });
  await expect(plan).toContainText("Launch Horizon, deliver the research kit to the ISS, and recover the crew on Earth.");
  await expect(plan.locator(".plan-stage")).toHaveCount(6);
  await expect(plan.locator("[data-status=held]")).toContainText("Plan T+0:45 · Held");
  await expect(plan.locator("[data-status=upcoming] svg").first()).toBeVisible();
  await plan.getByRole("button", { name:"Close" }).click();
  await expect(overview.getByRole("button", { name:"Open plan" })).toBeFocused();
  await orbit.getByRole("button", { name:"Open orbit minimap" }).click();
  const trajectory = page.getByRole("dialog", { name:"Orbit map" });
  await expect(trajectory).toContainText("Launchpad · dashed insertion reference");
  await trajectory.getByRole("button", { name:"Close" }).click();

  await page.setViewportSize({width:390,height:660});
  await page.evaluate(() => {
    localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
      time:135,startupAt:0,ignition:60,separation:105,insertion:135,
      jobs:{restraints:{due:45},engine:{due:45},link:{due:45}},
    }));
  });
  await page.reload();
  await verifyCorners(390,660,true);
  await expect(page.getByRole("group", { name:"Flight playback" })).toBeInViewport();
  await expect(overview.locator('[aria-current="step"]')).toHaveAccessibleName("Rendezvous · Current");
  await expect(overview.locator("[data-step=complete]")).toHaveCount(3);
  await overview.getByRole("button", { name:"Deck" }).click();
  await expect(overview.getByRole("img", { name:"Ship rooms and crew positions" })).toBeVisible();
  await overview.getByRole("button", { name:"Plan",exact:true }).click();

  await page.evaluate(() => {
    const key = "sx:launch-checkout:v1";
    localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)),time:420,
      phasing:150,matchedAt:180,capture:210,hatchAt:225,transferAt:240,archivedAt:270,
      departedAt:300,deorbitAt:330,landedAt:390,recoveredAt:420,
    }));
  });
  await page.reload();
  await verifyCorners(390,660,true);
  await expect(overview.locator("[data-step=complete]")).toHaveCount(6);
  await expect(overview).toContainText("Crew safely back on Earth");
  await expect(orbit).toContainText("Earth recovery");
  expect(errors).toEqual([]);
});

test("a low upper-stage reserve holds the ISS burn and preserves the independent return supply", async ({ page }) => {
  await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>{
    localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
      time:6000,jobs:{},ignition:60,separation:105,insertion:150,
    }));
  });
  await page.goto("/flight?view=launch");
  await (await hudButton(page, "Flight command")).click();
  await expect(page.locator("#launch-status")).toHaveText("Stable orbit · ISS window open");
  await expect(page.locator("#launch-next")).toContainText("reserve below minimum");
  const transfer = page.getByRole("button",{name:"Commit ISS transfer burn"});
  await expect(transfer).toBeDisabled();
  const before = await page.locator("#orbital-propellant").textContent();
  await transfer.dispatchEvent("click");
  await expect(page.locator("#orbital-propellant")).toHaveText(before);
  await expect(page.locator("#return-propellant")).toHaveText("8.8 kg fuel / 13.2 kg oxidizer");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("sx:launch-checkout:v1")).phasing)).toBeUndefined();
});

test("saved vehicle provisions quarantine treated water and accept the station receipt once", async ({ page }) => {
  await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>{
    if (sessionStorage.getItem("provisions-test")) return;
    sessionStorage.setItem("provisions-test","yes");
    localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
      time:525,jobs:{},ignition:60,separation:105,insertion:135,phasing:150,matchedAt:180,
      capture:210,hatchAt:225,
    }));
  });
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/flight?view=launch");
  const button = name => page.getByRole("button",{name,exact:true});
  await button("Provisions").click();
  const ledger = page.getByRole("dialog",{name:"Vehicle provisions"});
  const value = label => ledger.locator("dt").filter({hasText:new RegExp("^"+label+"$")}).locator("xpath=following-sibling::dd[1]");
  const step = page.getByRole("group",{name:"Flight playback"}).getByRole("button",{name:"Advance one mission tick"});
  await expect(ledger).toContainText("Horizon · synthetic inventory");
  await expect(value("Potable")).toHaveText(/2[0-3]\./);
  await button("Conserve water").click();
  await expect(ledger).toContainText("defer hygiene");
  await button("Treat wastewater").click();
  const held = await value("Awaiting quality verification").textContent();
  expect(held, await ledger.locator("#provisions-receipt").textContent()).not.toBe("0.000 L");
  await button("Verify treated water").click();
  await expect(ledger).toContainText("Quality verification pending");
  await expect(value("Awaiting quality verification")).toHaveText(held);
  await expect(button("Accept station water receipt")).toBeDisabled();
  await button("Close provisions").click();
  await (await hudButton(page, "Flight command")).click();
  await button("Hand off research kit").click();
  await button("Assign Sana to station research").click();
  await button("Close flight command").click();
  await button("Provisions").click();
  await button("Accept station water receipt").click();
  await expect(ledger).toContainText("Station water credited to the return capsule");
  await expect(button("Accept station water receipt")).toBeDisabled();
  await button("Close provisions").click();
  await step.click();
  await button("Provisions").click();
  await button("Verify treated water").click();
  await expect(value("Awaiting quality verification")).toHaveText("0.000 L");
  await button("Accept station water receipt").click();
  await expect(ledger).toContainText("Station receipt already used");
  await button("Close provisions").click();
  await page.reload();
  await button("Provisions").click();
  await expect(ledger).toContainText("defer hygiene");
  await expect(value("Awaiting quality verification")).toHaveText("0.000 L");
});

test("Galley holds a meal lot and requires a separate safety verification", async ({page}) => {
  await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(()=>{
    if (sessionStorage.getItem("galley-safety-test")) return;
    sessionStorage.setItem("galley-safety-test","yes");
    localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
      time:3900,jobs:{},ignition:60,separation:105,insertion:135,phasing:150,matchedAt:180,capture:210,
    }));
  });
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/flight?view=launch");
  const button = name=>page.getByRole("button",{name,exact:true});
  const open = async ()=>button("Provisions").click();
  const close = async ()=>button("Close provisions").click();
  const step = page.getByRole("group",{name:"Flight playback"}).getByRole("button",{name:"Advance one mission tick"});
  const status = page.locator("#galley-status");
  await open();
  await expect(status).toContainText("Cleanliness unknown");
  await button("Isolate potable water lot").click();
  await expect(page.locator("#galley-evidence")).toContainText("0.500 L held");
  await expect(button("Verify and release water lot")).toBeDisabled();
  await button("Report suspected food exposure").click();
  await expect(status).toContainText("Horizon meal lot A on hold (2 packs)");
  await button("Assign disinfection").click();
  await expect(status).toContainText("disinfection in progress");
  await close();
  await step.click();
  await step.click();
  await open();
  await expect(status).toContainText("verification due");
  await expect(button("Verify and release surface")).toBeDisabled();
  await page.getByLabel("Assigned astronaut").selectOption("1");
  await button("Verify and release water lot").click();
  await expect(page.locator("#galley-evidence")).toContainText("Verified and released at T+");
  await button("Record failed verification").click();
  await expect(status).toContainText("Held · disinfection due");
  await button("Assign disinfection").click();
  await close();
  await step.click();
  await step.click();
  await open();
  await page.getByLabel("Assigned astronaut").selectOption("0");
  await button("Verify and release surface").click();
  await expect(status).toContainText("Inspection recorded");
  await expect(status).toContainText("meal lot A on hold");
  await close();
  await page.reload();
  await open();
  await expect(status).toContainText("Inspection recorded");
  await expect(status).toContainText("meal lot A on hold (2 packs)");
  await page.locator("#galley-hygiene summary").click();
  await expect(page.locator("#galley-audit")).toContainText("Verification failed");
  await expect(page.locator("#galley-audit")).toContainText("Verification passed");

  await close();
  await page.getByRole("button",{name:"Medical",exact:true}).click();
  await button("Food exposure review").click();
  const review = page.getByRole("dialog",{name:"Food exposure review"});
  await expect(review.locator("#food-exposure-meals li").first()).not.toHaveText("No completed meal records for this lot");
  const subjects = await review.locator("#food-exposure-meals li").allTextContents();
  const options = await review.locator("#food-symptom-crew option").allTextContents();
  const shared = options.filter(name=>subjects.some(meal=>meal.startsWith(name+" ·")));
  expect(shared.length).toBeGreaterThanOrEqual(2);
  for (const [index,name] of shared.slice(0,2).entries()) {
    await review.getByLabel("Astronaut").selectOption({label:name});
    await review.getByLabel("Observation").selectOption(index ? "stomach" : "nausea");
    await button("Record private symptom report").click();
  }
  await expect(review.locator("#food-exposure-reports li")).toHaveCount(2);
  await button("Review suspected case").click();
  await expect(button("Record follow-up recheck")).toBeDisabled();
  await button("Close review").click();
  for (let count = 0; count < 4; count++) await step.click();
  await button("Food exposure review").click();
  await button("Record follow-up recheck").click();
  await button("Share food safety status").click();
  await expect(review).toContainText("Ground delivery pending");
  await button("Close review").click();
  await page.locator('[data-map-view="ground"]').dispatchEvent("click");
  const delivered = page.locator("#ground-food-safety");
  await expect(delivered).toBeHidden();
  for (let count = 0; count < 20; count++) await step.click();
  await expect(delivered).toContainText("Food safety review complete");
  for (const name of shared) await expect(delivered).not.toContainText(name);
  await expect(delivered).not.toContainText(/nausea|discomfort|meal lot A/i);
});
