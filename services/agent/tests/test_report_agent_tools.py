"""报告代理：工具读写 body.json，以及流式循环（假模型）。"""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent import report_agent
from fireeyeaud_agent.store import report_docs

from test_report_docs import _create, _form, _workspace


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _tool_map(root, report_id):
    return {tool.name: tool for tool in report_agent._tools(root, report_id)}


def test_tools_read_context_and_write(tmp_path):
    root, template_id = _workspace(tmp_path)
    form_id = _form(root)
    _create(root, template_id, [form_id])
    tools = _tool_map(root, "RPT-0001")

    context = json.loads(tools["report_context"].invoke({}))
    assert context["模板骨架"]["sections"][0]["title"] == "一、基本情况"
    assert context["选中取证单"][0]["编号"] == form_id
    assert context["当前大纲"][0]["状态"] == "空"

    outline = json.loads(
        tools["report_set_outline"].invoke(
            {
                "sections": [
                    {"title": "一、项目概况", "level": 1, "goal": "背景"},
                    {"title": "二、发现", "level": 1, "goal": "问题"},
                ]
            }
        )
    )
    assert outline["ok"] is True
    assert [item["title"] for item in outline["outline"]] == ["一、项目概况", "二、发现"]

    body = report_docs.get_document(root, "RPT-0001")["body"]
    assert body["outlineApproved"] is False

    report_docs.set_outline(
        root,
        "RPT-0001",
        [
            {"id": "S1", "title": "一、项目概况", "level": 1},
            {"id": "S2", "title": "二、发现", "level": 1},
        ],
        approved=True,
    )

    written = json.loads(
        tools["report_write_section"].invoke(
            {
                "section_id": "S2",
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "采购阿里云服务器，费用99元。",
                        "sourceRefs": [form_id],
                    }
                ],
            }
        )
    )
    assert written["blocks"] == 1

    check = json.loads(tools["report_verify"].invoke({}))
    codes = {error["code"] for error in check["errors"]}
    assert "E_SECTION_EMPTY" in codes


def test_write_section_requires_approved_outline(tmp_path):
    root, template_id = _workspace(tmp_path)
    form_id = _form(root)
    _create(root, template_id, [form_id])
    tools = _tool_map(root, "RPT-0001")

    tools["report_set_outline"].invoke(
        {"sections": [{"title": "一、项目概况", "level": 1}]}
    )
    result = json.loads(
        tools["report_write_section"].invoke(
            {
                "section_id": "S1",
                "blocks": [
                    {"type": "paragraph", "text": "还未确认", "sourceRefs": [form_id]}
                ],
            }
        )
    )
    assert result["ok"] is False
    assert result["code"] == "E_OUTLINE_NOT_APPROVED"
    body = report_docs.get_document(root, "RPT-0001")["body"]
    assert body["sections"][0]["blocks"] == []


class _FakeModel:
    def __init__(self) -> None:
        self.calls = 0
        self.seen: list[list] = []

    def bind_tools(self, tools):  # noqa: ANN001
        return self

    async def astream(self, messages):  # noqa: ANN001
        self.seen.append(list(messages))
        self.calls += 1
        if self.calls == 1:
            args = json.dumps(
                {
                    "sections": [
                        {"title": "一、基本情况", "level": 1},
                        {"title": "二、审计发现", "level": 1},
                    ]
                },
                ensure_ascii=False,
            )
            yield AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": "report_set_outline",
                        "args": args,
                        "id": "call-1",
                        "index": 0,
                    }
                ],
            )
        else:
            yield AIMessageChunk(content="大纲已给出，请在右侧确认。")


async def test_stream_chat_runs_tools(tmp_path, monkeypatch):
    root, template_id = _workspace(tmp_path)
    form_id = _form(root)
    _create(root, template_id, [form_id])

    fake = _FakeModel()
    monkeypatch.setattr(report_agent, "build_chat_model", lambda *a, **k: fake)

    events = []
    async for event in report_agent.stream_report_chat(
        root, "RPT-0001", "先给个大纲", locale="zh-CN"
    ):
        events.append(event)

    kinds = [event["event"] for event in events]
    assert "tool" in kinds
    assert "report" in kinds
    assert kinds[-1] == "done"
    deltas = "".join(
        event["data"]["text"] for event in events if event["event"] == "delta"
    )
    assert "大纲" in deltas

    body = report_docs.get_document(root, "RPT-0001")["body"]
    assert [section["title"] for section in body["sections"]] == [
        "一、基本情况",
        "二、审计发现",
    ]
    assert body["outlineApproved"] is False

    chat = report_docs.load_chat(root, "RPT-0001")
    assert chat[0]["role"] == "user"
    assert any(entry["role"] == "assistant" for entry in chat)

    from langchain_core.messages import HumanMessage

    first_turn = [
        message.content
        for message in fake.seen[0]
        if isinstance(message, HumanMessage)
    ]
    assert first_turn.count("先给个大纲") == 1


def test_system_prompt_has_source_rules():
    prompt = report_agent.system_prompt("测试报告", "zh-CN")
    assert "sourceRefs" in prompt
    assert "不得编造" in prompt
    assert "report_set_outline" in prompt
