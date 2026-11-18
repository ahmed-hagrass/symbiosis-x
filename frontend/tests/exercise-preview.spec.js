import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startBackend, stopBackend, useBackend } from "./support/backend.js";
import { hudButton } from "./support/hud.js";

test("Flight compares optional exercise and shows the recorded deferral outcome", async ({ page, request }) => {
  const output = mkdtempSync(join(tmpdir(),"sx-exercise-flight-"));
  const backend = await startBackend("exercise-preview");
  try {
    const file = join(output,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",file],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    const html = readFileSync(file,"utf8");
    await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:html}));
    await useBackend(page,backend.origin);
    const api = backend.origin+"/api/v1";
    const tokens = await (await request.post(api+"/demo/session")).json();
    const headers = {Authorization:"Bearer "+tokens.facilitator};
    const start = await request.post(api+"/runs",{headers,data:{
      start_id:"exercise-browser",scenario_id:"exercise-power-preview",scenario_version:"1",seed:4242,
    }});
    expect(start.ok()).toBeTruthy();
    const {run_id:run} = await start.json();
    const advance = async (from,to) => {
      for (let step=from;step<to;step++) {
        const response = await request.post(api+"/runs/"+run+"/advance",{headers,data:{
          advance_id:"advance-"+step,expected_step:step,
        }});
        expect(response.ok()).toBeTruthy();
      }
    };
    await advance(0,9);
    await page.goto("/flight?view=replay&run_id="+run);
    await (await hudButton(page, "Workflows")).click();
    const panel = page.getByRole("region",{name:"Exercise schedule · synthetic"});
    await expect(panel).toContainText("Keep exercise · Eligible");
    await expect(panel).toContainText("3200 ppm");
    await advance(9,10);
    const defer = panel.getByRole("button",{name:"Commander · Defer exercise"});
    await defer.click();
    await expect(panel).toContainText("Decision held · stale decision rev.");
    await expect(panel).toContainText("Keep exercise · Held · power limit");
    await expect(panel).toContainText("0.40 kW required, 0.20 kW available");
    await defer.click();
    await expect(panel).toContainText("Exercise deferral accepted.");
    await advance(10,11);
    await panel.getByRole("button",{name:"Refresh schedule evidence"}).click();
    await expect(panel).toContainText(/predicted (\d+\.\d+) ppm CO₂ · observed \1 ppm CO₂/);
  } finally {
    stopBackend(backend);
    rmSync(output,{recursive:true,force:true});
  }
});
