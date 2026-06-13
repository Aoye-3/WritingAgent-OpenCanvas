"""Force the Plan runtime to establish persisted Plan state before replying."""

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
