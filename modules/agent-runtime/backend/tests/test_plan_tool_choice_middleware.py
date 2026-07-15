from types import SimpleNamespace
from typing import NotRequired, get_origin, get_type_hints

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from deerflow.agents.middlewares.plan_tool_choice_middleware import PlanToolChoiceMiddleware
from deerflow.agents.thread_state import ThreadState, merge_evidence_tool_calls_used


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
def write_file(path: str, content: str) -> str:
    """Write a file."""
    return path


@tool
def present_files(paths: list) -> str:
    """Present generated files."""
    return ",".join(paths)


@tool
def ask_clarification(question: str, options: list) -> str:
    """Ask a structured clarification."""
    return question


def request(*, phase: str, stage: str | None = None, messages=None, canvas_action=None, phase_attempt_id=None,
            allowed_tool_refs=None, tool_state=None, evidence_tool_limit=None, evidence_tools=None,
            progressive_enabled=None, model_call_limit=None, recursion_limit=None, synthesis_reserve_steps=None,
            force_synthesis_after_evidence=None, body_draft_write_limit=None, body_draft_writes_used=None,
            force_synthesis_after_body_drafts=None, clarification_policy=None, markdown_file_delivery_required=None,
            thinking_disabled_for_tool_choice_compatibility=None, state=None):
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
        "facetwrite_markdown_file_delivery_required": markdown_file_delivery_required,
        "facetwrite_thinking_disabled_for_tool_choice_compatibility": thinking_disabled_for_tool_choice_compatibility,
        "facetwrite_thinking_disabled_reason": "plan_intake",
    })
    initial_messages = messages or [HumanMessage(content="Plan this task")]
    initial_state = state if state is not None else {"messages": initial_messages}
    initial_tools = [plan_update, plan_clarification_submit, plan_revision_submit, web_search, web_fetch, read_file, artifact_stage, canvas_write, write_file, present_files, ask_clarification]

    def build(current_messages, current_tools, current_tool_choice=None):
        return SimpleNamespace(
            runtime=runtime,
            messages=current_messages,
            tools=current_tools,
            tool_choice=current_tool_choice,
            state=initial_state,
            override=lambda **changes: build(
                changes.get("messages", current_messages),
                changes.get("tools", current_tools),
                changes.get("tool_choice", current_tool_choice),
            ),
        )

    return build(initial_messages, initial_tools)


def test_thread_state_evidence_tool_count_reducer_is_monotonic():
    annotation = get_type_hints(ThreadState, include_extras=True)["evidence_tool_calls_used"]

    assert get_origin(annotation) is NotRequired
    assert merge_evidence_tool_calls_used(4, 2) == 4
    assert merge_evidence_tool_calls_used(4, 7) == 7


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


