"""Force the Plan runtime to establish persisted Plan state before replying."""

import json
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import ToolMessage


class PlanToolChoiceMiddleware(AgentMiddleware[AgentState]):
    """Select one phase-scoped Plan contract without retrying failed submissions."""

    def __init__(self):
        self._forced_attempts: set[str] = set()

    def _prepare(self, request: ModelRequest) -> ModelRequest:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        phase = context.get("facetwrite_plan_phase") if isinstance(context, dict) else None
        canvas_action = context.get("facetwrite_canvas_action") if isinstance(context, dict) else None
        failure_reason = PlanToolChoiceMiddleware._plan_submission_failure_reason(request)
        if failure_reason:
            raise RuntimeError(f"Plan submission failed: {failure_reason}")
        request = PlanToolChoiceMiddleware._filter_tools(request, context)
        if phase == "chat" and isinstance(canvas_action, dict) and canvas_action.get("requiresTool") is True:
            if not PlanToolChoiceMiddleware._has_tool_result(request, "canvas_write") and PlanToolChoiceMiddleware._has_tool(request, "canvas_write"):
                return request.override(tool_choice="canvas_write")
        if phase != "planning":
            return request

        contract = PlanToolChoiceMiddleware._planning_contract(request)
        if contract is None or PlanToolChoiceMiddleware._has_tool_result(request, contract):
            return request
        attempt_id = context.get("facetwrite_plan_phase_attempt_id") if isinstance(context, dict) else None
        if isinstance(attempt_id, str) and attempt_id:
            if attempt_id in self._forced_attempts:
                return request
            self._forced_attempts.add(attempt_id)

        tool_names = {
            tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
            for tool in request.tools
        }
        if contract not in tool_names:
            return request
        return request.override(tool_choice=contract)

    @staticmethod
    def _filter_tools(request: ModelRequest, context: object) -> ModelRequest:
        if not isinstance(context, dict):
            return request
        allowed_refs = context.get("facetwrite_allowed_tool_refs")
        tool_state = context.get("facetwrite_tool_state")
        if not isinstance(allowed_refs, list):
            return request
        allowed = {value for value in allowed_refs if isinstance(value, str)}
        enabled = tool_state if isinstance(tool_state, dict) else {}
        phase = context.get("facetwrite_plan_phase")
        stage = context.get("facetwrite_plan_stage")
        if phase == "planning" and stage in (None, "intake"):
            allowed = {"plan_clarification_submit"}
        elif phase == "planning" and stage == "revise":
            allowed = {"plan_revision_submit"}
        filtered = [
            tool for tool in request.tools
            if PlanToolChoiceMiddleware._tool_name(tool) in allowed
            and enabled.get(PlanToolChoiceMiddleware._tool_name(tool), True) is not False
        ]
        return request.override(tools=filtered)

    @staticmethod
    def _tool_name(tool: object) -> str | None:
        return tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)

    @staticmethod
    def _plan_submission_failure_reason(request: ModelRequest) -> str | None:
        marker = "__FACETWRITE_EVENT__"
        for message in reversed(request.messages):
            if not isinstance(message, ToolMessage) or marker not in str(message.content):
                continue
            raw = str(message.content).split(marker, 1)[1].strip()
            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError:
                continue
            event = envelope.get("event") if isinstance(envelope, dict) else None
            if isinstance(event, dict) and event.get("eventType") == "plan_submission_failed":
                reason = event.get("reason")
                return reason if isinstance(reason, str) and reason else "unknown_plan_submission_failure"
        return None

    @staticmethod
    def _planning_contract(request: ModelRequest) -> str | None:
        stage = PlanToolChoiceMiddleware._stage(request)
        if stage in (None, "intake"):
            return "plan_clarification_submit"
        if stage == "revise":
            return "plan_revision_submit"
        return None

    @staticmethod
    def _phase(request: ModelRequest) -> str | None:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        return context.get("facetwrite_plan_phase") if isinstance(context, dict) else None

    @staticmethod
    def _stage(request: ModelRequest) -> str | None:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        return context.get("facetwrite_plan_stage") if isinstance(context, dict) else None

    @staticmethod
    def _has_tool_result(request: ModelRequest, name: str) -> bool:
        return any(
            isinstance(message, ToolMessage) and getattr(message, "name", None) == name
            for message in request.messages
        )

    @staticmethod
    def _has_tool(request: ModelRequest, name: str) -> bool:
        return any(
            (tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)) == name
            for tool in request.tools
        )

    @staticmethod
    def _contains_tool_call(result: ModelCallResult) -> bool:
        messages = getattr(result, "result", None)
        if not isinstance(messages, list):
            messages = [result]
        return any(bool(getattr(message, "tool_calls", None)) for message in messages)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        return handler(prepared)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        return await handler(prepared)
