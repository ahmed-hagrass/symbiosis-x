import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {expect, test} from "@playwright/test";
import {startBackend, stopBackend, useBackend} from "./support/backend.js";
import { hudButton } from "./support/hud.js";

test("Flight opens and acknowledges both local drills with sourced guidance", async ({page, request}) => {
  const directory = mkdtempSync(join(tmpdir(),"flight-emergency-"));
  const backend = await startBackend("flight-emergency");
  try {
    const output = join(directory,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)), stdio:"inherit",
    });
    const flight = readFileSync(output,"utf8");
    const tokens = await (await request.post(backend.origin + "/api/v1/demo/session")).json();
    const response = await request.post(backend.origin + "/api/v1/runs",{
      headers:{Authorization:"Bearer " + tokens.facilitator},
      data:{start_id:"flight-emergency",scenario_id:"nominal",scenario_version:"1",seed:42},
    });
    expect(response.ok()).toBeTruthy();
    const {run_id:runId} = await response.json();
    await useBackend(page,backend.origin);
    await page.route(url => url.pathname === "/flight",route => route.fulfill({contentType:"text/html",body:flight}));
    await page.goto("/flight?view=replay&run_id=" + runId);
    await (await hudButton(page, "Emergency Assist")).click();
    const panel = page.getByRole("dialog",{name:"Emergency Assist"});
    const steps = panel.getByRole("list",{name:"Onboard training steps"});
    await panel.getByLabel("Is the crew member responsive?").selectOption("yes");
    await panel.getByLabel("Are they breathing normally?").selectOption("yes");
    await panel.getByLabel("Is the chest pain still present?").selectOption("yes");
    await expect(steps).toContainText("rest comfortably");
    await expect(panel.getByRole("link",{name:/Heart Attack/})).toHaveAttribute("href",/redcross\.org/);
    await panel.getByRole("button",{name:"Raise local drill alert"}).click();
    await expect(panel.getByRole("status")).toContainText("T+00:00 · Responder Sana Kepler");
    await panel.getByRole("button",{name:"Acknowledge local response"}).click();
    await expect(panel.getByRole("status")).toContainText("Acknowledged T+00:00");

    await panel.getByLabel("Choose scripted drill").selectOption("drill-collapse-v1");
    await panel.getByLabel("Is the crew member responsive?").selectOption("no");
    await panel.getByLabel("Are they breathing normally?").selectOption("yes");
    await expect(steps).toContainText("recovery position");
    await panel.getByLabel("Are they breathing normally?").selectOption("no");
    await expect(steps).toContainText("begin CPR");
    await panel.getByRole("button",{name:"Raise local drill alert"}).click();
    await expect(panel.getByRole("status")).toContainText("Responder Noor Okafor");
    await panel.getByRole("button",{name:"Acknowledge local response"}).click();
    await expect(panel.getByRole("status")).toContainText("Acknowledged T+00:00");
    const ground = await request.get(backend.origin + "/api/v1/runs/" + runId + "/ground", {
      headers:{Authorization:"Bearer " + tokens.ground},
    });
    expect((await ground.json()).health_cases).toEqual([]);
  } finally {
    stopBackend(backend);
    rmSync(directory,{recursive:true,force:true});
  }
});
