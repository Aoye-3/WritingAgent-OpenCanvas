from types import SimpleNamespace

from deerflow.tools.facetwrite_bridge import (
    _INTERNAL_ENDPOINT,
    _build_payload,
    _bridge_headers,
    _format_bridge_response,
    _redact,
    PlanClarificationOption,
    artifact_stage_tool,
    plan_clarification_submit_tool,
)
from deerflow.config.app_config import FACETWRITE_REQUIRED_TOOLS


def test_build_payload_uses_facetwrite_runtime_context():
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread_1",
            "facetwrite_allowed_tool_refs": ["knowledge_base", "canvas_write"],
            "facetwrite_tool_state": {"knowledge_base": True, "canvas_write": True},
            "facetwrite_context_values": {"draft": "Bridge context"},
            "facetwrite_selected_canvas_node_id": "node_123",
            "facetwrite_chat_instruction": "Use the draft",
            "facetwrite_project_id": "project_1",
            "facetwrite_canvas_action": {"id": "action_1", "operation": "create", "requiresTool": True},
        },
        state={},
    )

    payload = _build_payload(runtime, "knowledge_base", {"query": "draft", "limit": 3})

    assert payload["threadId"] == "thread_1"
    assert payload["toolName"] == "knowledge_base"
    assert payload["arguments"] == {"query": "draft", "limit": 3}
    assert payload["allowedToolRefs"] == ["knowledge_base", "canvas_write"]
    assert payload["toolState"] == {"knowledge_base": True, "canvas_write": True}
    assert payload["contextValues"] == {"draft": "Bridge context"}
    assert payload["selectedCanvasNodeId"] == "node_123"
    assert payload["chatInstruction"] == "Use the draft"
    assert payload["projectId"] == "project_1"
    assert payload["canvasAction"]["id"] == "action_1"


def test_build_payload_defaults_to_requested_tool_policy_when_context_missing():
    runtime = SimpleNamespace(context={}, state={})

    payload = _build_payload(runtime, "quick_messages", {"instruction": "shorten"})

    assert payload["threadId"] == "thread_deerflow"
    assert "quick_messages" in payload["allowedToolRefs"]
    assert payload["toolState"] == {"quick_messages": True}


def test_build_payload_prefers_top_level_plan_identifiers():
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread_1",
            "facetwrite_context_values": {
                "planGeneration": {"planId": "stale_plan", "stepId": "stale_step"},
            },
            "facetwrite_plan_id": "plan_1",
            "facetwrite_plan_step_id": "step_1",
            "facetwrite_plan_phase_attempt_id": "attempt_1",
        },
        state={},
    )

    payload = _build_payload(runtime, "plan_clarification_submit", {"question": "Scope?"})

    assert payload["contextValues"]["planGeneration"] == {
        "planId": "plan_1",
        "stepId": "step_1",
        "phaseAttemptId": "attempt_1",
    }


def test_bridge_headers_do_not_expose_token_in_response_formatting(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "super-secret-token")

    headers = _bridge_headers()
    assert headers["x-facetwrite-internal"] == "agent-runtime"
    assert headers["x-facetwrite-tool-token"] == "super-secret-token"
    assert _redact("token=super-secret-token") == "token=[redacted]"


def test_bridge_headers_require_internal_token(monkeypatch):
    monkeypatch.delenv("FACETWRITE_INTERNAL_TOOL_TOKEN", raising=False)
    try:
        _bridge_headers()
        assert False, "missing token must fail"
    except RuntimeError as exc:
        assert "required" in str(exc)


def test_bridge_uses_agent_runtime_endpoint():
    assert _INTERNAL_ENDPOINT == "/api/internal/agent-runtime/tool-call"


def test_format_bridge_response_maps_ok_and_denied_results():
    assert _format_bridge_response({"ok": True, "content": "context", "payload": {"tool": "knowledge_base"}}) == "context"
    denied = _format_bridge_response({"ok": False, "content": "Denied", "payload": {"tool": "knowledge_base", "reason": "policy_denied"}})
    assert denied.startswith("Error: Denied\n__FACETWRITE_EVENT__")
    envelope = __import__("json").loads(denied.split("__FACETWRITE_EVENT__", 1)[1])
    assert envelope["event"]["eventType"] == "tool_failed"
    assert envelope["event"]["reason"] == "policy_denied"


