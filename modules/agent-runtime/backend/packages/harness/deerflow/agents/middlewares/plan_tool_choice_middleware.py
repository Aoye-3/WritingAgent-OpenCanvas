"""Force the Plan runtime to establish persisted Plan state before replying."""

from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import ToolMessage


class PlanToolChoiceMiddleware(AgentMiddleware[AgentState]):
    """Require the first planning model call to use ``plan_update``."""

    @staticmethod
    def _prepare(request: ModelRequest) -> ModelRequest:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        phase = context.get("facetwrite_plan_phase") if isinstance(context, dict) else None
        if phase != "planning":
            return request

        already_updated = any(
            isinstance(message, ToolMessage) and getattr(message, "name", None) == "plan_update"
            for message in request.messages
        )
        if already_updated:
            return request

        tool_names = {
            tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
            for tool in request.tools
        }
        if "plan_update" not in tool_names:
            return request
        return request.override(tool_choice="plan_update")

    @staticmethod
    def _phase(request: ModelRequest) -> str | None:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        return context.get("facetwrite_plan_phase") if isinstance(context, dict) else None

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

    def _should_force_artifact(self, request: ModelRequest, result: ModelCallResult) -> bool:
        return (
            self._phase(request) == "execution"
            and not self._has_tool_result(request, "artifact_stage")
            and self._has_tool(request, "artifact_stage")
            and not self._contains_tool_call(result)
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        result = handler(prepared)
        if self._should_force_artifact(prepared, result):
            return handler(prepared.override(tool_choice="artifact_stage"))
        return result

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        result = await handler(prepared)
        if self._should_force_artifact(prepared, result):
            return await handler(prepared.override(tool_choice="artifact_stage"))
        return result
