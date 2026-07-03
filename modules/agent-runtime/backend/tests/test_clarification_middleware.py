"""Tests for ClarificationMiddleware, focusing on options type coercion."""

import json
from types import SimpleNamespace

import pytest
from langgraph.graph.message import add_messages

from deerflow.agents.middlewares.clarification_middleware import ClarificationMiddleware
from deerflow.tools.builtins.clarification_tool import ask_clarification_tool


@pytest.fixture
def middleware():
    return ClarificationMiddleware()


class TestFormatClarificationMessage:
    """Tests for _format_clarification_message options handling."""

    def test_options_as_native_list(self, middleware):
        """Normal case: options is already a list."""
        args = {
            "question": "Which env?",
            "clarification_type": "approach_choice",
            "options": ["dev", "staging", "prod"],
        }
        result = middleware._format_clarification_message(args)
        assert "1. dev" in result
        assert "2. staging" in result
        assert "3. prod" in result

    def test_options_as_json_string(self, middleware):
        """Bug case (#1995): model serializes options as a JSON string."""
        args = {
            "question": "Which env?",
            "clarification_type": "approach_choice",
            "options": json.dumps(["dev", "staging", "prod"]),
        }
        result = middleware._format_clarification_message(args)
        assert "1. dev" in result
        assert "2. staging" in result
        assert "3. prod" in result
        # Must NOT contain per-character output
        assert "1. [" not in result
        assert '2. "' not in result

    def test_options_as_json_string_scalar(self, middleware):
        """JSON string decoding to a non-list scalar is treated as one option."""
        args = {
            "question": "Which env?",
            "clarification_type": "approach_choice",
            "options": json.dumps("development"),
        }
        result = middleware._format_clarification_message(args)
        assert "1. development" in result
        # Must be a single option, not per-character iteration.
        assert "2." not in result

    def test_options_as_plain_string(self, middleware):
        """Edge case: options is a non-JSON string, treated as single option."""
        args = {
            "question": "Which env?",
            "clarification_type": "approach_choice",
            "options": "just one option",
        }
        result = middleware._format_clarification_message(args)
        assert "1. just one option" in result

    def test_options_none(self, middleware):
        """Options is None — no options section rendered."""
        args = {
            "question": "Tell me more",
            "clarification_type": "missing_info",
            "options": None,
        }
        result = middleware._format_clarification_message(args)
        assert "1." not in result

    def test_options_empty_list(self, middleware):
        """Options is an empty list — no options section rendered."""
        args = {
            "question": "Tell me more",
            "clarification_type": "missing_info",
            "options": [],
        }
        result = middleware._format_clarification_message(args)
        assert "1." not in result

    def test_options_missing(self, middleware):
        """Options key is absent — defaults to empty list."""
        args = {
            "question": "Tell me more",
            "clarification_type": "missing_info",
        }
        result = middleware._format_clarification_message(args)
        assert "1." not in result

    def test_context_included(self, middleware):
        """Context is rendered before the question."""
        args = {
            "question": "Which env?",
            "clarification_type": "approach_choice",
            "context": "Need target env for config",
            "options": ["dev", "prod"],
        }
        result = middleware._format_clarification_message(args)
        assert "Need target env for config" in result
        assert "Which env?" in result
        assert "1. dev" in result

    def test_json_string_with_mixed_types(self, middleware):
        """JSON string containing non-string elements still works."""
        args = {
            "question": "Pick one",
            "clarification_type": "approach_choice",
            "options": json.dumps(["Option A", 2, True, None]),
        }
        result = middleware._format_clarification_message(args)
        assert "1. Option A" in result
        assert "2. 2" in result
        assert "3. True" in result
        assert "4. None" in result

    def test_structured_options_render_label_and_detail(self, middleware):
        args = {
            "question": "Which scope?",
            "clarification_type": "approach_choice",
            "options": [
                {"id": "recent", "label": "Recent review", "detail": "Focus on the last two years", "recommended": True},
                {"id": "broad", "label": "Broad scan", "description": "Cover the full field"},
            ],
        }
        result = middleware._format_clarification_message(args)
        assert "1. Recent review - Focus on the last two years" in result
        assert "2. Broad scan - Cover the full field" in result


