"""Public progress reporting helpers for Agent Runtime streams."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

ProgressStatus = Literal["running", "completed", "failed", "waiting"]

_ALLOWED_KEYS = {
    "type",
    "event",
    "runId",
    "threadId",
    "stageId",
    "phase",
    "status",
    "title",
    "summary",
    "next",
    "interventionHint",
    "visibility",
    "source",
    "createdAt",
}

_BLOCKED_KEY_RE = ("prompt", "reasoning", "chain", "token", "secret", "password", "authorization", "context", "argument", "message")


def public_progress_payload(
    event_type: Literal["agent_progress_reported", "agent_intervention_checkpoint"],
    *,
    run_id: str | None = None,
    thread_id: str | None = None,
    phase: str | None = None,
    status: ProgressStatus = "running",
    title: str | None = None,
    summary: str,
    next: str | None = None,
    intervention_hint: str | None = None,
    visibility: Literal["stage", "raw"] = "stage",
    source: str | None = "agent_runtime",
    created_at: str | None = None,
) -> dict[str, str]:
    """Build a sanitized public custom event payload."""

    payload: dict[str, Any] = {
        "type": event_type,
        "event": event_type,
        "runId": run_id,
        "threadId": thread_id,
        "phase": phase,
        "status": status,
        "title": title,
        "summary": summary,
        "next": next,
        "interventionHint": intervention_hint,
        "visibility": visibility,
        "source": source,
        "createdAt": created_at or datetime.now(UTC).isoformat(),
    }
    return sanitize_public_progress_payload(payload)


def sanitize_public_progress_payload(payload: dict[str, Any]) -> dict[str, str]:
    """Keep only public progress fields and string-like safe values."""

    sanitized: dict[str, str] = {}
    for key, value in payload.items():
        if key not in _ALLOWED_KEYS:
            continue
        if any(blocked in key.lower() for blocked in _BLOCKED_KEY_RE):
            continue
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        sanitized[key] = text[:500]
    return sanitized


def emit_public_progress(payload: dict[str, Any]) -> bool:
    """Emit a LangGraph custom stream event when a stream writer is available."""

    try:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
        writer(sanitize_public_progress_payload(payload))
        return True
    except Exception:
        return False