def test_format_bridge_response_preserves_structured_plan_failure():
    result = _format_bridge_response({
        "ok": False,
        "content": "Exactly one recommendation is required.",
        "payload": {"tool": "plan_clarification_submit", "reason": "invalid_clarification", "planId": "plan_1"},
    })

    envelope = __import__("json").loads(result.split("__FACETWRITE_EVENT__", 1)[1])
    assert envelope["event"] == {
        "tool": "plan_clarification_submit",
        "eventType": "plan_submission_failed",
        "reason": "invalid_clarification",
        "planId": "plan_1",
        "summary": "Exactly one recommendation is required.",
    }


def test_format_bridge_response_preserves_structured_plan_event():
    result = _format_bridge_response({
        "ok": True,
        "content": "Plan is ready.",
        "payload": {"tool": "plan_update", "eventType": "plan_created", "planId": "plan_1"},
    })

    assert result.startswith("Plan is ready.\n__FACETWRITE_EVENT__")
    envelope = __import__("json").loads(result.split("__FACETWRITE_EVENT__", 1)[1])
    assert envelope["content"] == "Plan is ready."
    assert envelope["event"]["eventType"] == "plan_created"


def test_format_bridge_response_never_reads_environment_token(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "token-value")

    response = _format_bridge_response({"ok": False, "payload": {"content": "No token here"}})

    assert "token-value" not in response


def test_redact_masks_common_secret_shapes(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "bridge-token")

    redacted = _redact("authorization=Bearer bridge-token")

    assert "bridge-token" not in redacted
    assert redacted.startswith("authorization=[redacted]")


def test_artifact_stage_tool_forwards_artifact_and_links(monkeypatch):
    observed = {}
    monkeypatch.setattr(
        "deerflow.tools.facetwrite_bridge._call_facetwrite_tool",
        lambda runtime, name, arguments: observed.update(name=name, arguments=arguments) or "ok",
    )

    result = artifact_stage_tool.func(
        SimpleNamespace(context={}, state={}),
        planId="plan_1",
        artifacts=[{"artifactId": "summary", "stepId": "write", "type": "text", "title": "Summary", "payload": {"content": "Done"}}],
        links=[{"id": "link_1", "fromArtifactId": "source", "toArtifactId": "summary", "label": "supports"}],
    )

    assert result == "ok"
    assert observed["name"] == "artifact_stage"
    assert observed["arguments"]["artifacts"][0]["artifactId"] == "summary"
    assert observed["arguments"]["links"][0]["id"] == "link_1"


def test_plan_clarification_schema_requires_structured_options():
    schema = plan_clarification_submit_tool.tool_call_schema.model_json_schema()
    options = schema["properties"]["options"]
    option_ref = options["items"]["$ref"].split("/")[-1]
    option_schema = schema["$defs"][option_ref]

    assert options["minItems"] == 2
    assert options["maxItems"] == 3
    assert set(option_schema["required"]) == {"id", "label", "description", "recommended"}


def test_plan_clarification_tool_forwards_valid_structured_options(monkeypatch):
    observed = {}
    monkeypatch.setattr(
        "deerflow.tools.facetwrite_bridge._call_facetwrite_tool",
        lambda runtime, name, arguments: observed.update(name=name, arguments=arguments) or "ok",
    )

    result = plan_clarification_submit_tool.func(
        SimpleNamespace(context={}, state={}),
        title="Laptop comparison",
        goal="Choose the comparison scope",
        question="Which generations should be compared?",
        options=[
            PlanClarificationOption(id="latest", label="Latest", description="Compare current models", recommended=True),
            PlanClarificationOption(id="value", label="Value", description="Compare lower-cost models", recommended=False),
        ],
    )

    assert result == "ok"
    assert observed["name"] == "plan_clarification_submit"
    assert observed["arguments"]["options"][0]["recommended"] is True


def test_required_plan_tools_are_available_for_existing_runtime_configs():
    assert {tool["name"] for tool in FACETWRITE_REQUIRED_TOOLS} == {
        "knowledge_base", "quick_messages", "clear_context", "canvas_write",
        "plan_clarification_submit", "plan_revision_submit", "artifact_stage",
    }
