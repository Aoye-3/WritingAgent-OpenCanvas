from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from deerflow.agents.middlewares.plan_tool_choice_middleware import PlanToolChoiceMiddleware


@tool
def plan_update(action: str) -> str:
    """Update the active plan."""
    return action


@tool
def web_search(query: str) -> str:
    """Search the web."""
    return query


@tool
def artifact_stage(planId: str, artifacts: list) -> str:
    """Commit step artifacts to Canvas."""
    return planId


def request(*, phase: str, messages=None):
    runtime = SimpleNamespace(context={"facetwrite_plan_phase": phase})
    return SimpleNamespace(
        runtime=runtime,
        messages=messages or [HumanMessage(content="Plan this task")],
        tools=[plan_update, web_search, artifact_stage],
        tool_choice=None,
        override=lambda **changes: SimpleNamespace(
            runtime=runtime,
            messages=changes.get("messages", messages or [HumanMessage(content="Plan this task")]),
            tools=changes.get("tools", [plan_update, web_search, artifact_stage]),
            tool_choice=changes.get("tool_choice"),
        ),
    )


def test_forces_plan_update_for_the_first_planning_model_call():
    middleware = PlanToolChoiceMiddleware()
    captured = {}

    middleware.wrap_model_call(
        request(phase="planning"),
        lambda model_request: captured.setdefault("request", model_request),
    )

    assert captured["request"].tool_choice == "plan_update"


def test_releases_tool_choice_after_plan_update_returns():
    middleware = PlanToolChoiceMiddleware()
    captured = {}
    messages = [
        HumanMessage(content="Plan this task"),
        ToolMessage(content="Plan ready", name="plan_update", tool_call_id="call_1"),
    ]

    middleware.wrap_model_call(
        request(phase="planning", messages=messages),
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


def test_forces_artifact_stage_when_execution_would_finish_without_canvas_output():
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

    assert choices == [None, "artifact_stage"]
    assert result.tool_calls[0]["name"] == "artifact_stage"


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