def test_filters_preflight_tools_to_plan_or_plan_clarification_only():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(
            phase="planning",
            stage="preflight",
            allowed_tool_refs=["plan_clarification_submit", "plan_revision_submit", "web_search", "canvas_write"],
            tool_state={
                "plan_clarification_submit": True,
                "plan_revision_submit": True,
                "web_search": True,
                "canvas_write": True,
            },
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["plan_clarification_submit", "plan_revision_submit"]


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


def test_keeps_evidence_tools_after_total_budget_reached():
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

    assert [tool.name for tool in captured["request"].tools] == ["web_search", "web_fetch", "read_file", "canvas_write"]


def test_runtime_budget_prefers_persisted_evidence_count_when_messages_were_summarized():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=[HumanMessage(content="Continue the research")],
            state={"evidence_tool_calls_used": 2},
            allowed_tool_refs=["web_search", "web_fetch", "canvas_write"],
            tool_state={"web_search": True, "web_fetch": True, "canvas_write": True},
            evidence_tool_limit=2,
            evidence_tools=["web_search", "web_fetch"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]
    assert "evidence budget reached" in captured["request"].messages[-1].content


def test_runtime_budget_uses_message_count_when_it_exceeds_initialized_persisted_count():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Continue the research"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        ToolMessage(content="result 2", name="web_fetch", tool_call_id="call_2"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            state={"evidence_tool_calls_used": 0},
            allowed_tool_refs=["web_search", "web_fetch", "canvas_write"],
            tool_state={"web_search": True, "web_fetch": True, "canvas_write": True},
            evidence_tool_limit=2,
            evidence_tools=["web_search", "web_fetch"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]


def test_after_model_truncates_excess_evidence_calls_and_keeps_other_tools():
    middleware = PlanToolChoiceMiddleware()
    runtime = SimpleNamespace(context={
        "facetwrite_plan_phase": "chat",
        "facetwrite_progressive_canvas_delivery_enabled": True,
        "facetwrite_evidence_tool_limit": 2,
        "facetwrite_evidence_tools": ["web_search", "web_fetch"],
    })
    last_message = AIMessage(
        content="",
        tool_calls=[
            {"id": "call_search", "name": "web_search", "args": {"query": "one"}, "type": "tool_call"},
            {"id": "call_canvas", "name": "canvas_write", "args": {"operation": "create"}, "type": "tool_call"},
            {"id": "call_fetch", "name": "web_fetch", "args": {"url": "https://example.com"}, "type": "tool_call"},
        ],
        additional_kwargs={"tool_calls": [
            {"id": "call_search"},
            {"id": "call_canvas"},
            {"id": "call_fetch"},
        ]},
    )

    update = middleware.after_model(
        {"messages": [HumanMessage(content="Research"), last_message], "evidence_tool_calls_used": 1},
        runtime,
    )

    assert update is not None
    assert update["evidence_tool_calls_used"] == 2
    replacement = update["messages"][0]
    assert [call["name"] for call in replacement.tool_calls] == ["web_search", "canvas_write"]
    assert [call["id"] for call in replacement.additional_kwargs["tool_calls"]] == ["call_search", "call_canvas"]


def test_after_model_emits_terminal_event_for_pruned_evidence_call(monkeypatch: pytest.MonkeyPatch):
    events: list[dict] = []
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)
    middleware = PlanToolChoiceMiddleware()
    runtime = SimpleNamespace(context={
        "facetwrite_plan_phase": "chat",
        "facetwrite_progressive_canvas_delivery_enabled": True,
        "facetwrite_evidence_tool_limit": 2,
        "facetwrite_evidence_tools": ["web_search", "web_fetch"],
    })
    last_message = AIMessage(content="", tool_calls=[
        {"id": "call_search", "name": "web_search", "args": {"query": "one"}, "type": "tool_call"},
        {"id": "call_fetch", "name": "web_fetch", "args": {"url": "https://example.com"}, "type": "tool_call"},
    ])

    middleware.after_model(
        {"messages": [HumanMessage(content="Research"), last_message], "evidence_tool_calls_used": 1},
        runtime,
    )

    assert events == [{
        "type": "tool_call_pruned",
        "phase": "budget_synthesis",
        "reason": "evidence_budget",
        "tool_call_id": "call_fetch",
        "tool_name": "web_fetch",
    }]


@pytest.mark.asyncio
async def test_aafter_model_uses_message_count_when_it_exceeds_initialized_persisted_count():
    middleware = PlanToolChoiceMiddleware()
    runtime = SimpleNamespace(context={
        "facetwrite_plan_phase": "chat",
        "facetwrite_progressive_canvas_delivery_enabled": True,
        "facetwrite_evidence_tool_limit": 1,
        "facetwrite_evidence_tools": ["web_search"],
    })
    last_message = AIMessage(content="", tool_calls=[
        {"id": "call_search", "name": "web_search", "args": {"query": "more"}, "type": "tool_call"},
        {"id": "call_canvas", "name": "canvas_write", "args": {"operation": "create"}, "type": "tool_call"},
    ])

    update = await middleware.aafter_model(
        {
            "messages": [
                ToolMessage(content="result", name="web_search", tool_call_id="completed_search"),
                last_message,
            ],
            "evidence_tool_calls_used": 0,
        },
        runtime,
    )

    assert update is not None
    assert update["evidence_tool_calls_used"] == 1
    assert [call["name"] for call in update["messages"][0].tool_calls] == ["canvas_write"]


