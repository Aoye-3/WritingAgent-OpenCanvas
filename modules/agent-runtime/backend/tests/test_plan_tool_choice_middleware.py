from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from deerflow.agents.middlewares.plan_tool_choice_middleware import PlanToolChoiceMiddleware


@tool
def plan_update(action: str) -> str:
    """Update the active plan."""
    return action


@tool
def plan_clarification_submit(question: str) -> str:
    """Submit one Plan clarification."""
    return question


@tool
def plan_revision_submit(planId: str) -> str:
    """Submit one Plan revision."""
    return planId


@tool
def web_search(query: str) -> str:
    """Search the web."""
    return query


@tool
def web_fetch(url: str) -> str:
    """Fetch a web page."""
    return url


@tool
def read_file(path: str) -> str:
    """Read a file."""
    return path


@tool
def artifact_stage(planId: str, artifacts: list) -> str:
    """Commit step artifacts to Canvas."""
    return planId


@tool
def canvas_write(operation: str, content: str) -> str:
    """Write content to Canvas."""
    return operation


@tool
def ask_clarification(question: str, options: list) -> str:
    """Ask a structured clarification."""
    return question


def request(*, phase: str, stage: str | None = None, messages=None, canvas_action=None, phase_attempt_id=None,
            allowed_tool_refs=None, tool_state=None, evidence_tool_limit=None, evidence_tools=None,
            progressive_enabled=None, model_call_limit=None, recursion_limit=None, synthesis_reserve_steps=None,
            force_synthesis_after_evidence=None, body_draft_write_limit=None, body_draft_writes_used=None,
            force_synthesis_after_body_drafts=None, clarification_policy=None):
    runtime = SimpleNamespace(context={
        "facetwrite_plan_phase": phase,
        "facetwrite_plan_stage": stage,
        "facetwrite_plan_phase_attempt_id": phase_attempt_id,
        "facetwrite_canvas_action": canvas_action,
        "facetwrite_allowed_tool_refs": allowed_tool_refs,
        "facetwrite_tool_state": tool_state,
        "facetwrite_evidence_tool_limit": evidence_tool_limit,
        "facetwrite_body_draft_write_limit": body_draft_write_limit,
        "facetwrite_body_draft_writes_used": body_draft_writes_used,
        "facetwrite_evidence_tools": evidence_tools,
        "facetwrite_progressive_canvas_delivery_enabled": progressive_enabled,
        "facetwrite_model_call_limit": model_call_limit,
        "facetwrite_recursion_limit": recursion_limit,
        "facetwrite_synthesis_reserve_steps": synthesis_reserve_steps,
        "facetwrite_force_synthesis_after_evidence": force_synthesis_after_evidence,
        "facetwrite_force_synthesis_after_body_drafts": force_synthesis_after_body_drafts,
        "facetwrite_clarification_policy": clarification_policy,
    })
    initial_messages = messages or [HumanMessage(content="Plan this task")]
    initial_tools = [plan_update, plan_clarification_submit, plan_revision_submit, web_search, web_fetch, read_file, artifact_stage, canvas_write, ask_clarification]

    def build(current_messages, current_tools, current_tool_choice=None):
        return SimpleNamespace(
            runtime=runtime,
            messages=current_messages,
            tools=current_tools,
            tool_choice=current_tool_choice,
            override=lambda **changes: build(
                changes.get("messages", current_messages),
                changes.get("tools", current_tools),
                changes.get("tool_choice", current_tool_choice),
            ),
        )

    return build(initial_messages, initial_tools)


