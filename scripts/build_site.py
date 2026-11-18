"""Build the static pages for a hosted deployment into one output folder."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_flight_canvas import build as build_flight  # noqa: E402
from build_mission_canvas import build as build_mission  # noqa: E402


def main(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    build_mission(output / "mission.html")
    build_flight(output / "flight.html")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    main(parser.parse_args().output)
