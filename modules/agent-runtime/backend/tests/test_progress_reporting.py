from types import SimpleNamespace

import pytest
from _router_auth_helpers import make_authed_test_app
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage

from deerflow.agents.middlewares import progress_reporting_middleware as progress_middleware
from deerflow.agents.middlewares.progress_reporting_middleware import ProgressReportingMiddleware
from deerflow.runtime.progress import public_progress_payload, sanitize_public_progress_payload
from deerflow.runtime.runs.manager import RunManager
from deerflow.runtime.runs.schemas import RunStatus


def test_public_progress_payload_filters_sensitive_fields():
    payload = sanitize_public_progress_payload({
        "type": "agent_progress_reported",
        "runId": "run_1",
        "threadId": "thread_1",
        "visibility": "stage",
        "summary": "Collecting evidence.",
        "prompt": "hidden",
        "reasoning": "hidden",
        "arguments": {"query": "hidden"},
        "token": "hidden",
    })

    assert payload == {
        "type": "agent_progress_reported",
        "runId": "run_1",
        "threadId": "thread_1",
        "visibility": "stage",
        "summary": "Collecting evidence.",
    }


@pytest.mark.asyncio
async def test_run_manager_intervention_lifecycle():
    manager = RunManager()
    record = await manager.create(thread_id="thread_1", assistant_id="lead_agent")
    await manager.set_status(record.run_id, RunStatus.running)

    intervention = await manager.request_intervention(
        record.run_id,
        thread_id="thread_1",
        text="Use IEEE style.",
        intervention_id="queued_1",
    )
    assert intervention is not None
    assert intervention.status == "requested"

    injected = await manager.take_requested_intervention(record.run_id)
    assert injected is not None
    assert injected.status == "injected"
    assert await manager.expire_requested_intervention(record.run_id) is None


def test_progress_middleware_keeps_tool_lifecycle_out_of_stage_progress(monkeypatch):
    emitted: list[dict[str, str]] = []
    monkeypatch.setattr(progress_middleware, "emit_public_progress", lambda payload: emitted.append(payload) or True)
    middleware = ProgressReportingMiddleware()
    runtime = SimpleNamespace(context={"run_id": "run_1", "thread_id": "thread_1"})
    request = SimpleNamespace(tool_call={"name": "web_search", "args": {"query": "secret"}}, runtime=runtime)

    result = middleware.wrap_tool_call(
        request,  # type: ignore[arg-type]
        lambda _request: ToolMessage(content="done", tool_call_id="call_1", name="web_search"),
    )

    assert isinstance(result, ToolMessage)
    assert not any(event.get("type") == "agent_progress_reported" and event.get("phase") == "tool" for event in emitted)
    assert any(event.get("type") == "agent_intervention_checkpoint" and event.get("visibility") == "raw" for event in emitted)
    assert all("args" not in event and "arguments" not in event and "query" not in str(event) for event in emitted)


def test_public_progress_payload_builds_checkpoint_event():
    payload = public_progress_payload(
        "agent_intervention_checkpoint",
        run_id="run_1",
        thread_id="thread_1",
        phase="intervention",
        status="waiting",
        summary="Safe point.",
    )

    assert payload["type"] == "agent_intervention_checkpoint"
    assert payload["event"] == "agent_intervention_checkpoint"
    assert payload["status"] == "waiting"
    assert payload["visibility"] == "stage"


@pytest.mark.asyncio
async def test_thread_run_intervention_endpoint_records_request():
    from app.gateway.routers import thread_runs

    manager = RunManager()
    record = await manager.create(thread_id="thread_1", assistant_id="lead_agent")
    await manager.set_status(record.run_id, RunStatus.running)
    app = make_authed_test_app()
    app.state.run_manager = manager
    app.include_router(thread_runs.router)

    with TestClient(app) as client:
        response = client.post(
            f"/api/threads/thread_1/runs/{record.run_id}/interventions",
            json={"text": "Use APA style.", "input_id": "queued_1"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "queued_1"
    assert body["status"] == "requested"
    injected = await manager.take_requested_intervention(record.run_id)
    assert injected is not None
    assert injected.text == "Use APA style."