def test_filters_intake_tools_to_the_phase_contract():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(
            phase="planning",
            stage="intake",
            allowed_tool_refs=["plan_clarification_submit", "knowledge_base", "ls"],
            tool_state={"plan_clarification_submit": True, "knowledge_base": False, "ls": True},
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["plan_clarification_submit"]


def test_filters_chat_tools_using_allowed_refs_and_disabled_state():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(
            phase="chat",
            allowed_tool_refs=["web_search", "canvas_write"],
            tool_state={"web_search": False, "canvas_write": True},
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]


def test_skill_scope_guard_forces_ask_clarification_after_tool_filtering():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(
            phase="chat",
            allowed_tool_refs=["ask_clarification"],
            tool_state={"ask_clarification": True, "web_search": True},
            clarification_policy={"mode": "skill_scope_guard", "instruction": "Ask first."},
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["ask_clarification"]
    assert captured["request"].tool_choice == "ask_clarification"


def test_filters_evidence_tools_after_total_budget_reached():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Review agent literature"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        ToolMessage(content="result 2", name="web_fetch", tool_call_id="call_2"),
        ToolMessage(content="result 3", name="read_file", tool_call_id="call_3"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "web_fetch", "read_file", "canvas_write"],
            tool_state={"web_search": True, "web_fetch": True, "read_file": True, "canvas_write": True},
            evidence_tool_limit=3,
            evidence_tools=["web_search", "web_fetch", "read_file"],
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]


def test_forces_final_answer_after_evidence_budget_reached():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Review agent literature"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        ToolMessage(content="result 2", name="web_fetch", tool_call_id="call_2"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "web_fetch", "read_file", "canvas_write"],
            tool_state={"web_search": True, "web_fetch": True, "read_file": True, "canvas_write": True},
            evidence_tool_limit=2,
            evidence_tools=["web_search", "web_fetch", "read_file"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tools == []
    assert "stop calling tools now" in captured["request"].messages[-1].content


def test_emits_synthesis_gate_event_after_evidence_budget_reached(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Review agent literature"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "web_fetch", "read_file", "canvas_write"],
            tool_state={"web_search": True, "web_fetch": True, "read_file": True, "canvas_write": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search", "web_fetch", "read_file"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
        ),
        lambda model_request: AIMessage(content="Final answer"),
    )

    assert events[0]["type"] == "synthesis_gate"
    assert events[0]["reason"] == "evidence budget reached"
    assert events[0]["completed_evidence_tools"] == 1
    assert events[0]["evidence_limit"] == 1
    assert events[0]["model_calls"] == 0
    assert events[0]["entered_second_handler"] is False
    assert events[0]["second_handler"] is False


def test_forces_final_answer_near_model_call_budget():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Audit this project"),
        AIMessage(content="", tool_calls=[{"name": "web_search", "args": {"query": "x"}, "id": "call_1"}]),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        AIMessage(content="", tool_calls=[{"name": "read_file", "args": {"path": "a"}, "id": "call_2"}]),
        ToolMessage(content="result 2", name="read_file", tool_call_id="call_2"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "read_file", "canvas_write"],
            tool_state={"web_search": True, "read_file": True, "canvas_write": True},
            evidence_tool_limit=10,
            evidence_tools=["web_search", "read_file"],
            progressive_enabled=True,
            model_call_limit=3,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tools == []
    assert "model budget nearly exhausted" in captured["request"].messages[-1].content


def test_plan_submission_failure_stops_before_another_model_call():
    import pytest

    middleware = PlanToolChoiceMiddleware()
    called = False
    messages = [
        HumanMessage(content="Plan this task"),
        ToolMessage(
            content='Error\n__FACETWRITE_EVENT__{"event":{"eventType":"plan_submission_failed","reason":"plan_intake_missing"}}',
            name="plan_clarification_submit",
            tool_call_id="call_1",
            status="error",
        ),
    ]

    def handler(_request):
        nonlocal called
        called = True

    with pytest.raises(RuntimeError, match="plan_intake_missing"):
        middleware.wrap_model_call(request(phase="planning", stage="intake", messages=messages), handler)

    assert called is False


def test_forces_stage_specific_contract_for_the_first_planning_model_call():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(phase="planning"),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice == "plan_clarification_submit"


def test_does_not_repeat_force_after_any_stage_contract_result():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Plan this task"),
        ToolMessage(
            content='Plan ready\n__FACETWRITE_EVENT__{"event":{"eventType":"plan_created"}}',
            name="plan_clarification_submit",
            tool_call_id="call_1",
        ),
    ]

    middleware.wrap_model_call(
        request(phase="planning", stage="intake", messages=messages),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_forces_a_plan_contract_only_once_per_stable_phase_attempt_when_tool_messages_are_missing():
    middleware = PlanToolChoiceMiddleware()
    choices = []

    for _ in range(3):
        middleware.wrap_model_call(
            request(phase="planning", stage="intake", phase_attempt_id="attempt_1"),
            lambda model_request: choices.append(model_request.tool_choice) or AIMessage(content=""),
        )

    assert choices == ["plan_clarification_submit", None, None]


def test_releases_tool_choice_after_expected_initial_plan_event():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Plan this task"),
        ToolMessage(
            content='Question ready\n__FACETWRITE_EVENT__{"event":{"eventType":"plan_waiting_for_user"}}',
            name="plan_clarification_submit",
            tool_call_id="call_1",
        ),
    ]

    middleware.wrap_model_call(
        request(phase="planning", stage="intake", messages=messages),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_releases_tool_choice_after_expected_plan_revision_event():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Revise this plan"),
        ToolMessage(
            content='Plan ready\n__FACETWRITE_EVENT__{"event":{"eventType":"plan_updated"}}',
            name="plan_revision_submit",
            tool_call_id="call_1",
        ),
    ]

    middleware.wrap_model_call(
        request(phase="planning", stage="revise", messages=messages),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_does_not_force_plan_update_during_normal_chat():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(phase="chat"),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_forces_canvas_write_once_for_recognized_canvas_action():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(phase="chat", canvas_action={"requiresTool": True, "operation": "create"}),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice == "canvas_write"


def test_releases_canvas_write_after_tool_result():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Create a Canvas node"),
        ToolMessage(content="Canvas create committed", name="canvas_write", tool_call_id="call_1"),
    ]

    middleware.wrap_model_call(
        request(phase="chat", canvas_action={"requiresTool": True, "operation": "create"}, messages=messages),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_does_not_force_artifact_stage_after_execution_text():
    middleware = PlanToolChoiceMiddleware()
    choices = []

    def handler(model_request):
        choices.append(model_request.tool_choice)
        if model_request.tool_choice == "artifact_stage":
            return AIMessage(content="", tool_calls=[{
                "id": "call_artifact",
                "name": "artifact_stage",
                "args": {"planId": "plan_1", "artifacts": []},
                "type": "tool_call",
            }])
        return AIMessage(content="Finished without writing Canvas")

    result = middleware.wrap_model_call(request(phase="execution"), handler)

    assert choices == [None]
    assert result.content == "Finished without writing Canvas"


def test_allows_execution_research_tools_before_artifact_staging():
    middleware = PlanToolChoiceMiddleware()
    choices = []

    def handler(model_request):
        choices.append(model_request.tool_choice)
        return AIMessage(content="", tool_calls=[{
            "id": "call_search",
            "name": "web_search",
            "args": {"query": "laptops"},
            "type": "tool_call",
        }])

    result = middleware.wrap_model_call(request(phase="execution"), handler)

    assert choices == [None]
    assert result.tool_calls[0]["name"] == "web_search"


def test_does_not_force_another_artifact_after_artifact_stage_returns():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Execute this step"),
        ToolMessage(content="Artifact committed", name="artifact_stage", tool_call_id="call_1"),
    ]

    middleware.wrap_model_call(
        request(phase="execution", messages=messages),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice is None


def test_budget_retry_forces_final_answer_when_model_keeps_requesting_tools(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    calls = []
    events = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append([tool.name for tool in model_request.tools])
        if len(calls) == 1:
            return AIMessage(content="", tool_calls=[{
                "id": "call_search",
                "name": "web_search",
                "args": {"query": "more"},
                "type": "tool_call",
            }])
        return AIMessage(content="Final answer from existing evidence")

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)
    result = middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            progressive_enabled=True,
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            force_synthesis_after_evidence=True,
        ),
        handler,
    )

    assert calls == [[], []]
    assert result.content == "Final answer from existing evidence"
    assert [event["second_handler"] for event in events if event["type"] == "synthesis_gate"] == [False, True, True]
    assert [event["entered_second_handler"] for event in events if event["type"] == "synthesis_gate"] == [False, True, True]


