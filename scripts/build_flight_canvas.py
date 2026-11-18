"""Build the player view from the room catalog and Python cabin replay."""

import argparse
import json
from pathlib import Path

if __package__:
    from .build_cabin_preview import ACTIVITY_S, ROOT
    from .flight_airlock_rehearsal import build_airlock_rehearsal
    from .flight_health_rehearsal import build_health_rehearsal
    from .iss_mission_replay import build_replays, crew_history
    from .launch_envelope import TICK_SECONDS, launch_envelope, propulsion_envelope, rendezvous_envelope
    from .flight_orbit import navigation_reference
else:
    from build_cabin_preview import ACTIVITY_S, ROOT
    from flight_airlock_rehearsal import build_airlock_rehearsal
    from flight_health_rehearsal import build_health_rehearsal
    from iss_mission_replay import build_replays, crew_history
    from launch_envelope import TICK_SECONDS, launch_envelope, propulsion_envelope, rendezvous_envelope
    from flight_orbit import navigation_reference


from symbiosis_x.crew.emergency import load_drills
from symbiosis_x.crew.profile import profile_for_crew
from symbiosis_x.simulation.spacecraft.provisions import flight_rules
from symbiosis_x.crew.submission_cabin import submission_cabin
from symbiosis_x.workflows.eva import build_eva_rehearsal


