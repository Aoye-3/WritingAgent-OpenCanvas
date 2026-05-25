from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage

from deerflow.agents.middlewares.dynamic_context_middleware import DynamicContextMiddleware
from deerflow.agents.middlewares.memory_middleware import MemoryMiddleware
from deerflow.config.memory_config import MemoryConfig


def test_dynamic_context_skips_global_memory_when_facetwrite_memory_disabled(monkeypatch):
    monkeypatch.setattr("deerflow.agents.lead_agent.prompt._get_memory_context", lambda *args, **kwargs: "<memory>old project</memory>")
    middleware = DynamicContextMiddleware()
    runtime = SimpleNamespace(context={"facetwrite_memory_enabled": False})

    result = middleware.before_agent({"messages": [HumanMessage(content="hello", id="msg_1")]}, runtime)

    assert result is not None
    reminder = result["messages"][0]
    assert "<current_date>" in reminder.content
    assert "old project" not in reminder.content
    assert "<memory>" not in reminder.content


def test_dynamic_context_injects_facetwrite_managed_memory_when_enabled():
    middleware = DynamicContextMiddleware()
    runtime = SimpleNamespace(
        context={
            "facetwrite_memory_enabled": True,
            "facetwrite_memory_content": "Project-local preference",
        }
    )

    result = middleware.before_agent({"messages": [HumanMessage(content="hello", id="msg_1")]}, runtime)

    assert result is not None
    reminder = result["messages"][0]
    assert "<memory>" in reminder.content
    assert "Project-local preference" in reminder.content


def test_memory_middleware_does_not_queue_when_facetwrite_memory_disabled():
    config = MemoryConfig()
    config.enabled = True
    middleware = MemoryMiddleware(memory_config=config)
    runtime = SimpleNamespace(context={"thread_id": "thread_1", "facetwrite_memory_enabled": False})
    queue = MagicMock()

    with patch("deerflow.agents.middlewares.memory_middleware.get_memory_queue", return_value=queue):
        middleware.after_agent({"messages": [HumanMessage(content="hello"), AIMessage(content="answer")]}, runtime)

    queue.add.assert_not_called()
