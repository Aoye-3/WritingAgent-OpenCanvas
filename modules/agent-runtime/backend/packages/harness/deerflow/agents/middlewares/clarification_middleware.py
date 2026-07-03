"""Middleware for intercepting clarification requests and presenting them to the user."""

import json
import logging
from collections.abc import Callable
from hashlib import sha256
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command, interrupt

logger = logging.getLogger(__name__)


class ClarificationMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    pass


class ClarificationMiddleware(AgentMiddleware[ClarificationMiddlewareState]):
    """Intercepts clarification tool calls and interrupts execution to present questions to the user.

    When the model calls the `ask_clarification` tool, this middleware:
    1. Intercepts the tool call before execution
    2. Extracts the clarification question and metadata
    3. Formats a user-friendly message
    4. Returns a Command that interrupts execution and presents the question
    5. Waits for user response before continuing

    This replaces the tool-based approach where clarification continued the conversation flow.
    """

    state_schema = ClarificationMiddlewareState

    def _stable_message_id(self, tool_call_id: str, formatted_message: str) -> str:
        """Build a deterministic message ID so retried clarification calls replace, not append."""
        if tool_call_id:
            return f"clarification:{tool_call_id}"
        digest = sha256(formatted_message.encode("utf-8")).hexdigest()[:16]
        return f"clarification:{digest}"

    def _is_chinese(self, text: str) -> bool:
        """Check if text contains Chinese characters.

        Args:
            text: Text to check

        Returns:
            True if text contains Chinese characters
        """
        return any("\u4e00" <= char <= "\u9fff" for char in text)

    def _format_option(self, option: object) -> str:
        if not isinstance(option, dict):
            return str(option)
        label = str(option.get("label") or option.get("title") or option.get("id") or "").strip()
        detail = str(option.get("detail") or option.get("description") or "").strip()
        if label and detail:
            return f"{label} - {detail}"
        return label or detail or str(option)

    def _normalize_options(self, options: object) -> list[dict]:
        if isinstance(options, str):
            try:
                options = json.loads(options)
            except (json.JSONDecodeError, TypeError):
                options = [options]

        if options is None:
            options = []
        elif not isinstance(options, list):
            options = [options]

        normalized: list[dict] = []
        for index, option in enumerate(options, 1):
            if hasattr(option, "model_dump"):
                option = option.model_dump()
            if isinstance(option, dict):
                label = str(option.get("label") or option.get("title") or option.get("id") or "").strip()
                detail = str(option.get("detail") or option.get("description") or "").strip()
                option_id = str(option.get("id") or f"option_{index}").strip()
                normalized.append({
                    "id": option_id or f"option_{index}",
                    "label": label,
                    "detail": detail,
                    "recommended": option.get("recommended") is True,
                })
                continue
            label = str(option).strip()
            normalized.append({
                "id": f"option_{index}",
                "label": label,
                "detail": "",
                "recommended": False,
            })
        return normalized

    def _structured_clarification_payload(self, args: dict) -> dict:
        payload = {
            "type": "agent_clarification_requested",
            "question": str(args.get("question") or "").strip(),
            "clarification_type": str(args.get("clarification_type") or "missing_info").strip(),
            "options": self._normalize_options(args.get("options")),
        }
        context = str(args.get("context") or "").strip()
        if context:
            payload["context"] = context
        return payload

    def _interrupt(self, payload: dict) -> object:
        return interrupt(payload)

    def _structured_answer_payload(self, args: dict, resume_value: object) -> dict:
        payload = {
            "type": "agent_clarification_answered",
            "question": str(args.get("question") or "").strip(),
        }
        if isinstance(resume_value, dict):
            option = resume_value.get("option")
            selected_option_id = str(resume_value.get("selectedOptionId") or resume_value.get("optionId") or "").strip()
            answer = str(resume_value.get("answer") or resume_value.get("customAnswer") or "").strip()
            if isinstance(option, dict):
                label = str(option.get("label") or "").strip()
                detail = str(option.get("detail") or option.get("description") or "").strip()
                if not answer:
                    answer = label
                payload["option"] = {
                    "id": str(option.get("id") or selected_option_id or "").strip(),
                    "label": label,
                    "detail": detail,
                }
            if selected_option_id:
                payload["selectedOptionId"] = selected_option_id
            if answer:
                payload["answer"] = answer
            return payload
        answer = str(resume_value or "").strip()
        if answer:
            payload["answer"] = answer
        return payload

    def _format_answer_message(self, answer_payload: dict) -> str:
        answer = str(answer_payload.get("answer") or "").strip()
        option = answer_payload.get("option")
        if not answer and isinstance(option, dict):
            answer = str(option.get("label") or "").strip()
        if answer:
            return f"Clarification answered: {answer}"
        return "Clarification answered."

    def _format_clarification_message(self, args: dict) -> str:
        """Format the clarification arguments into a user-friendly message.

        Args:
            args: The tool call arguments containing clarification details

        Returns:
            Formatted message string
        """
        question = args.get("question", "")
        clarification_type = args.get("clarification_type", "missing_info")
        context = args.get("context")
        options = args.get("options", [])

        # Some models (e.g. Qwen3-Max) serialize array parameters as JSON strings
        # instead of native arrays. Deserialize and normalize so `options`
        # is always a list for the rendering logic below.
        if isinstance(options, str):
            try:
                options = json.loads(options)
            except (json.JSONDecodeError, TypeError):
                options = [options]

        if options is None:
            options = []
        elif not isinstance(options, list):
            options = [options]

        # Type-specific icons
        type_icons = {
            "missing_info": "❓",
            "ambiguous_requirement": "🤔",
            "approach_choice": "🔀",
            "risk_confirmation": "⚠️",
            "suggestion": "💡",
        }

        icon = type_icons.get(clarification_type, "❓")

        # Build the message naturally
        message_parts = []

        # Add icon and question together for a more natural flow
        if context:
            # If there's context, present it first as background
            message_parts.append(f"{icon} {context}")
            message_parts.append(f"\n{question}")
        else:
            # Just the question with icon
            message_parts.append(f"{icon} {question}")

        # Add options in a cleaner format
        if options and len(options) > 0:
            message_parts.append("")  # blank line for spacing
            for i, option in enumerate(options, 1):
                message_parts.append(f"  {i}. {self._format_option(option)}")

        return "\n".join(message_parts)

    def _handle_clarification(self, request: ToolCallRequest) -> Command:
        """Handle clarification request and return command to interrupt execution.

        Args:
            request: Tool call request

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Extract clarification arguments
        args = request.tool_call.get("args", {})
        question = args.get("question", "")

        logger.info("Intercepted clarification request")
        logger.debug("Clarification question: %s", question)

        structured_payload = self._structured_clarification_payload(args)

        # Get the tool call ID
        tool_call_id = request.tool_call.get("id", "")
        resume_value = self._interrupt(structured_payload)
        answer_payload = self._structured_answer_payload(args, resume_value)
        formatted_message = self._format_answer_message(answer_payload)

        # Create a ToolMessage with the formatted question
        # This will be added to the message history
        tool_message = ToolMessage(
            id=self._stable_message_id(tool_call_id, formatted_message),
            content=formatted_message,
            tool_call_id=tool_call_id,
            name="ask_clarification",
            artifact=answer_payload,
            additional_kwargs={"facetwrite_clarification_answer": answer_payload},
        )

        return tool_message

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (sync version).

        Args:
            request: Tool call request
            handler: Original tool execution handler

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return handler(request)

        return self._handle_clarification(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (async version).

        Args:
            request: Tool call request
            handler: Original tool execution handler (async)

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return await handler(request)

        return self._handle_clarification(request)