class TestAskClarificationToolSchema:
    def test_requires_two_structured_options(self):
        schema = ask_clarification_tool.args_schema
        assert schema is not None

        with pytest.raises(ValueError):
            schema.model_validate({
                "question": "Which scope?",
                "clarification_type": "approach_choice",
                "options": [
                    {"id": "only", "label": "Only one", "detail": "One option is not enough"},
                ],
            })

    def test_rejects_missing_option_label_and_multiple_recommended(self):
        schema = ask_clarification_tool.args_schema
        assert schema is not None

        with pytest.raises(ValueError):
            schema.model_validate({
                "question": "Which scope?",
                "clarification_type": "approach_choice",
                "options": [
                    {"id": "a", "detail": "Missing label"},
                    {"id": "b", "label": "B", "detail": "Valid"},
                ],
            })

        with pytest.raises(ValueError):
            schema.model_validate({
                "question": "Which scope?",
                "clarification_type": "approach_choice",
                "options": [
                    {"id": "a", "label": "A", "detail": "First", "recommended": True},
                    {"id": "b", "label": "B", "detail": "Second", "recommended": True},
                ],
            })


class TestClarificationCommandIdempotency:
    """Clarification tool-call retries should not duplicate messages in state."""

    def test_tool_message_carries_structured_clarification_answer_after_resume(self, middleware):
        request = SimpleNamespace(
            tool_call={
                "name": "ask_clarification",
                "id": "call-clarify-structured",
                "args": {
                    "question": "Which scope should I use?",
                    "clarification_type": "approach_choice",
                    "context": "The selected skill can run narrow or broad research.",
                    "options": [
                        {"id": "recent", "label": "Recent", "detail": "Focus on recent papers", "recommended": True},
                        {"id": "broad", "label": "Broad", "description": "Scan the wider literature"},
                    ],
                },
            }
        )
        interrupted = []
        middleware._interrupt = lambda payload: interrupted.append(payload) or {  # type: ignore[method-assign]
            "selectedOptionId": "recent",
            "answer": "Recent",
            "option": {"id": "recent", "label": "Recent", "detail": "Focus on recent papers"},
        }

        message = middleware.wrap_tool_call(request, lambda _req: pytest.fail("handler should not be called"))

        assert message.name == "ask_clarification"
        assert interrupted[0]["type"] == "agent_clarification_requested"
        assert interrupted[0]["question"] == "Which scope should I use?"
        assert interrupted[0]["context"] == "The selected skill can run narrow or broad research."
        assert interrupted[0]["options"] == [
            {"id": "recent", "label": "Recent", "detail": "Focus on recent papers", "recommended": True},
            {"id": "broad", "label": "Broad", "detail": "Scan the wider literature", "recommended": False},
        ]
        assert message.artifact["type"] == "agent_clarification_answered"
        assert message.artifact["question"] == "Which scope should I use?"
        assert message.artifact["selectedOptionId"] == "recent"
        assert message.artifact["answer"] == "Recent"
        assert message.additional_kwargs["facetwrite_clarification_answer"] == message.artifact

    def test_repeated_tool_call_uses_stable_message_id(self, middleware):
        request = SimpleNamespace(
            tool_call={
                "name": "ask_clarification",
                "id": "call-clarify-1",
                "args": {
                    "question": "Which environment should I use?",
                    "clarification_type": "approach_choice",
                    "options": ["dev", "prod"],
                },
            }
        )

        middleware._interrupt = lambda _payload: "dev"  # type: ignore[method-assign]
        first = middleware.wrap_tool_call(request, lambda _req: pytest.fail("handler should not be called"))
        second = middleware.wrap_tool_call(request, lambda _req: pytest.fail("handler should not be called"))

        first_message = first
        second_message = second

        assert first_message.id == "clarification:call-clarify-1"
        assert second_message.id == first_message.id
        assert second_message.tool_call_id == first_message.tool_call_id

        merged = add_messages(add_messages([], [first_message]), [second_message])

        assert len(merged) == 1
        assert merged[0].id == "clarification:call-clarify-1"
        assert merged[0].content == first_message.content

    def test_missing_tool_call_id_still_gets_stable_message_id(self, middleware):
        request = SimpleNamespace(
            tool_call={
                "name": "ask_clarification",
                "args": {
                    "question": "Which environment should I use?",
                    "clarification_type": "missing_info",
                },
            }
        )

        middleware._interrupt = lambda _payload: "Use production."  # type: ignore[method-assign]
        first = middleware.wrap_tool_call(request, lambda _req: pytest.fail("handler should not be called"))
        second = middleware.wrap_tool_call(request, lambda _req: pytest.fail("handler should not be called"))

        first_message = first
        second_message = second

        assert first_message.id.startswith("clarification:")
        assert second_message.id == first_message.id

        merged = add_messages(add_messages([], [first_message]), [second_message])

        assert len(merged) == 1
