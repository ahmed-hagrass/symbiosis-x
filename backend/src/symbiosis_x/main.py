"""FastAPI entry point for the local SYMBIOSIS X backend."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from os import environ
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from symbiosis_x.api.crew import router as crew_router
from symbiosis_x.api.ground import router as ground_router
from symbiosis_x.api.decisions import router as decisions_router
from symbiosis_x.api.health import router as health_router
from symbiosis_x.api.private_checkins import router as private_checkins_router
from symbiosis_x.api.roles import new_demo_tokens, router as roles_router
from symbiosis_x.api.runs import router as runs_router
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate

API_TITLE = "SYMBIOSIS X"
API_VERSION = "0.1.0"
# The editable install runs from the repository, where SX-18A froze the golden scenario.
DEFAULT_GOLDEN_MANIFEST = Path(__file__).resolve().parents[3] / "scenarios" / "sx01-golden-v1.json"


def create_app(
    *, database_path: str | Path | None = None, enable_local_demo: bool | None = None,
    golden_manifest_path: str | Path | None = None,
) -> FastAPI:
    """Build the application with an optional isolated SQLite file and golden manifest."""
    if database_path is None:
        database_path = environ.get("SYMBIOSIS_X_DB_PATH", "symbiosis-x.sqlite3")
    if golden_manifest_path is None:
        golden_manifest_path = environ.get("SYMBIOSIS_X_GOLDEN_MANIFEST", DEFAULT_GOLDEN_MANIFEST)

    path = Path(database_path)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        await run_in_threadpool(migrate, path)
        application.state.repository = Repository(path)
        yield

    application = FastAPI(title=API_TITLE, version=API_VERSION, lifespan=lifespan)
    application.state.database_path = path
    application.state.golden_manifest_path = Path(golden_manifest_path)
    canvas_path = environ.get("SYMBIOSIS_X_MISSION_CANVAS")
    # Opt-in public demo of synthetic data only (for example a Vercel preview).
    hosted_demo = environ.get("SYMBIOSIS_X_HOSTED_DEMO") == "1"
    if enable_local_demo is None:
        enable_local_demo = bool(canvas_path) or hosted_demo or environ.get("SYMBIOSIS_X_LOCAL_DEMO") == "1"
    application.state.hosted_demo = hosted_demo
    application.state.demo_tokens = (
        new_demo_tokens(environ.get("SYMBIOSIS_X_DEMO_SECRET") if hosted_demo else None)
        if enable_local_demo else {}
    )
    application.include_router(health_router)
    application.include_router(roles_router)
    application.include_router(runs_router)
    application.include_router(crew_router)
    application.include_router(private_checkins_router)
    application.include_router(ground_router)
    application.include_router(decisions_router)
    if canvas_path:
        path_to_canvas = Path(canvas_path)

        @application.get("/mission", include_in_schema=False)
        def mission_canvas() -> FileResponse:
            if not path_to_canvas.is_file():
                raise HTTPException(404, "MISSION_CANVAS_UNAVAILABLE")
            return FileResponse(path_to_canvas, media_type="text/html", headers={"Cache-Control": "no-store"})
        flight_path = path_to_canvas.with_name("flight.html")

        @application.get("/", include_in_schema=False)
        def flight_home() -> RedirectResponse:
            return RedirectResponse("/flight" if flight_path.is_file() else "/mission")

        @application.get("/flight", include_in_schema=False)
        def flight_canvas() -> FileResponse:
            if not flight_path.is_file():
                raise HTTPException(404, "FLIGHT_CANVAS_UNAVAILABLE")
            return FileResponse(flight_path, media_type="text/html", headers={"Cache-Control": "no-store"})
    return application


app = create_app()
