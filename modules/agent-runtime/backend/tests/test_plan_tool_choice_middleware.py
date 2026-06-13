from types import SimpleNamespace

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
def artifact_stage(planId: str, artifacts: list) -> str:
    """Commit step artifacts to Canvas."""
    return planId


@tool
def canvas_write(operation: str, content: str) -> str:
    """Write content to Canvas."""
    return operation


def request(*, phase: str, stage: str | None = None, messages=None, canvas_action=None, phase_attempt_id=None,
            allowed_tool_refs=None, tool_state=None):
    runtime = SimpleNamespace(context={
        "facetwrite_plan_phase": phase,
        "facetwrite_plan_stage": stage,
        "facetwrite_plan_phase_attempt_id": phase_attempt_id,
        "facetwrite_canvas_action": canvas_action,
        "facetwrite_allowed_tool_refs": allowed_tool_refs,
        "facetwrite_tool_state": tool_state,
    })
    initial_messages = messages or [HumanMessage(content="Plan this task")]
    initial_tools = [plan_update, plan_clarification_submit, plan_revision_submit, web_search, artifact_stage, canvas_write]

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
