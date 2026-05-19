"""Unit tests for the DuckDuckGo community web search tool."""

from unittest.mock import MagicMock, patch


def test_web_search_reads_timeout_and_backend_from_config():
    with patch("deerflow.community.ddg_search.tools.get_app_config") as mock_config:
        tool_config = MagicMock()
        tool_config.model_extra = {
            "max_results": 3,
            "timeout": 6,
            "backend": "yandex",
        }
        mock_config.return_value.get_tool_config.return_value = tool_config

        with patch("deerflow.community.ddg_search.tools._search_text") as mock_search:
            mock_search.return_value = [
                {"title": "Result", "href": "https://example.com", "body": "Snippet"},
            ]

            from deerflow.community.ddg_search.tools import web_search_tool

            web_search_tool.invoke({"query": "latest news", "max_results": 8})

    mock_search.assert_called_once_with(
        query="latest news",
        max_results=3,
        timeout=6,
        backend="yandex",
    )