def test_adds_budget_notice_after_evidence_budget_reached_and_removes_exploration_tools():
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

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]
    assert "runtime budget notice" in captured["request"].messages[-1].content
    assert "Do not call additional research or workspace inspection tools" in captured["request"].messages[-1].content


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


def test_emits_synthesis_gate_when_runtime_step_reserve_is_reached(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Research this"),
        AIMessage(content="Searching"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        AIMessage(content="Drafting"),
    ]

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "read_file"],
            tool_state={"web_search": True, "read_file": True},
            progressive_enabled=True,
            recursion_limit=6,
            synthesis_reserve_steps=2,
        ),
        lambda model_request: AIMessage(content="Final answer"),
    )

    assert events[0]["type"] == "synthesis_gate"
    assert events[0]["reason"] == "runtime step reserve reached"
    assert events[0]["recursion_limit"] == 6
    assert events[0]["estimated_steps_used"] == 11


def test_runtime_budget_file_delivery_keeps_finalization_tools_and_adds_delivery_notice():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Write a complete report"),
        AIMessage(content="Searching"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        AIMessage(content="Drafting"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "read_file", "write_file", "present_files"],
            tool_state={"web_search": True, "read_file": True, "write_file": True, "present_files": True},
            progressive_enabled=True,
            recursion_limit=6,
            synthesis_reserve_steps=2,
            markdown_file_delivery_required=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["write_file", "present_files"]
    assert "complete user deliverable" in captured["request"].messages[-1].content
    assert "Do not write a delivery note" in captured["request"].messages[-1].content


def test_runtime_budget_required_canvas_action_keeps_canvas_write_and_adds_action_notice():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Write this to Canvas"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            canvas_action={"id": "canvas_action_1", "operation": "replace", "requiresTool": True},
            allowed_tool_refs=["web_search", "canvas_write", "write_file", "present_files"],
            tool_state={"web_search": True, "canvas_write": True, "write_file": True, "present_files": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write", "write_file", "present_files"]
    assert "required Canvas action" in captured["request"].messages[-1].content
    assert "canvas_write" in captured["request"].messages[-1].content
    assert "Do not finish with text only" in captured["request"].messages[-1].content


def test_runtime_budget_allows_file_finalization_tool_calls_after_notice(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Write a complete report"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        assert [tool.name for tool in model_request.tools] == ["write_file", "present_files"]
        return AIMessage(content="", tool_calls=[{
            "id": "call_write",
            "name": "write_file",
            "args": {"path": "/mnt/user-data/outputs/report.md", "content": "Report"},
            "type": "tool_call",
        }])

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    result = middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "write_file", "present_files"],
            tool_state={"web_search": True, "write_file": True, "present_files": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=True,
        ),
        handler,
    )

    assert result.tool_calls[0]["name"] == "write_file"
    synthesis_events = [event for event in events if event["type"] == "synthesis_gate"]
    assert not any(event.get("continued_after_notice") for event in synthesis_events)


def test_runtime_budget_allows_canvas_write_after_notice(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Write this to Canvas"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        assert [tool.name for tool in model_request.tools] == ["canvas_write", "write_file", "present_files"]
        return AIMessage(content="", tool_calls=[{
            "id": "call_canvas",
            "name": "canvas_write",
            "args": {"operation": "replace", "content": "Updated Canvas content"},
            "type": "tool_call",
        }])

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    result = middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            canvas_action={"id": "canvas_action_1", "operation": "replace", "requiresTool": True},
            allowed_tool_refs=["web_search", "canvas_write", "write_file", "present_files"],
            tool_state={"web_search": True, "canvas_write": True, "write_file": True, "present_files": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=True,
        ),
        handler,
    )

    assert result.tool_calls[0]["name"] == "canvas_write"
    synthesis_events = [event for event in events if event["type"] == "synthesis_gate"]
    assert synthesis_events[-1]["continued_after_notice"] is True
    assert synthesis_events[-1]["allowed"] is True
    assert synthesis_events[-1]["blocked_tool_calls"] is False


def test_runtime_budget_returns_after_successful_present_files_without_notice_or_gate(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    events = []
    messages = [
        HumanMessage(content="Write a complete report"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        ToolMessage(content="Successfully presented files.", name="present_files", tool_call_id="call_2", status="success"),
    ]

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "write_file", "present_files"],
            tool_state={"web_search": True, "write_file": True, "present_files": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].messages == messages
    assert events == []


def test_runtime_budget_recognizes_present_files_success_by_matching_tool_call_id(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    events = []
    messages = [
        HumanMessage(content="Write a complete report"),
        AIMessage(content="", tool_calls=[{"name": "present_files", "args": {"filepaths": ["/mnt/user-data/outputs/report.md"]}, "id": "call_present"}]),
        ToolMessage(content="Successfully presented files.", tool_call_id="call_present", status="success"),
    ]

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["present_files"],
            tool_state={"present_files": True},
            progressive_enabled=True,
            model_call_limit=1,
            markdown_file_delivery_required=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].messages == messages
    assert events == []


def test_runtime_budget_does_not_skip_gate_when_error_follows_present_files(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Write a complete report"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
        ToolMessage(content="Successfully presented files.", name="present_files", tool_call_id="call_2", status="success"),
        ToolMessage(content="Error: later failure", name="write_file", tool_call_id="call_3", status="error"),
    ]

    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            allowed_tool_refs=["web_search", "write_file", "present_files"],
            tool_state={"web_search": True, "write_file": True, "present_files": True},
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            progressive_enabled=True,
            force_synthesis_after_evidence=True,
        ),
        lambda model_request: AIMessage(content="Final answer"),
    )

    assert events[0]["type"] == "synthesis_gate"


