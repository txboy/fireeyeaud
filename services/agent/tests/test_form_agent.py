"""取证单代理：上下文含整份模板原文，工具读写 body.json，流式循环可用。"""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage

from fireeyeaud_agent.agent import form_agent
from fireeyeaud_agent.store import form_docs

from test_form_docs import _setup


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _create(root, template_id, finding_id):
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )


def _tools(root):
    return {tool.name: tool for tool in form_agent._tools(root, "QZ-0001")}


def test_context_includes_full_template_text(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    context = json.loads(_tools(root)["form_context"].invoke({}))
    texts = json.dumps(context, ensure_ascii=False)
    assert "{{项目名称}}" in texts
    assert "{{#疑点}}" in texts
    assert context["选中疑点"][0]["编号"] == finding_id
    assert context["当前大纲"][0]["状态"] == "空"


def test_write_section_requires_approved_outline(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    tools = _tools(root)
    tools["form_set_outline"].invoke({"sections": [{"title": "一、事项经过", "level": 1}]})
    result = json.loads(
        tools["form_write_section"].invoke(
            {
                "section_id": "S1",
                "blocks": [
                    {"type": "paragraph", "text": "未确认", "sourceRefs": [finding_id]}
                ],
            }
        )
    )
    assert result["ok"] is False
    assert result["code"] == "E_OUTLINE_NOT_APPROVED"


def test_system_prompt_is_form_specific():
    prompt = form_agent.system_prompt("关联方取证单", "zh-CN")
    assert "form_set_outline" in prompt
    assert "取证单" in prompt
    assert "sourceRefs" in prompt
    assert "不得编造" in prompt


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
            yield AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": "form_set_outline",
                        "args": json.dumps(
                            {"sections": [{"title": "一、事项经过", "level": 1}]},
                            ensure_ascii=False,
                        ),
                        "id": "call-1",
                        "index": 0,
                    }
                ],
            )
        else:
            yield AIMessageChunk(content="大纲已给出，请确认。")


async def test_stream_chat_runs_tools_and_injects_template(tmp_path, monkeypatch):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    fake = _FakeModel()
    monkeypatch.setattr(form_agent, "build_chat_model", lambda *a, **k: fake)

    events = [event async for event in form_agent.stream_form_chat(root, "QZ-0001", "先给大纲")]
    kinds = [event["event"] for event in events]
    assert "tool" in kinds and "report" in kinds
    assert kinds[-1] == "done"

    system_text = "\n".join(
        str(message.content)
        for message in fake.seen[0]
        if isinstance(message, SystemMessage)
    )
    assert "模板原文" in system_text
    assert "{{#疑点}}" in system_text
    assert "当前取证单正文" in system_text

    human = [m.content for m in fake.seen[0] if isinstance(m, HumanMessage)]
    assert human.count("先给大纲") == 1

    body = form_docs.get_document(root, "QZ-0001")["body"]
    assert [s["title"] for s in body["sections"]] == ["一、事项经过"]