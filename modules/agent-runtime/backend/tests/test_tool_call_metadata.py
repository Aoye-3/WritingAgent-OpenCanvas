"""Tests for AIMessage tool-call metadata helpers."""

from langchain_core.messages import AIMessage

from deerflow.agents.middlewares.tool_call_metadata import clone_ai_message_with_tool_calls


def test_clone_ai_message_with_no_tool_calls_clears_invalid_and_raw_metadata():
    message = AIMessage(
        content="thinking",
        tool_calls=[{"name": "bash", "args": {"command": "ls"}, "id": "call_1"}],
        invalid_tool_calls=[
            {
                "id": "call_invalid",
                "name": "web_search",
                "args": '{"query":',
                "error": "invalid json",
            }
        ],
        additional_kwargs={
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "bash", "arguments": '{"command":"ls"}'},
                }
            ],
            "function_call": {"name": "bash", "arguments": '{"command":"ls"}'},
        },
        response_metadata={"finish_reason": "tool_calls"},
    )

    cloned = clone_ai_message_with_tool_calls(message, [])

    assert cloned.tool_calls == []
    assert cloned.invalid_tool_calls == []
    assert "tool_calls" not in cloned.additional_kwargs
    assert "function_call" not in cloned.additional_kwargs
    assert cloned.response_metadata["finish_reason"] == "stop"