def build(output: Path) -> None:
    crew = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text(encoding="utf-8"))["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    rooms = json.loads((ROOT / "catalogs/sx01/rooms.json").read_text(encoding="utf-8"))["rooms"]
    missions = []
    for preset in ("launch-checkout-v1", "orbital-systems-checkout-v1"):
        mission = json.loads((ROOT / f"scenarios/variants/{preset}.json").read_text(encoding="utf-8"))
        mission["propulsion_budget"] = propulsion_envelope(mission)
        mission["ascent"] = launch_envelope(mission)
        mission["navigation"] = navigation_reference(mission["ascent"], mission["propulsion"]["rcs_pulses"])
        if "rendezvous" in mission:
            mission["rendezvous"] = rendezvous_envelope(mission)
        missions.append(mission)
    scenario, frames = build_replays(crew)
    ground = json.loads((ROOT / "contracts/examples/ground-v102.json").read_text(encoding="utf-8"))
    eva = json.loads((ROOT / "scenarios/variants/eva-antenna-service-v1.json").read_text(encoding="utf-8"))
    data = json.dumps({
        "provisions": flight_rules(),
        "health30_cabin": submission_cabin(),
        "health30_profiles": crew,
        "health30_sensors": json.loads((ROOT / "catalogs/sx01/sensors.json").read_text(encoding="utf-8"))["sensors"],
        "research_context": json.loads((ROOT / "catalogs/crew/spaceflight-research.json").read_text(encoding="utf-8")),
        "metrics": json.loads((ROOT / "catalogs/crew/health-metrics.json").read_text(encoding="utf-8"))["metrics"],
        "emergency_drills": list(load_drills().values()),
        "health_profiles": {crew_id: profile_for_crew(crew_id).model_dump(mode="json") for crew_id in crew_ids},
        "rooms": rooms, "crew": crew_ids, "activity_s": ACTIVITY_S, "missions": missions,
        "airlock": build_airlock_rehearsal(),
        "eva": build_eva_rehearsal(eva, TICK_SECONDS),
        "health_drill": build_health_rehearsal(ROOT / "scenarios/sx01-golden-v1.json"),
        "replay_ground": {
            "snapshot_id": ground["snapshot_id"], "decision_rev": ground["decision_rev"],
            "delivery": ground["delivery"], "co2": ground["equipment"]["co2"],
            "power_headroom": ground["equipment"]["power_headroom"],
        },
        "replay_version": scenario["version"],
        "frames": frames, "history": crew_history(frames[""], crew_ids), "research": scenario["research"],
    }, ensure_ascii=False).replace("<", "\\u003c")
    template = (ROOT / "docs/demo/flight.html").read_text(encoding="utf-8")
    workflow = (ROOT / "docs/demo/flight-workflow.js").read_text(encoding="utf-8")
    flight_ground = (ROOT / "docs/demo/flight-ground.js").read_text(encoding="utf-8")
    widgets = (ROOT / "docs/demo/flight-widgets.js").read_text(encoding="utf-8")
    stations = (ROOT / "docs/demo/flight-stations.js").read_text(encoding="utf-8")
    launch_scene = (ROOT / "docs/demo/launch-scene.js").read_text(encoding="utf-8")
    flight_sound = (ROOT / "docs/demo/flight-sound.js").read_text(encoding="utf-8")
    flight_camera = (ROOT / "docs/demo/flight-camera.js").read_text(encoding="utf-8")
    flight_camera_style = (ROOT / "docs/demo/flight-camera.css").read_text(encoding="utf-8")
    hud_menus = (ROOT / "docs/demo/flight-hud-menus.js").read_text(encoding="utf-8")
    missions_ui = (ROOT / "docs/demo/flight-missions.js").read_text(encoding="utf-8")
    checkout = (ROOT / "docs/demo/launch-checkout.js").read_text(encoding="utf-8")
    timed_demo = (ROOT / "docs/demo/flight-demo.js").read_text(encoding="utf-8")
    health_story = (ROOT / "docs/demo/flight-health-story.js").read_text(encoding="utf-8")
    health30 = (ROOT / "docs/demo/flight-health30.js").read_text(encoding="utf-8")
    health30_style = (ROOT / "docs/demo/flight-health30.css").read_text(encoding="utf-8")
    emergency_guidance = (ROOT / "frontend/src/features/crew/emergencyGuidance.js").read_text(encoding="utf-8")
    flight_emergency = (ROOT / "docs/demo/flight-emergency.js").read_text(encoding="utf-8")
    anatomy = (ROOT / "docs/demo/flight-anatomy.html").read_text(encoding="utf-8")
    crew_routines = (ROOT / "docs/demo/flight-crew.js").read_text(encoding="utf-8")
    galley = (ROOT / "docs/demo/flight-galley.js").read_text(encoding="utf-8")
    docking_scene = (ROOT / "docs/demo/docking-scene.js").read_text(encoding="utf-8")
    navigation = (ROOT / "docs/demo/flight-navigation.js").read_text(encoding="utf-8")
    processes = (ROOT / "docs/demo/flight-processes.js").read_text(encoding="utf-8")
    icons = (ROOT / "frontend/src/ui/icons/lucide/flight.svg").read_text(encoding="utf-8")
    output.write_text(
        template.replace("__FLIGHT_DATA__", data)
        .replace("__FLIGHT_WORKFLOW__", workflow).replace("__FLIGHT_GROUND__", flight_ground)
        .replace("__FLIGHT_WIDGETS__", widgets)
        .replace("__FLIGHT_STATIONS__", stations).replace("__LAUNCH_SCENE__", launch_scene)
        .replace("__FLIGHT_SOUND__", flight_sound)
        .replace("__FLIGHT_CAMERA__", flight_camera).replace("__FLIGHT_HUD_MENUS__", hud_menus)
        .replace("__FLIGHT_CAMERA_STYLE__", flight_camera_style)
        .replace("__FLIGHT_MISSIONS__", missions_ui)
        .replace("__FLIGHT_DEMO__", timed_demo).replace("__LAUNCH_CHECKOUT__", checkout).replace("__HUD_ICONS__", icons)
        .replace("__FLIGHT_HEALTH_STORY__", health_story).replace("__FLIGHT_HEALTH30__", health30)
        .replace("__HEALTH30_STYLE__", health30_style)
        .replace("__FLIGHT_EMERGENCY__", emergency_guidance.replace("export function ", "function ") + "\n" + flight_emergency)
        .replace("__FLIGHT_ANATOMY__", anatomy).replace("__FLIGHT_CREW__", crew_routines)
        .replace("__FLIGHT_GALLEY__", galley)
        .replace("__DOCKING_SCENE__", docking_scene).replace("__FLIGHT_NAVIGATION__", navigation)
        .replace("__FLIGHT_PROCESSES__", processes),
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