def test_budget_retry_fails_if_model_still_requests_tools():
    middleware = PlanToolChoiceMiddleware()
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(_model_request):
        return AIMessage(content="", tool_calls=[{
            "id": "call_search",
            "name": "web_search",
            "args": {"query": "more"},
            "type": "tool_call",
        }])

    with pytest.raises(RuntimeError, match="runtime budget exhausted"):
        middleware.wrap_model_call(
            request(
                phase="chat",
                messages=messages,
                progressive_enabled=True,
                evidence_tool_limit=1,
                evidence_tools=["web_search"],
                force_synthesis_after_evidence=True,
            ),
            handler,
        )


def test_budget_retry_forces_final_answer_when_model_emits_text_tool_protocol():
    middleware = PlanToolChoiceMiddleware()
    calls = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append([tool.name for tool in model_request.tools])
        if len(calls) == 1:
            return AIMessage(content='< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">')
        return AIMessage(content="Final answer from existing evidence")

    result = middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            progressive_enabled=True,
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            force_synthesis_after_evidence=True,
        ),
        handler,
    )

    assert calls == [[], []]
    assert result.content == "Final answer from existing evidence"


def test_budget_retry_fails_if_model_still_emits_text_tool_protocol():
    middleware = PlanToolChoiceMiddleware()
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(_model_request):
        return AIMessage(content='< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">')

    with pytest.raises(RuntimeError, match="runtime budget exhausted"):
        middleware.wrap_model_call(
            request(
                phase="chat",
                messages=messages,
                progressive_enabled=True,
                evidence_tool_limit=1,
                evidence_tools=["web_search"],
                force_synthesis_after_evidence=True,
            ),
            handler,
        )
