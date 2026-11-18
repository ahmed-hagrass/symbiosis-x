import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { hudButton } from "./support/hud.js";

let directory;
let flightHtml;

test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "flight-eva-"));
  const file = join(directory, "flight.html");
  execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", file], {
    cwd: new URL("../../", import.meta.url), stdio: "inherit",
  });
  flightHtml = readFileSync(file, "utf8");
});

test.afterAll(() => {
  if (directory) rmSync(directory, {recursive:true,force:true});
});

test("crew suits up, repairs antenna and returns once", async ({page}) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route(url=>url.pathname==="/flight", route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.addInitScript(() => {
    if (localStorage.getItem("sx:launch-checkout:v1")) return;
    localStorage.setItem("sx:launch-checkout:v1",JSON.stringify({
      time:135,jobs:{},ignition:60,separation:105,insertion:135,
    }));
  });
  await page.goto("/flight?view=launch");
  const button = name => page.getByRole("button",{name,exact:true});
  const workflows = page.getByRole("dialog",{name:"Ship workflows"});
  const goToExterior = async () => {
    await (await hudButton(page, "Workflows")).click();
    await workflows.getByRole("button",{name:"Exterior inspection",exact:true}).click();
  };
  const advance = async count => {
    for (let i=0; i<count; i++) await button("Advance one mission tick").click();
  };

  await goToExterior();
  await expect(workflows.locator("#eva-antenna-reading")).toContainText("2 dB");
  await workflows.getByLabel("Repeat after completion").selectOption("300");
  await button("Save procedure").click();
  await workflows.getByRole("button",{name:"Close",exact:true}).click();

  await button("3 min before checkpoint").press("Enter");
  await expect(page.locator("#hud-clock")).toHaveText("T+02:15");
  await page.getByRole("complementary",{name:"Mission guide"}).getByRole("button",{name:"Go to control"}).click();
  await button("Coast to ISS departure window").click();
  await expect(page.locator("#hud-clock")).toHaveText("T+07:15");
  await expect(page.locator("#guide-next")).toContainText("Assign the scheduled spacewalk");

  await goToExterior();
  await button("Simulate suit link loss").click();
  await expect(button("Assign spacewalk")).toBeDisabled();
  await page.reload();
  await goToExterior();
  await expect(workflows.locator("#eva-readiness")).toContainText("Suit link offline");
  await button("Restore suit link").click();
  await expect(workflows.locator("#eva-readiness")).toContainText("Release checks passed");
  await button("Assign spacewalk").click();
  const caseId = (await workflows.locator("#process-summary").innerText()).split(" · ")[0];
  await workflows.getByRole("button",{name:"Close",exact:true}).click();
  const suited = page.locator("#ship .pawn[data-suited=true]");
  const outside = page.locator("#ship .pawn[data-exterior=true]");
  await expect(suited).toHaveCount(1);
  await expect(outside).toHaveCount(0);
  await advance(3);
  await expect(outside).toHaveCount(1);
  await expect(page.locator("#eva-tether")).toBeVisible();
  await page.reload();
  await expect(outside).toHaveCount(1);
  await goToExterior();
  await expect(workflows.locator("#process-summary")).toContainText(caseId);
  await expect(button("Verify safe return")).toBeHidden();
  await expect(workflows.locator("#eva-antenna-reading")).toContainText("2 dB · synthetic baseline");
  await workflows.getByRole("button",{name:"Close",exact:true}).click();

  await advance(4);
  await expect(suited).toHaveCount(0);
  await expect(outside).toHaveCount(0);
  await goToExterior();
  await button("Verify safe return").click();
  await expect(workflows.locator("#eva-antenna-reading")).toContainText("2 → 8 dB");
  await expect(workflows.locator("#process-events li").filter({hasText:"Commander verified antenna service"})).toHaveCount(1);
  await page.reload();
  await goToExterior();
  await expect(button("Verify safe return")).toBeHidden();
  await expect(workflows.locator("#eva-antenna-reading")).toContainText(caseId+"-antenna");
  await workflows.getByRole("button",{name:"Close",exact:true}).click();
  await (await hudButton(page, "#end-mission")).click();
  const debrief = page.getByRole("dialog",{name:"End this mission?"});
  await debrief.getByRole("button",{name:"End mission",exact:true}).click();
  await expect(page.locator("#end-mission-facts")).toContainText("2 → 8 dB · "+caseId+"-antenna");
});
