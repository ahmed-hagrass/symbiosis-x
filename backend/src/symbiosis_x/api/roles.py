"""Server-issued credentials for the loopback mission pilot."""

from hashlib import sha256
from hmac import new as hmac_new
from ipaddress import ip_address
from secrets import compare_digest, token_urlsafe
from urllib.parse import urlsplit
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

Role = Literal["facilitator", "crew", "ground"]

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])
bearer = HTTPBearer(auto_error=False)


def new_demo_tokens(secret: str | None = None) -> dict[Role, str]:
    """Random tokens per process, or stable tokens derived from a hosted-demo secret.

    A hosted demo may run several server instances; a shared secret keeps the
    tokens one instance issues valid on the others.
    """
    roles: tuple[Role, ...] = ("facilitator", "crew", "ground")
    if not secret:
        return {role: token_urlsafe(32) for role in roles}
    return {role: hmac_new(secret.encode(), role.encode(), sha256).hexdigest() for role in roles}


def require_loopback(request: Request) -> None:
    if getattr(request.app.state, "hosted_demo", False):
        # Public synthetic demo: any visitor may switch viewpoints, but a
        # browser may only call it from the page that the same host served.
        origin = request.headers.get("origin")
        if origin is not None and urlsplit(origin).netloc != request.headers.get("host"):
            raise HTTPException(403, "ORIGIN_NOT_ALLOWED")
        return
    host = request.url.hostname
    origin = request.headers.get("origin")
    try:
        local_peer = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        local_peer = False
    if not local_peer or host not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "LOCAL_DEMO_REQUIRED")
    if origin is not None and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "ORIGIN_NOT_ALLOWED")


def require_role(role: Role):
    def authorize(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> None:
        require_loopback(request)
        tokens = request.app.state.demo_tokens
        if credentials is None or not credentials.credentials.isascii():
            raise HTTPException(401, "DEMO_TOKEN_REQUIRED", headers={"WWW-Authenticate": "Bearer"})
        for token_role, secret in tokens.items():
            if compare_digest(credentials.credentials, secret):
                if token_role == role:
                    return
                raise HTTPException(403, "ROLE_FORBIDDEN")
        raise HTTPException(401, "INVALID_DEMO_TOKEN", headers={"WWW-Authenticate": "Bearer"})

    return authorize


@router.post("/session", dependencies=[Depends(require_loopback)])
def issue_demo_session(request: Request, response: Response) -> dict[Role, str]:
    """Give the local operator credentials for switching between demo viewpoints."""
    tokens = request.app.state.demo_tokens
    if not tokens:
        raise HTTPException(404, "LOCAL_DEMO_DISABLED")
    response.headers["Cache-Control"] = "no-store"
    return tokens
