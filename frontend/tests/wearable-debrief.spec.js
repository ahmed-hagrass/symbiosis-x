import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startBackend, stopBackend, useBackend } from "./support/backend.js";
import { hudButton } from "./support/hud.js";

test("Ground sees the delivered operational outcome only", async ({ page, request }) => {
  const directory = mkdtempSync(join(tmpdir(),"sx-wearable-debrief-"));
  const backend = await startBackend("wearable-debrief");
  try {
    const output = join(directory,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    const html = readFileSync(output,"utf8");
    await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body:html}));
    await useBackend(page,backend.origin);
    const api = backend.origin+"/api/v1";
    const tokens = await (await request.post(api+"/demo/session")).json();
    const auth = role => ({Authorization:"Bearer "+tokens[role]});
    const send = async (path,role,data) => {
      const response = await request.post(api+path,{headers:auth(role),data});
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    const started = await send("/runs","facilitator",{
      start_id:"wearable-debrief-browser",scenario_id:"exercise-power-preview",scenario_version:"1",seed:4242,
    });
    const run = "/runs/"+started.run_id;
    const advance = async (from,to) => {
      for (let step=from;step<to;step++) await send(run+"/advance","facilitator",{
        advance_id:"advance-"+step,expected_step:step,
      });
    };
    await advance(0,7);
    const privateDevices = run+"/crew/wearables";
    const devices = await (await request.get(api+privateDevices+"?crew_id=SIM-02",{headers:auth("crew")})).json();
    const task = privateDevices+"/rechecks/"+devices.recheck.task_id+"?crew_id=SIM-02";
    await send(task,"crew",{action:"assign",observer_id:"SIM-03"});
    await advance(7,8);
    await send(task,"crew",{action:"record",observer_id:"SIM-03"});
    await advance(8,10);
    await page.goto("/flight?view=replay&run_id="+started.run_id);
    await (await hudButton(page, "Workflows")).click();
    await page.getByRole("button",{name:"Commander · Defer exercise"}).click();
    await advance(10,11);
    await page.getByRole("button",{name:"Refresh schedule evidence"}).click();
    const debrief = page.getByRole("region",{name:"Private wearable debrief"});
    await expect(debrief).toContainText("Detection to verified check · 28 s");
    await expect(debrief).toContainText("Ground operational update · Pending · due T+04:15");
    await page.goto(run+"/ground");
    await expect(page.getByTestId("ground-basis-snapshot")).toHaveText("exercise-operational-120");
    await expect(page.getByTestId("ground-observed")).toHaveText("02:00");

    await advance(11,12);
    await page.reload();
    await expect(page.getByTestId("ground-basis-snapshot")).toHaveText("exercise-operational-120");
    await advance(12,13);
    await page.reload();
    await expect(page.getByTestId("ground-basis-snapshot")).toHaveText("exercise-operational-210");
    await expect(page.getByTestId("ground-observed")).toHaveText("03:30");
    await expect(page.getByTestId("ground-basis-revision")).toHaveText("v4");
    await expect(page.locator("body")).not.toContainText(/Sana|Ivo|wrist-motion|wrist-recheck|Private wearable debrief/);
    const ground = await request.get(api+run+"/ground",{headers:auth("ground")});
    expect(await ground.text()).not.toMatch(/SIM-02|SIM-03|MOTION_ARTIFACT|evidence_ids/);
    expect((await request.get(api+run+"/crew/wearable-debrief",{headers:auth("ground")})).status()).toBe(403);

    await page.goto("/flight?view=replay&run_id="+started.run_id);
    await (await hudButton(page, "Workflows")).click();
    await expect(debrief).toContainText("Ground delivery lag · 45 s");
    await expect(debrief).toContainText("Ground operational update · T+04:15");
  } finally {
    stopBackend(backend);
    rmSync(directory,{recursive:true,force:true});
  }
});
