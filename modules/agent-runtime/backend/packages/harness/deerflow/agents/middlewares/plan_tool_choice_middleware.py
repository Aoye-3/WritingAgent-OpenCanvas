"""Force the Plan runtime to establish persisted Plan state before replying."""

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage


_INTERNAL_RUNTIME_PROTOCOL_PATTERNS = (
    re.compile(r"<\s*(?:[\/|]\s*){0,4}DSML\s*(?:[\/|]\s*){0,4}", re.IGNORECASE),
    re.compile(r"\bDSML\b[\s\S]{0,120}\btool[_-]?calls?\b", re.IGNORECASE),
    re.compile(r"\btool[_-]?calls?\b[\s\S]{0,120}\bDSML\b", re.IGNORECASE),
    re.compile(r"\bDSML\b[\s\S]{0,160}\binvoke\s+name\s*=\s*[\"']?(?:readfile|read_file|webfetch|web_fetch|websearch|web_search|bash|grep|glob|ls)\b", re.IGNORECASE),
    re.compile(r"\binvoke\s+name\s*=\s*[\"']?(?:readfile|read_file|webfetch|web_fetch|websearch|web_search|bash|grep|glob|ls)\b[\s\S]{0,160}\bDSML\b", re.IGNORECASE),
    re.compile(r"\bDSML\b[\s\S]{0,160}\bparameter\s+name\s*=\s*[\"']?(?:url|filepath|file_path|path|maxcontentlength|max_content_length|query)\b", re.IGNORECASE),
)


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
        request = PlanToolChoiceMiddleware._apply_runtime_budget(request, context)
        if PlanToolChoiceMiddleware._is_skill_scope_guard(context):
            if not PlanToolChoiceMiddleware._has_tool_result(request, "ask_clarification") and PlanToolChoiceMiddleware._has_tool(request, "ask_clarification"):
                return request.override(tool_choice="ask_clarification")
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
        research_limit = context.get("facetwrite_research_tool_limit")
        if isinstance(research_limit, int) and research_limit > 0:
            completed_research_tools = sum(
                1
                for message in request.messages
                if isinstance(message, ToolMessage) and getattr(message, "name", None) in ("web_search", "web_fetch")
            )
            if completed_research_tools >= research_limit:
                allowed.discard("web_search")
                allowed.discard("web_fetch")
        evidence_limit = context.get("facetwrite_evidence_tool_limit")
        evidence_tools = context.get("facetwrite_evidence_tools")
        if isinstance(evidence_limit, int) and evidence_limit > 0 and isinstance(evidence_tools, list):
            evidence_tool_names = {value for value in evidence_tools if isinstance(value, str)}
            completed_evidence_tools = sum(
                1
                for message in request.messages
                if isinstance(message, ToolMessage) and getattr(message, "name", None) in evidence_tool_names
            )
            if completed_evidence_tools >= evidence_limit:
                allowed.difference_update(evidence_tool_names)
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
    def _apply_runtime_budget(request: ModelRequest, context: object) -> ModelRequest:
        if not isinstance(context, dict) or context.get("facetwrite_progressive_canvas_delivery_enabled") is not True:
            return request
        phase = context.get("facetwrite_plan_phase")
        if phase == "planning":
            return request
        model_limit = PlanToolChoiceMiddleware._positive_int(context.get("facetwrite_model_call_limit"))
        recursion_limit = PlanToolChoiceMiddleware._positive_int(context.get("facetwrite_recursion_limit"))
        reserve_steps = PlanToolChoiceMiddleware._positive_int(context.get("facetwrite_synthesis_reserve_steps")) or 0
        evidence_limit = PlanToolChoiceMiddleware._positive_int(context.get("facetwrite_evidence_tool_limit"))
        evidence_tools_raw = context.get("facetwrite_evidence_tools")
        evidence_tools = {value for value in evidence_tools_raw if isinstance(value, str)} if isinstance(evidence_tools_raw, list) else set()
        completed_evidence_tools = PlanToolChoiceMiddleware._completed_tool_count(request, evidence_tools)
        model_calls = sum(1 for message in request.messages if isinstance(message, AIMessage))
        estimated_steps_used = len(request.messages)

        evidence_exhausted = bool(evidence_limit and completed_evidence_tools >= evidence_limit and context.get("facetwrite_force_synthesis_after_evidence") is True)
        model_exhausting = bool(model_limit and model_calls >= max(model_limit - 1, 1))
        recursion_exhausting = bool(recursion_limit and reserve_steps and recursion_limit - estimated_steps_used <= reserve_steps)
        if not (evidence_exhausted or model_exhausting or recursion_exhausting):
            return request

        reason = "evidence budget reached" if evidence_exhausted else "model budget nearly exhausted" if model_exhausting else "runtime step reserve reached"
        PlanToolChoiceMiddleware._emit_synthesis_event({
            "type": "synthesis_gate",
            "phase": "budget_synthesis",
            "reason": reason,
            "completed_evidence_tools": completed_evidence_tools,
            "evidence_limit": evidence_limit,
            "model_limit": model_limit,
            "model_calls": model_calls,
            "recursion_limit": recursion_limit,
            "estimated_steps_used": estimated_steps_used,
            "file_delivery_required": context.get("facetwrite_markdown_file_delivery_required") is True,
            "second_handler": False,
            "entered_second_handler": False,
        })
        file_delivery_required = context.get("facetwrite_markdown_file_delivery_required") is True
        file_presented = PlanToolChoiceMiddleware._has_tool_result(request, "present_files")
        if file_delivery_required and not file_presented:
            delivery_tools = [
                tool for tool in request.tools
                if PlanToolChoiceMiddleware._tool_name(tool) in {"write_file", "present_files"}
            ]
            reminder = HumanMessage(
                content=(
                    "FacetWrite runtime budget notice: stop evidence gathering now. "
                    f"Reason: {reason}. First synthesize the complete user deliverable from the gathered evidence, "
                    "including the actual report, summary tables, findings, and references when applicable. "
                    "Then write that full Markdown deliverable to `/mnt/user-data/outputs/*.md` with write_file, "
                    "and call present_files for that file. Do not write a delivery note, skill-loading note, "
                    "clarification question, or file-save status as the file content. Keep the chat response concise "
                    "only after the complete file is presented."
                ),
                additional_kwargs={"hide_from_ui": True, "facetwrite_budget_notice": True},
            )
            messages = list(request.messages)
            if not any(isinstance(message, HumanMessage) and message.additional_kwargs.get("facetwrite_budget_notice") for message in messages[-3:]):
                messages.append(reminder)
            return request.override(messages=messages, tools=delivery_tools, tool_choice=None)

        reminder = HumanMessage(
            content=(
                "FacetWrite runtime budget notice: stop calling tools now. "
                f"Reason: {reason}. Produce the final user-facing answer from the evidence already gathered. "
                "Include concrete conclusions, any caveats, and source/file references that are already available."
            ),
            additional_kwargs={"hide_from_ui": True, "facetwrite_budget_notice": True},
        )
        messages = list(request.messages)
        if not any(isinstance(message, HumanMessage) and message.additional_kwargs.get("facetwrite_budget_notice") for message in messages[-3:]):
            messages.append(reminder)
        return request.override(messages=messages, tools=[], tool_choice=None)

    @staticmethod
    def _is_budget_synthesis_request(request: ModelRequest) -> bool:
        return (
            not request.tools
            and any(
                isinstance(message, HumanMessage)
                and message.additional_kwargs.get("facetwrite_budget_notice")
                for message in request.messages[-4:]
            )
        )

    @staticmethod
    def _budget_retry_request(request: ModelRequest) -> ModelRequest:
        messages = list(request.messages)
        messages.append(HumanMessage(
            content=(
                "FacetWrite hard budget guard: the previous response requested tools after the runtime budget was exhausted. "
                "Do not call tools. Produce the final answer now from the evidence already present in the conversation."
            ),
            additional_kwargs={"hide_from_ui": True, "facetwrite_budget_notice": True},
        ))
        return request.override(messages=messages, tools=[], tool_choice=None)

    @staticmethod
    def _emit_synthesis_event(payload: dict[str, Any]) -> None:
        try:
            from langgraph.config import get_stream_writer

            writer = get_stream_writer()
            writer(payload)
        except Exception:
            pass

    @staticmethod
    def _positive_int(value: object) -> int | None:
        return value if isinstance(value, int) and value > 0 else None

    @staticmethod
    def _completed_tool_count(request: ModelRequest, tool_names: set[str]) -> int:
        if not tool_names:
            return 0
        return sum(
            1
            for message in request.messages
            if isinstance(message, ToolMessage) and getattr(message, "name", None) in tool_names
        )

    @staticmethod
    def _tool_name(tool: object) -> str | None:
        return tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)

    @staticmethod
    def _is_skill_scope_guard(context: object) -> bool:
        if not isinstance(context, dict):
            return False
        policy = context.get("facetwrite_clarification_policy")
        if not isinstance(policy, dict):
            context_values = context.get("facetwrite_context_values")
            if isinstance(context_values, dict):
                policy = context_values.get("facetwrite_clarification_policy")
        return isinstance(policy, dict) and policy.get("mode") == "skill_scope_guard"

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
        return any(bool(getattr(message, "tool_calls", None)) for message in PlanToolChoiceMiddleware._result_messages(result))

    @staticmethod
    def _contains_internal_runtime_protocol(result: ModelCallResult) -> bool:
        return any(
            PlanToolChoiceMiddleware._looks_like_internal_runtime_protocol(PlanToolChoiceMiddleware._message_content_text(message))
            for message in PlanToolChoiceMiddleware._result_messages(result)
        )

    @staticmethod
    def _result_messages(result: ModelCallResult) -> list[object]:
        messages = getattr(result, "result", None)
        if isinstance(messages, list):
            return messages
        return [result]

    @staticmethod
    def _message_content_text(message: object) -> str:
        content = getattr(message, "content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    value = item.get("text") or item.get("content")
                    if isinstance(value, str):
                        parts.append(value)
            return " ".join(parts)
        return str(content)

    @staticmethod
    def _looks_like_internal_runtime_protocol(text: str) -> bool:
        normalized = re.sub(r"\s+", " ", text or "").strip()
        return bool(normalized) and any(pattern.search(normalized) for pattern in _INTERNAL_RUNTIME_PROTOCOL_PATTERNS)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        result = handler(prepared)
        if PlanToolChoiceMiddleware._is_budget_synthesis_request(prepared) and (
            PlanToolChoiceMiddleware._contains_tool_call(result)
            or PlanToolChoiceMiddleware._contains_internal_runtime_protocol(result)
        ):
            PlanToolChoiceMiddleware._emit_synthesis_event({
                "type": "synthesis_gate",
                "phase": "budget_synthesis",
                "reason": "model returned tools after budget synthesis notice",
                "second_handler": True,
                "entered_second_handler": True,
            })
            retry = handler(PlanToolChoiceMiddleware._budget_retry_request(prepared))
            PlanToolChoiceMiddleware._emit_synthesis_event({
                "type": "synthesis_gate",
                "phase": "budget_synthesis",
                "reason": "second handler completed",
                "second_handler": True,
                "entered_second_handler": True,
            })
            if (
                PlanToolChoiceMiddleware._contains_tool_call(retry)
                or PlanToolChoiceMiddleware._contains_internal_runtime_protocol(retry)
            ):
                raise RuntimeError("FacetWrite runtime budget exhausted but model continued requesting tools or internal runtime protocol")
            return retry
        return result

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        prepared = self._prepare(request)
        result = await handler(prepared)
        if PlanToolChoiceMiddleware._is_budget_synthesis_request(prepared) and (
            PlanToolChoiceMiddleware._contains_tool_call(result)
            or PlanToolChoiceMiddleware._contains_internal_runtime_protocol(result)
        ):
            PlanToolChoiceMiddleware._emit_synthesis_event({
                "type": "synthesis_gate",
                "phase": "budget_synthesis",
                "reason": "model returned tools after budget synthesis notice",
                "second_handler": True,
                "entered_second_handler": True,
            })
            retry = await handler(PlanToolChoiceMiddleware._budget_retry_request(prepared))
            PlanToolChoiceMiddleware._emit_synthesis_event({
                "type": "synthesis_gate",
                "phase": "budget_synthesis",
                "reason": "second handler completed",
                "second_handler": True,
                "entered_second_handler": True,
            })
            if (
                PlanToolChoiceMiddleware._contains_tool_call(retry)
                or PlanToolChoiceMiddleware._contains_internal_runtime_protocol(retry)
            ):
                raise RuntimeError("FacetWrite runtime budget exhausted but model continued requesting tools or internal runtime protocol")
            return retry
        return result
