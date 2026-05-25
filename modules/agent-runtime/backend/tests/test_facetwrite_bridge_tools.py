from types import SimpleNamespace

from deerflow.tools.facetwrite_bridge import (
    _INTERNAL_ENDPOINT,
    _build_payload,
    _bridge_headers,
    _format_bridge_response,
    _redact,
)


def test_build_payload_uses_facetwrite_runtime_context():
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread_1",
            "facetwrite_allowed_tool_refs": ["knowledge_base", "canvas_write"],
            "facetwrite_tool_state": {"knowledge_base": True, "canvas_write": True},
            "facetwrite_context_values": {"draft": "Bridge context"},
            "facetwrite_selected_canvas_node_id": "node_123",
            "facetwrite_chat_instruction": "Use the draft",
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


def test_build_payload_defaults_to_requested_tool_policy_when_context_missing():
    runtime = SimpleNamespace(context={}, state={})

    payload = _build_payload(runtime, "quick_messages", {"instruction": "shorten"})

    assert payload["threadId"] == "thread_deerflow"
    assert "quick_messages" in payload["allowedToolRefs"]
    assert payload["toolState"] == {"quick_messages": True}


def test_bridge_headers_do_not_expose_token_in_response_formatting(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "super-secret-token")

    headers = _bridge_headers()
    assert headers["x-facetwrite-internal"] == "agent-runtime"
    assert headers["x-facetwrite-tool-token"] == "super-secret-token"
    assert _redact("token=super-secret-token") == "token=[redacted]"


def test_bridge_uses_agent_runtime_endpoint():
    assert _INTERNAL_ENDPOINT == "/api/internal/agent-runtime/tool-call"


def test_format_bridge_response_maps_ok_and_denied_results():
    assert _format_bridge_response({"ok": True, "content": "context", "payload": {"tool": "knowledge_base"}}) == "context"
    assert _format_bridge_response({"ok": False, "content": "Denied", "payload": {"reason": "policy_denied"}}) == "Error: Denied"


def test_format_bridge_response_never_reads_environment_token(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "token-value")

    response = _format_bridge_response({"ok": False, "payload": {"content": "No token here"}})

    assert "token-value" not in response


def test_redact_masks_common_secret_shapes(monkeypatch):
    monkeypatch.setenv("FACETWRITE_INTERNAL_TOOL_TOKEN", "bridge-token")

    redacted = _redact("authorization=Bearer bridge-token")

    assert "bridge-token" not in redacted
    assert redacted.startswith("authorization=[redacted]")