def test_adds_budget_notice_near_model_call_budget_and_removes_exploration_tools():
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

    assert [tool.name for tool in captured["request"].tools] == ["canvas_write"]
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


def test_forced_tool_choice_emits_thinking_compatibility_signal(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    events = []
    captured = {}
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="planning",
            thinking_disabled_for_tool_choice_compatibility=True,
        ),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice == "plan_clarification_submit"
    assert events == [{
        "type": "thinking_disabled_for_tool_choice_compatibility",
        "phase": "planning",
        "planId": None,
        "stepId": None,
        "tool_choice": "plan_clarification_submit",
        "reason": "plan_intake",
    }]


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


def test_budget_notice_retries_once_then_uses_final_text(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    calls = []
    events = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append(model_request)
        if len(calls) == 1:
            return AIMessage(content="", tool_calls=[{
                "id": "call_search",
                "name": "web_search",
                "args": {"query": "more"},
                "type": "tool_call",
            }])
        return AIMessage(content="Final synthesized answer.")

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

    assert [[tool.name for tool in call.tools] for call in calls] == [["canvas_write"], ["canvas_write"]]
    assert calls[1].messages[-1].additional_kwargs["facetwrite_budget_finalization_retry"] == 1
    assert result.content == "Final synthesized answer."
    assert "runtime budget gate" not in result.content
    synthesis_events = [event for event in events if event["type"] == "synthesis_gate"]
    assert synthesis_events[-1]["continued_after_notice"] is True
    assert synthesis_events[-1]["finalization_retry_count"] == 1
    assert "finalization_retry_exhausted" not in synthesis_events[-1]


def test_budget_notice_uses_enhanced_prompts_for_retry_counts_two_through_four():
    middleware = PlanToolChoiceMiddleware()
    calls = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append(model_request)
        if len(calls) <= 4:
            return AIMessage(content="", tool_calls=[{
                "id": f"call_search_{len(calls)}",
                "name": "web_search",
                "args": {"query": "more"},
                "type": "tool_call",
            }])
        return AIMessage(content="Final synthesized answer after retries.")

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

    assert len(calls) == 5
    assert result.content == "Final synthesized answer after retries."
    retry_messages = [call.messages[-1].content for call in calls[1:]]
    assert "exploration and workspace inspection tools are unavailable" in retry_messages[0]
    assert all("previous output still attempted unavailable tools" in message for message in retry_messages[1:])


def test_budget_notice_exhausts_after_five_finalization_retries(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    calls = []
    events = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append(model_request)
        return AIMessage(content="", tool_calls=[{
            "id": f"call_search_{len(calls)}",
            "name": "web_search",
            "args": {"query": "more"},
            "type": "tool_call",
        }])

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

    assert len(calls) == 5
    assert not getattr(result, "tool_calls", None)
    assert "Budget finalization retry limit reached" in result.content
    synthesis_events = [event for event in events if event["type"] == "synthesis_gate"]
    assert [event["second_handler"] for event in synthesis_events] == [False] * 6
    assert synthesis_events[-1]["continued_after_notice"] is True
    assert synthesis_events[-1]["allowed"] is False
    assert synthesis_events[-1]["blocked_tool_calls"] is True
    assert synthesis_events[-1]["contains_tool_call"] is True
    assert synthesis_events[-1]["finalization_retry_count"] == 5
    assert synthesis_events[-1]["finalization_retry_limit"] == 5
    assert synthesis_events[-1]["finalization_retry_exhausted"] is True


@pytest.mark.parametrize(
    ("tool_name", "args", "markdown_file_delivery_required"),
    [
        ("canvas_write", {"operation": "create", "content": "Final"}, None),
        ("write_file", {"path": "/mnt/user-data/outputs/report.md", "content": "Final"}, True),
        ("present_files", {"paths": ["/mnt/user-data/outputs/report.md"]}, True),
    ],
)
def test_budget_notice_allows_finalization_tools(tool_name: str, args: dict, markdown_file_delivery_required: bool | None):
    middleware = PlanToolChoiceMiddleware()
    calls = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append(model_request)
        return AIMessage(content="", tool_calls=[{
            "id": f"call_{tool_name}",
            "name": tool_name,
            "args": args,
            "type": "tool_call",
        }])

    result = middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            progressive_enabled=True,
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=markdown_file_delivery_required,
        ),
        handler,
    )

    assert len(calls) == 1
    assert getattr(result, "tool_calls", None)
    assert result.tool_calls[0]["name"] == tool_name


