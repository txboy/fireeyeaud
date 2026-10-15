from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from fireeyeaud_agent.agent.graph import format_llm_request, format_llm_response


def test_format_llm_request_summarizes_images():
    messages = [
        SystemMessage(content="sys"),
        HumanMessage(
            content=[
                {"type": "text", "text": "看图"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,AAAAAAAA"},
                },
            ]
        ),
    ]
    out = format_llm_request(messages, step=1)
    assert "step 1" in out
    assert "SystemMessage: sys" in out
    assert "看图" in out
    assert "data:image/png;base64" in out
    # 图像正文（base64）不应落日志。
    assert "AAAAAAAA" not in out


def test_format_llm_request_caps_long_text():
    long = "x" * 5000
    out = format_llm_request([HumanMessage(content=long)])
    assert "截断" in out
    assert len(out) < 5000


def test_format_llm_response_reports_empty_content():
    out = format_llm_response(AIMessage(content=""), step=1)
    assert "content: <空>" in out
    assert "tool_calls=0" in out


def test_format_llm_response_reports_tools_and_reasoning():
    ai = AIMessage(
        content="",
        tool_calls=[{"name": "sql_query", "args": {"sql": "select 1"}, "id": "c1"}],
        additional_kwargs={"reasoning_content": "我需要先看表结构"},
    )
    out = format_llm_response(ai, step=2)
    assert "tool_calls=1" in out
    assert "sql_query" in out
    assert "reasoning: 我需要先看表结构" in out
