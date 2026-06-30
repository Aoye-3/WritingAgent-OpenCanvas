"""Public progress reporting middleware."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from deerflow.runtime.progress import emit_public_progress, public_progress_payload


class ProgressReportingMiddleware(AgentMiddleware[AgentState]):
    """Emit public custom stream events without exposing prompts or raw tool args."""

    def _context(self, runtime: Any | None) -> dict[str, Any]:
        context = getattr(runtime, "context", None)
        return context if isinstance(context, dict) else {}

    def _base(self, runtime: Any | None) -> dict[str, str | None]:
        context = self._context(runtime)
        return {
            "run_id": str(context.get("run_id")) if context.get("run_id") else None,
            "thread_id": str(context.get("thread_id")) if context.get("thread_id") else None,
        }

    def _emit(
        self,
        runtime: Any | None,
        *,
        phase: str,
        summary: str,
        status: str = "running",
        next: str | None = None,
        intervention_hint: str | None = None,
        visibility: str = "stage",
        source: str = "agent_runtime",
        event_type: str = "agent_progress_reported",
    ) -> None:
        base = self._base(runtime)
        payload = public_progress_payload(
            event_type,  # type: ignore[arg-type]
            run_id=base["run_id"],
            thread_id=base["thread_id"],
            phase=phase,
            status=status,  # type: ignore[arg-type]
            summary=summary,
            next=next,
            intervention_hint=intervention_hint,
            visibility=visibility,  # type: ignore[arg-type]
            source=source,
        )
        emit_public_progress(payload)

    def _safe_tool_name(self, request: ToolCallRequest) -> str:
        name = request.tool_call.get("name")
        return str(name or "tool").replace("_", " ")[:80]

    def _checkpoint(self, runtime: Any | None, *, summary: str, status: str = "waiting", next: str | None = None) -> None:
        self._emit(
            runtime,
            event_type="agent_intervention_checkpoint",
            phase="intervention",
            status=status,
            summary=summary,
            next=next,
            visibility="raw",
        )

    @override
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        self._checkpoint(runtime, summary="Agent reached a safe point before the next model step.")
        return None

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        self.before_model(state, runtime)
        intervention = await self._take_intervention(runtime)
        if not intervention:
            return None
        self._checkpoint(
            runtime,
            summary="User intervention was injected into the current run.",
            status="completed",
            next="Agent will adjust subsequent steps to the new constraint.",
        )
        self._emit(
            runtime,
            phase="intervention",
            status="completed",
            summary="User intervention was received and will guide the next step.",
            next="Continuing from the next safe model step.",
            intervention_hint="The current run has accepted the new instruction.",
            visibility="stage",
            event_type="agent_intervention_checkpoint",
        )
        return {"messages": [HumanMessage(name="user_intervention", content=intervention)]}

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return None

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        self.after_model(state, runtime)
        return None

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        try:
            result = handler(request)
        except Exception:
            self._emit(request.runtime, phase="recovery", status="failed", summary="A tool step failed; the agent is recovering with available context.", next="The raw log has the diagnostic detail.")
            raise
        self._checkpoint(request.runtime, summary="Agent reached a safe point after a tool result.")
        return result

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        try:
            result = await handler(request)
        except Exception:
            self._emit(request.runtime, phase="recovery", status="failed", summary="A tool step failed; the agent is recovering with available context.", next="The raw log has the diagnostic detail.")
            raise
        self._checkpoint(request.runtime, summary="Agent reached a safe point after a tool result.")
        return result

    async def _take_intervention(self, runtime: Runtime) -> str | None:
        context = self._context(runtime)
        run_manager = context.get("__facetwrite_run_manager")
        run_id = context.get("run_id")
        if not run_manager or not run_id:
            return None
        take = getattr(run_manager, "take_requested_intervention", None)
        if take is None:
            return None
        result = take(str(run_id))
        if inspect.isawaitable(result):
            result = await result
        if not result:
            return None
        text = getattr(result, "text", None)
        if not isinstance(text, str) or not text.strip():
            return None
        return (
            "<user_intervention>\n"
            "The user added this new constraint while the current run was in progress. "
            "Respect it for subsequent steps without denying already completed durable writes.\n\n"
            f"{text.strip()[:4000]}\n"
            "</user_intervention>"
        )