@pytest.mark.parametrize(
    ("tool_name", "args"),
    [
        ("write_file", {"path": "/mnt/user-data/outputs/report.md", "content": "Final"}),
        ("present_files", {"paths": ["/mnt/user-data/outputs/report.md"]}),
    ],
)
def test_legal_file_finalization_does_not_report_continued_after_notice(
    monkeypatch: pytest.MonkeyPatch,
    tool_name: str,
    args: dict,
):
    middleware = PlanToolChoiceMiddleware()
    events = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    middleware.wrap_model_call(
        request(
            phase="chat",
            messages=messages,
            progressive_enabled=True,
            evidence_tool_limit=1,
            evidence_tools=["web_search"],
            force_synthesis_after_evidence=True,
            markdown_file_delivery_required=True,
        ),
        lambda _request: AIMessage(content="", tool_calls=[{
            "id": f"call_{tool_name}",
            "name": tool_name,
            "args": args,
            "type": "tool_call",
        }]),
    )

    assert not any(event.get("continued_after_notice") for event in events)


def test_budget_notice_retries_internal_tool_protocol_text(monkeypatch: pytest.MonkeyPatch):
    middleware = PlanToolChoiceMiddleware()
    calls = []
    events = []
    messages = [
        HumanMessage(content="Research this"),
        ToolMessage(content="result 1", name="web_search", tool_call_id="call_1"),
    ]

    def handler(model_request):
        calls.append(model_request)
        if len(calls) == 1:
            return AIMessage(content='< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">')
        return AIMessage(content="Final answer after protocol retry.")

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

    assert len(calls) == 2
    assert result.content == "Final answer after protocol retry."
    synthesis_events = [event for event in events if event["type"] == "synthesis_gate"]
    assert synthesis_events[-1]["contains_internal_runtime_protocol"] is True
    assert synthesis_events[-1]["allowed"] is False
