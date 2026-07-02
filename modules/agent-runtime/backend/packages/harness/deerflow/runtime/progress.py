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
    "loopId",
    "loopIndex",
    "stepKind",
    "actionId",
    "observationId",
    "completionStatus",
    "completionReasons",
    "missingRequirements",
    "phase",
    "status",
    "title",
    "summary",
    "next",
    "evidence",
    "interventionHint",
    "visibility",
    "source",
    "createdAt",
}

_BLOCKED_KEY_RE = ("prompt", "reasoning", "chain", "token", "secret", "password", "authorization", "context", "argument", "message")
_EVIDENCE_KINDS = {"tool", "subagent", "codegraph", "search", "file", "runtime"}


def public_progress_payload(
    event_type: Literal["agent_progress_reported", "agent_intervention_checkpoint"],
    *,
    run_id: str | None = None,
    thread_id: str | None = None,
    phase: str | None = None,
    stage_id: str | None = None,
    loop_id: str | None = None,
    loop_index: int | str | None = None,
    step_kind: str | None = None,
    action_id: str | None = None,
    observation_id: str | None = None,
    completion_status: str | None = None,
    completion_reasons: list[str] | None = None,
    missing_requirements: list[str] | None = None,
    status: ProgressStatus = "running",
    title: str | None = None,
    summary: str,
    next: str | None = None,
    evidence: list[dict[str, Any] | str] | None = None,
    intervention_hint: str | None = None,
    visibility: Literal["stage", "raw", "public"] = "stage",
    source: str | None = "agent_runtime",
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build a sanitized public custom event payload."""

    payload: dict[str, Any] = {
        "type": event_type,
        "event": event_type,
        "runId": run_id,
        "threadId": thread_id,
        "stageId": stage_id,
        "loopId": loop_id,
        "loopIndex": loop_index,
        "stepKind": step_kind,
        "actionId": action_id,
        "observationId": observation_id,
        "completionStatus": completion_status,
        "completionReasons": completion_reasons,
        "missingRequirements": missing_requirements,
        "phase": phase,
        "status": status,
        "title": title,
        "summary": summary,
        "next": next,
        "evidence": evidence,
        "interventionHint": intervention_hint,
        "visibility": visibility,
        "source": source,
        "createdAt": created_at or datetime.now(UTC).isoformat(),
    }
    return sanitize_public_progress_payload(payload)


def public_update_payload(
    *,
    run_id: str | None = None,
    thread_id: str | None = None,
    phase: str | None = None,
    status: ProgressStatus = "running",
    summary: str,
    next: str | None = None,
    evidence: list[dict[str, Any] | str] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build a sanitized public narration event payload."""

    if not _public_text(summary):
        raise ValueError("public update summary is required")
    return public_progress_payload(
        "agent_progress_reported",
        run_id=run_id,
        thread_id=thread_id,
        phase=phase,
        status=status,
        summary=summary,
        next=next,
        evidence=evidence,
        visibility="public",
        source="agent_public_update",
        created_at=created_at,
    )


def sanitize_public_progress_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep only public progress fields and string-like safe values."""

    sanitized: dict[str, Any] = {}
    for key, value in payload.items():
        if key not in _ALLOWED_KEYS:
            continue
        if any(blocked in key.lower() for blocked in _BLOCKED_KEY_RE):
            continue
        if value is None:
            continue
        if key == "loopIndex" and isinstance(value, int):
            sanitized[key] = value
            continue
        if key in {"completionReasons", "missingRequirements"} and isinstance(value, list):
            items = [str(item).strip()[:500] for item in value if _public_text(str(item).strip())]
            if items:
                sanitized[key] = items[:20]
            continue
        if key == "evidence":
            evidence = _public_evidence(value)
            if evidence:
                sanitized[key] = evidence
            continue
        text = _public_text(str(value).strip())
        if not text:
            continue
        sanitized[key] = text[:500]
    return sanitized


def _public_text(value: str) -> str:
    text = value.strip()
    return "" if text.lower() in {"undefined", "null", "none", "nan"} else text


def _public_evidence(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    evidence: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, str):
            label = _public_text(item)[:120]
            if label:
                evidence.append({"kind": "runtime", "label": label})
        elif isinstance(item, dict):
            kind = _public_text(str(item.get("kind", "runtime")).strip()).lower()
            label = _public_text(str(item.get("label", "")).strip())[:120]
            ref = _public_text(str(item.get("ref", "")).strip())[:160]
            if kind not in _EVIDENCE_KINDS or not label:
                continue
            record = {"kind": kind, "label": label}
            if ref:
                record["ref"] = ref
            evidence.append(record)
        if len(evidence) >= 5:
            break
    return evidence


def emit_public_progress(payload: dict[str, Any]) -> bool:
    """Emit a LangGraph custom stream event when a stream writer is available."""

    try:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
        writer(sanitize_public_progress_payload(payload))
        return True
    except Exception:
        return False
