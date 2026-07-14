import json
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphBubbleUp, GraphInterrupt
from langgraph.runtime import Runtime

from deerflow.agents.middlewares.durable_task_guard_middleware import DurableTaskGuardMiddleware

FIXTURE_PATH = Path(__file__).parents[4] / "server/runtime/agentBackendAdapter/fixtures/durable-task-guard-cases.json"
CASES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _runtime(**context):
    return Runtime(context={"run_id": "run-1", "facetwrite_progressive_canvas_delivery_enabled": True, **context})


def _state_for_case(middleware: DurableTaskGuardMiddleware, case: dict):
    initial_messages = [HumanMessage(content="Complete the requested durable work.")]
    run_state = middleware.before_agent({"messages": initial_messages}, _runtime())
    messages = list(initial_messages)
    if case["hasEvidence"]:
        messages.append(ToolMessage(content="database rows", name="database_search", tool_call_id="call-1"))
    messages.append(AIMessage(content=case["text"]))
    return {"messages": messages, **(run_state or {})}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_fixture_classifies_only_unevidenced_action_promises(case):
    middleware = DurableTaskGuardMiddleware()

    result = middleware.after_model(_state_for_case(middleware, case), _runtime())

    assert (result is not None) is case["expectContinuation"]


def test_continuation_keeps_public_ai_message_and_adds_hidden_tagged_instruction():
    middleware = DurableTaskGuardMiddleware()
    ai_message = AIMessage(content="Understood. Let me start searching.")
    state = {
        "messages": [HumanMessage(content="Research this"), ai_message],
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 0,
    }

    result = middleware.after_model(state, _runtime())

    assert result is not None
    assert state["messages"][-1] is ai_message
    assert result["jump_to"] == "model"
    assert result["durable_task_guard_continuations"] == 1
    continuation = result["messages"][0]
    assert isinstance(continuation, HumanMessage)
    assert continuation.name == "durable_task_continuation_guard"
    assert continuation.additional_kwargs == {
        "hide_from_ui": True,
        "facetwrite_internal_continuation": True,
    }


@pytest.mark.parametrize(
    "context",
    [
        {"facetwrite_progressive_canvas_delivery_enabled": True},
        {"facetwrite_plan_phase": "execution"},
        {
            "facetwrite_canvas_delivery_contract": {
                "id": "facetwrite_canvas_delivery_v1",
                "format": "facetwrite_canvas_delivery",
                "diagramFormat": "facetwrite_diagram_delivery",
                "preferredMode": "batch_delivery",
                "locale": "en",
            }
        },
    ],
    ids=["progressive_canvas", "plan_execution", "canvas_delivery_contract"],
)
def test_guard_is_active_for_each_durable_task_contract(context):
    middleware = DurableTaskGuardMiddleware()
    state = {
        "messages": [HumanMessage(content="Do the work"), AIMessage(content="Let me start searching.")],
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 0,
    }

    result = middleware.after_model(state, Runtime(context={"run_id": "run-1", **context}))

    assert result is not None
    assert result["jump_to"] == "model"


def test_simple_chat_and_tool_calls_are_not_captured():
    middleware = DurableTaskGuardMiddleware()
    promise_state = {
        "messages": [HumanMessage(content="Hello"), AIMessage(content="Let me check that.")],
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 0,
    }
    tool_state = {
        **promise_state,
        "messages": [
            HumanMessage(content="Research this"),
            AIMessage(content="Let me check that.", tool_calls=[{"name": "web_search", "args": {"query": "x"}, "id": "call-1"}]),
        ],
    }

    assert middleware.after_model(promise_state, Runtime(context={"facetwrite_plan_phase": "chat"})) is None
    assert middleware.after_model(tool_state, _runtime()) is None


def test_exhaustion_emits_structured_incomplete_event_and_ends_normally():
    events = []
    middleware = DurableTaskGuardMiddleware()
    state = {
        "messages": [HumanMessage(content="Research this"), AIMessage(content="Let me start searching.")],
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 2,
    }

    result = middleware.after_model(state, Runtime(context={
        "run_id": "run-1",
        "facetwrite_progressive_canvas_delivery_enabled": True,
    }, stream_writer=events.append))

    assert result is None
    assert events == [{
        "type": "durable_task_incomplete",
        "reason": "action_promise_without_required_evidence",
        "runId": "run-1",
        "continuations": 2,
    }]


@pytest.mark.parametrize("signal", [GraphBubbleUp(), GraphInterrupt()], ids=["bubble_up", "interrupt"])
def test_exhaustion_does_not_capture_langgraph_control_flow(signal):
    middleware = DurableTaskGuardMiddleware()
    state = {
        "messages": [HumanMessage(content="Research this"), AIMessage(content="Let me start searching.")],
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 2,
    }

    def raise_signal(_event):
        raise signal

    with pytest.raises(type(signal)):
        middleware.after_model(state, Runtime(context={
            "facetwrite_progressive_canvas_delivery_enabled": True,
        }, stream_writer=raise_signal))


def test_guard_counter_and_evidence_boundary_reset_for_every_run():
    middleware = DurableTaskGuardMiddleware()
    state = {
        "messages": [HumanMessage(content="new run")],
        "durable_task_guard_run_start_index": 0,
        "durable_task_guard_continuations": 2,
    }

    result = middleware.before_agent(state, _runtime())

    assert result == {
        "durable_task_guard_run_start_index": 1,
        "durable_task_guard_continuations": 0,
    }
