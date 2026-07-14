"""Guard durable Runtime tasks from ending on an unevidenced action promise."""

import re
from typing import Any, NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware, hook_config
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphBubbleUp
from langgraph.runtime import Runtime

_MAX_CONTINUATIONS = 2
_INCOMPLETE_REASON = "action_promise_without_required_evidence"
_ACTION_PROMISE_PATTERNS = (
    re.compile(
        r"^\s*(?:(?:okay|ok|understood|got it|sure|all right)\s*[,!.:;-]\s*)*"
        r"(?:let me|i(?:'ll| will| am going to)|we(?:'ll| will))\b.{0,160}"
        r"\b(?:start|begin|load|search|check|fetch|query|research|retrieve|inspect|read|write|create|"
        r"generate|run|analy[sz]e|synthesize|compile)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:(?:好的?|明白了?|收到|可以)\s*[，。！、,:;；]?\s*)*"
        r"(?:让我|我(?:将|会|先|来)|接下来|下一步).{0,120}"
        r"(?:开始|加载|检索|搜索|查询|查找|读取|分析|生成|编写|创建|执行|整理|汇总|综合)"
    ),
)
_DELIVERABLE_OUTCOME_SEPARATOR = re.compile(r"[:：]")
_DELIVERABLE_EVIDENCE_PATTERN = re.compile(
    r"(?:\d+(?:\.\d+)?\s*%|\b(?:saves?|faster|slower|better|worse|more|less)\b|节省|更快|更慢|更好|更差)",
    re.IGNORECASE,
)
_DELIVERABLE_CONCLUSION_PATTERN = re.compile(
    r"(?:\b(?:therefore|thus|clearly)\b|\b(?:i|we)\s+recommend\b|因此|所以|明显)",
    re.IGNORECASE,
)


class DurableTaskGuardState(AgentState):
    durable_task_guard_run_start_index: NotRequired[int]
    durable_task_guard_continuations: NotRequired[int]


class DurableTaskGuardMiddleware(AgentMiddleware[DurableTaskGuardState]):
    """Continue durable work when a model stops after only promising an action."""

    state_schema = DurableTaskGuardState

    @override
    def before_agent(self, state: DurableTaskGuardState, runtime: Runtime) -> dict[str, int]:
        return {
            "durable_task_guard_run_start_index": len(state.get("messages", [])),
            "durable_task_guard_continuations": 0,
        }

    @staticmethod
    def _context(runtime: Runtime) -> dict[str, Any]:
        return runtime.context if isinstance(runtime.context, dict) else {}

    @staticmethod
    def _is_durable(runtime: Runtime) -> bool:
        context = DurableTaskGuardMiddleware._context(runtime)
        if context.get("facetwrite_progressive_canvas_delivery_enabled") is True:
            return True
        if context.get("facetwrite_plan_phase") == "execution":
            return True
        if context.get("facetwrite_markdown_file_delivery_required") is True:
            return True
        canvas_action = context.get("facetwrite_canvas_action")
        if isinstance(canvas_action, dict) and canvas_action.get("requiresTool") is True:
            return True
        contract = context.get("facetwrite_canvas_delivery_contract")
        return (
            isinstance(contract, dict)
            and contract.get("id") == "facetwrite_canvas_delivery_v1"
            and contract.get("format") == "facetwrite_canvas_delivery"
        )

    @staticmethod
    def _message_text(message: AIMessage) -> str:
        if isinstance(message.content, str):
            return message.content
        if not isinstance(message.content, list):
            return str(message.content)
        parts: list[str] = []
        for item in message.content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return " ".join(parts)

    @staticmethod
    def _has_structural_deliverable(text: str) -> bool:
        """Recognize a concrete outcome after a response-leading promise clause."""
        separator = _DELIVERABLE_OUTCOME_SEPARATOR.search(text)
        if separator is None:
            return False
        outcome = text[separator.end() :].strip()
        return bool(
            outcome
            and _DELIVERABLE_EVIDENCE_PATTERN.search(outcome)
            and _DELIVERABLE_CONCLUSION_PATTERN.search(outcome)
        )

    @staticmethod
    def _is_action_promise(message: AIMessage) -> bool:
        text = re.sub(r"\s+", " ", DurableTaskGuardMiddleware._message_text(message)).strip()
        return (
            bool(text)
            and not DurableTaskGuardMiddleware._has_structural_deliverable(text)
            and any(pattern.search(text) for pattern in _ACTION_PROMISE_PATTERNS)
        )

    @staticmethod
    def _has_run_evidence(state: DurableTaskGuardState) -> bool:
        messages = state.get("messages", [])
        start_index = state.get("durable_task_guard_run_start_index", len(messages))
        return any(isinstance(message, ToolMessage) for message in messages[start_index:])

    @staticmethod
    def _continuation_message() -> HumanMessage:
        return HumanMessage(
            name="durable_task_continuation_guard",
            content=(
                "<facetwrite_internal_continuation>"
                "The previous assistant message promised a future action, but this durable run still has no required "
                "tool or delivery evidence. Continue now with the next concrete tool/delivery step, or provide the "
                "substantive completed deliverable. Do not repeat a process or status promise."
                "</facetwrite_internal_continuation>"
            ),
            additional_kwargs={
                "hide_from_ui": True,
                "facetwrite_internal_continuation": True,
            },
        )

    @staticmethod
    def _emit_incomplete(runtime: Runtime, continuations: int) -> None:
        context = DurableTaskGuardMiddleware._context(runtime)
        payload = {
            "type": "durable_task_incomplete",
            "reason": _INCOMPLETE_REASON,
            "runId": str(context["run_id"]) if context.get("run_id") else None,
            "continuations": continuations,
        }
        if payload["runId"] is None:
            payload.pop("runId")
        try:
            runtime.stream_writer(payload)
        except GraphBubbleUp:
            raise
        except Exception:
            return

    @hook_config(can_jump_to=["model"])
    @override
    def after_model(self, state: DurableTaskGuardState, runtime: Runtime) -> dict[str, Any] | None:
        if not self._is_durable(runtime):
            return None
        messages = state.get("messages", [])
        last_message = messages[-1] if messages else None
        if not isinstance(last_message, AIMessage) or last_message.tool_calls:
            return None
        if self._has_run_evidence(state) or not self._is_action_promise(last_message):
            return None
        continuations = state.get("durable_task_guard_continuations", 0)
        if continuations >= _MAX_CONTINUATIONS:
            self._emit_incomplete(runtime, continuations)
            return None
        return {
            "messages": [self._continuation_message()],
            "durable_task_guard_continuations": continuations + 1,
            "jump_to": "model",
        }
