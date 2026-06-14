import json
import os
import re
from typing import Annotated, Any

import httpx
from langchain.tools import tool
from pydantic import BaseModel, Field

from deerflow.tools.types import Runtime

_DEFAULT_BASE_URL = "http://host.docker.internal:8787"
_INTERNAL_ENDPOINT = "/api/internal/agent-runtime/tool-call"
_BRIDGED_TOOL_NAMES = ("knowledge_base", "clear_context", "plan_clarification_submit", "plan_revision_submit", "artifact_stage", "canvas_write")
_SECRET_PATTERN = re.compile(r"(?i)(api[_-]?key|authorization|token|password|secret)=?[^\s,;]+")


class PlanClarificationOption(BaseModel):
    id: str
    label: str
    description: str
    recommended: bool


def _bridge_base_url() -> str:
    return os.getenv("FACETWRITE_INTERNAL_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


def _bridge_headers() -> dict[str, str]:
    token = os.getenv("FACETWRITE_INTERNAL_TOOL_TOKEN")
    if not token:
        raise RuntimeError("FACETWRITE_INTERNAL_TOOL_TOKEN is required")
    headers = {
        "content-type": "application/json",
        "x-facetwrite-internal": "agent-runtime",
        "x-facetwrite-tool-token": token,
    }
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
    context_values = _context_record(context, "facetwrite_context_values")
    nested_plan_generation = _context_record(context_values, "planGeneration")
    plan_id = context.get("facetwrite_plan_id") or nested_plan_generation.get("planId")
    step_id = context.get("facetwrite_plan_step_id") or nested_plan_generation.get("stepId")
    phase_attempt_id = context.get("facetwrite_plan_phase_attempt_id") or nested_plan_generation.get("phaseAttemptId")
    if plan_id:
        context_values = {
            **context_values,
            "planGeneration": {
                **nested_plan_generation,
                "planId": plan_id,
                **({"stepId": step_id} if step_id else {}),
                **({"phaseAttemptId": phase_attempt_id} if phase_attempt_id else {}),
            },
        }
    return {
        "threadId": _thread_id_from_runtime(runtime),
        "toolName": tool_name,
        "arguments": arguments,
        "allowedToolRefs": _context_string_list(context, "facetwrite_allowed_tool_refs") or list(_BRIDGED_TOOL_NAMES),
        "toolState": tool_state,
        "selectedCanvasNodeId": context.get("facetwrite_selected_canvas_node_id"),
        "contextValues": context_values,
        "chatInstruction": context.get("facetwrite_chat_instruction") or context.get("facetwrite_prompt"),
        "projectId": context.get("facetwrite_project_id"),
        "canvasAction": _context_record(context, "facetwrite_canvas_action"),
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
    content = data.get("content")
    payload = data.get("payload")
    if ok is True and isinstance(payload, dict) and isinstance(payload.get("eventType"), str):
        visible_content = content if isinstance(content, str) else ""
        return visible_content + "\n__FACETWRITE_EVENT__" + json.dumps({
            "content": visible_content,
            "event": payload,
        }, ensure_ascii=False)
    if ok is True:
        if isinstance(content, str):
            return content
        if isinstance(payload, dict):
            legacy_content = payload.get("content")
            if isinstance(legacy_content, str):
                return legacy_content
            return json.dumps(payload, ensure_ascii=False)
    if ok is False:
        visible_content = content if isinstance(content, str) else "FacetWrite bridge rejected the tool call."
        safe_content = _redact(visible_content)
        failure_payload = payload if isinstance(payload, dict) else {}
        tool_name = failure_payload.get("tool")
        event_type = "plan_submission_failed" if tool_name in ("plan_clarification_submit", "plan_revision_submit") else "tool_failed"
        event = {
            "tool": tool_name,
            "eventType": event_type,
            "reason": failure_payload.get("reason") or "bridge_rejected",
            "planId": failure_payload.get("planId"),
            "summary": safe_content,
        }
        return f"Error: {safe_content}\n__FACETWRITE_EVENT__" + json.dumps({
            "content": safe_content,
            "event": {key: value for key, value in event.items() if value is not None},
        }, ensure_ascii=False)
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


@tool("clear_context", parse_docstring=True)
def clear_context_tool(runtime: Runtime, reason: str) -> str:
    """Confirm that previous FacetWrite conversation context should be ignored.

    Args:
        reason: Why previous context should be ignored.
    """

    return _call_facetwrite_tool(runtime, "clear_context", {"reason": reason})


@tool("plan_clarification_submit", parse_docstring=True)
def plan_clarification_submit_tool(
    runtime: Runtime,
    title: str,
    goal: str,
    question: str,
    options: Annotated[list[PlanClarificationOption], Field(min_length=2, max_length=3)],
) -> str:
    """Submit the one structured clarification required for a new Plan.

    Args:
        title: Short intake Plan title.
        goal: User-facing goal inferred from the request.
        question: One critical clarification question.
        options: Two or three mutually exclusive answer options.
    """
    return _call_facetwrite_tool(runtime, "plan_clarification_submit", {
        "title": title, "goal": goal, "question": question,
        "options": [option.model_dump() for option in options],
    })


@tool("plan_revision_submit", parse_docstring=True)
def plan_revision_submit_tool(
    runtime: Runtime,
    planId: str,
    title: str,
    goal: str,
    steps: list[dict[str, Any]],
) -> str:
    """Submit an approval-ready revision for an existing intake Plan.

    Args:
        planId: Existing intake Plan id.
        title: Approval-ready Plan title.
        goal: Confirmed Plan goal.
        steps: Ordered executable and verifiable Plan steps.
    """
    return _call_facetwrite_tool(runtime, "plan_revision_submit", {
        "planId": planId, "title": title, "goal": goal, "steps": steps,
    })


@tool("artifact_stage", parse_docstring=True)
def artifact_stage_tool(
    runtime: Runtime,
    planId: str,
    artifacts: list[dict[str, Any]],
    links: list[dict[str, Any]] | None = None,
) -> str:
    """Stage durable text and image outputs for an approved FacetWrite plan.

    Args:
        planId: Approved plan id.
        artifacts: Text or image artifacts with stable artifactId values. For text artifacts, prefer payload.sections or payload.items with stable ids, titles, and concise content.
        links: Optional directed links between artifact ids.
    """

    return _call_facetwrite_tool(runtime, "artifact_stage", {"planId": planId, "artifacts": artifacts, "links": links or []})


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
    """Write through FacetWrite's operation-level Canvas safety policy.

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
