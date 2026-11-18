"""Opt-in hosted demo: public synthetic viewpoints, same-host browser calls only."""

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app


def _client(monkeypatch, tmp_path, *, hosted, secret=None):
    monkeypatch.delenv("SYMBIOSIS_X_MISSION_CANVAS", raising=False)
    monkeypatch.delenv("SYMBIOSIS_X_LOCAL_DEMO", raising=False)
    if hosted:
        monkeypatch.setenv("SYMBIOSIS_X_HOSTED_DEMO", "1")
    else:
        monkeypatch.delenv("SYMBIOSIS_X_HOSTED_DEMO", raising=False)
    if secret:
        monkeypatch.setenv("SYMBIOSIS_X_DEMO_SECRET", secret)
    else:
        monkeypatch.delenv("SYMBIOSIS_X_DEMO_SECRET", raising=False)
    app = create_app(database_path=tmp_path / "hosted.sqlite3")
    return TestClient(app, base_url="https://sx-demo.example")


def test_remote_visitor_is_refused_without_hosted_mode(monkeypatch, tmp_path):
    with _client(monkeypatch, tmp_path, hosted=False) as client:
        assert client.post("/api/v1/demo/session").status_code in {403, 404}


def test_hosted_mode_issues_viewpoints_and_runs_a_mission(monkeypatch, tmp_path):
    with _client(monkeypatch, tmp_path, hosted=True) as client:
        tokens = client.post("/api/v1/demo/session").json()
        assert set(tokens) == {"facilitator", "crew", "ground"}
        started = client.post("/api/v1/runs", json={"start_id": "start-01", "scenario_id": "nominal", "scenario_version": "1", "seed": 4242},
                              headers={"Authorization": "Bearer " + tokens["facilitator"]})
        assert started.status_code in {200, 201}, started.text


def test_hosted_tokens_are_stable_across_instances_with_a_secret(monkeypatch, tmp_path):
    with _client(monkeypatch, tmp_path, hosted=True, secret="s3cret") as first:
        a = first.post("/api/v1/demo/session").json()
    with _client(monkeypatch, tmp_path, hosted=True, secret="s3cret") as second:
        b = second.post("/api/v1/demo/session").json()
    assert a == b
    assert len(set(a.values())) == 3


def test_hosted_mode_refuses_cross_site_browser_calls(monkeypatch, tmp_path):
    with _client(monkeypatch, tmp_path, hosted=True) as client:
        same = client.post("/api/v1/demo/session", headers={"Origin": "https://sx-demo.example"})
        other = client.post("/api/v1/demo/session", headers={"Origin": "https://evil.example"})
    assert same.status_code == 200
    assert other.status_code == 403
