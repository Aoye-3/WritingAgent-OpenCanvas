import json
import os
import re
from typing import Any

import httpx
from langchain.tools import tool

from deerflow.tools.types import Runtime

_DEFAULT_BASE_URL = "http://host.docker.internal:8787"
_INTERNAL_ENDPOINT = "/api/internal/deerflow/tool-call"
_BRIDGED_TOOL_NAMES = ("knowledge_base", "quick_messages", "clear_context", "canvas_write")
_SECRET_PATTERN = re.compile(r"(?i)(api[_-]?key|authorization|token|password|secret)=?[^\s,;]+")


def _bridge_base_url() -> str:
    return os.getenv("FACETWRITE_INTERNAL_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


def _bridge_headers() -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "x-facetwrite-internal": "deerflow",
    }
    token = os.getenv("FACETWRITE_INTERNAL_TOOL_TOKEN")
    if token:
        headers["x-facetwrite-tool-token"] = token
    return headers


def _runtime_context(runtime: Runtime) -> dict[str, Any]:
    context = getattr(runtime, "context", None)
    if isinstance(context, dict):
        return context
    return {}


def _runtime_state(runtime: Runtime) -> dict[str, Any]:
    state = getattr(runtime, "state", None)
    if isinstance(state, dict):
        return state
    return {}


def _runtime_configurable(runtime: Runtime) -> dict[str, Any]:
    config = getattr(runtime, "config", None)
    if isinstance(config, dict):
        configurable = config.get("configurable")
        if isinstance(configurable, dict):
            return configurable
    return {}


def _thread_id_from_runtime(runtime: Runtime) -> str:
    context = _runtime_context(runtime)
    configurable = _runtime_configurable(runtime)
    state = _runtime_state(runtime)
    for value in (
        context.get("thread_id"),
        configurable.get("thread_id"),
        state.get("thread_id"),
    ):
        if isinstance(value, str) and value.strip():
            return value

    thread_data = state.get("thread_data")
    if isinstance(thread_data, dict):
        workspace_path = thread_data.get("workspace_path")
        if isinstance(workspace_path, str) and workspace_path.strip():
            normalized = workspace_path.replace("\\", "/").rstrip("/")
            parts = normalized.split("/")
            if len(parts) >= 3:
                return parts[-3]

    return "thread_deerflow"


def _context_record(context: dict[str, Any], key: str) -> dict[str, Any]:
    value = context.get(key)
    return value if isinstance(value, dict) else {}


def _context_string_list(context: dict[str, Any], key: str) -> list[str] | None:
    value = context.get(key)
    if isinstance(value, list):
        items = [item for item in value if isinstance(item, str) and item]
        return items or None
    return None


def _build_payload(runtime: Runtime, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    context = _runtime_context(runtime)
    tool_state = _context_record(context, "facetwrite_tool_state")
    if not tool_state:
        tool_state = {tool_name: True}
    return {
        "threadId": _thread_id_from_runtime(runtime),
        "toolName": tool_name,
        "arguments": arguments,
        "allowedToolRefs": _context_string_list(context, "facetwrite_allowed_tool_refs") or list(_BRIDGED_TOOL_NAMES),
        "toolState": tool_state,
        "selectedCanvasNodeId": context.get("facetwrite_selected_canvas_node_id"),
        "contextValues": _context_record(context, "facetwrite_context_values"),
        "chatInstruction": context.get("facetwrite_chat_instruction") or context.get("facetwrite_prompt"),
    }


def _redact(value: str) -> str:
    redacted = _SECRET_PATTERN.sub(r"\1=[redacted]", value)
    token = os.getenv("FACETWRITE_INTERNAL_TOOL_TOKEN")
    if token:
        redacted = redacted.replace(token, "[redacted]")
    return redacted


def _format_bridge_response(data: Any) -> str:
    if not isinstance(data, dict):
        return "Error: FacetWrite bridge returned an invalid response."
    ok = data.get("ok")
    payload = data.get("payload")
    if ok is True and isinstance(payload, dict):
        content = payload.get("content")
        if isinstance(content, str):
            return content
        return json.dumps(payload, ensure_ascii=False)
    if ok is False and isinstance(payload, dict):
        content = payload.get("content")
        if isinstance(content, str):
            return f"Error: {content}"
        return f"Error: {json.dumps(payload, ensure_ascii=False)}"
    return "Error: FacetWrite bridge returned an unexpected result."


def _call_facetwrite_tool(runtime: Runtime, tool_name: str, arguments: dict[str, Any]) -> str:
    url = f"{_bridge_base_url()}{_INTERNAL_ENDPOINT}"
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(url, json=_build_payload(runtime, tool_name, arguments), headers=_bridge_headers())
        response.raise_for_status()
        return _format_bridge_response(response.json())
    except httpx.HTTPStatusError as exc:
        return f"Error: FacetWrite bridge returned HTTP {exc.response.status_code}."
    except Exception as exc:
        return f"Error: FacetWrite bridge call failed: {_redact(str(exc))}"


@tool("knowledge_base", parse_docstring=True)
def knowledge_base_tool(runtime: Runtime, query: str, limit: int = 6) -> str:
    """Read FacetWrite local context and knowledge hints for the current run.

    Args:
        query: What to retrieve from local context.
        limit: Maximum number of context entries to return.
    """

    return _call_facetwrite_tool(runtime, "knowledge_base", {"query": query, "limit": limit})


@tool("quick_messages", parse_docstring=True)
def quick_messages_tool(runtime: Runtime, instruction: str) -> str:
    """Normalize a quick editing instruction for the current FacetWrite draft.

    Args:
        instruction: The quick edit instruction.
    """

    return _call_facetwrite_tool(runtime, "quick_messages", {"instruction": instruction})


@tool("clear_context", parse_docstring=True)
def clear_context_tool(runtime: Runtime, reason: str) -> str:
    """Confirm that previous FacetWrite conversation context should be ignored.

    Args:
        reason: Why previous context should be ignored.
    """

    return _call_facetwrite_tool(runtime, "clear_context", {"reason": reason})


@tool("canvas_write", parse_docstring=True)
def canvas_write_tool(
    runtime: Runtime,
    operation: str,
    content: str,
    nodeKind: str = "document",
    targetNodeId: str | None = None,
    title: str | None = None,
    rationale: str | None = None,
) -> str:
    """Create a pending FacetWrite Canvas write request; it does not apply changes.

    Args:
        operation: The requested Canvas write operation: create, replace, or append.
        content: The exact Markdown or plain text content to write.
        nodeKind: Node type for created content or fallback target type.
        targetNodeId: Existing Canvas node id for replace or append.
        title: Short title for the node or write request.
        rationale: Brief explanation of why this write is useful.
    """

    return _call_facetwrite_tool(
        runtime,
        "canvas_write",
        {
            "operation": operation,
            "content": content,
            "nodeKind": nodeKind,
            "targetNodeId": targetNodeId,
            "title": title,
            "rationale": rationale,
        },
    )
