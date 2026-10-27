"""报告写作代理：与 LLM 对话，先出大纲，再逐节写结构化正文。

与通用审计会话分离：工具只作用于当前报告（body.json），对话记录写报告目录，
不进入会话列表。模型只负责内容与结构，格式由模板骨架在导出时保证。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from . import doc_chat
from ..errors import ApiError
from ..store import report_docs
from ..store.report_verify import verify_report

MAX_STEPS = doc_chat.MAX_STEPS
_CONTEXT_FORM_CHARS = 1500


class OutlineItem(BaseModel):
    title: str = Field(description="章节标题，例如「一、基本情况」")
    level: int = Field(default=1, description="层级：1 或 2")
    goal: str = Field(default="", description="这一节写什么、引用哪些取证单")


class SetOutlineArgs(BaseModel):
    sections: list[OutlineItem] = Field(description="完整章节列表，顺序即报告顺序")


class BlockItem(BaseModel):
    type: str = Field(description="paragraph | bullets | table")
    text: str | None = Field(default=None, description="paragraph 的正文")
    items: list[str] = Field(default_factory=list, description="bullets 的条目")
    columns: list[str] = Field(default_factory=list, description="table 的表头")
    rows: list[list[str]] = Field(default_factory=list, description="table 的数据行")
    sourceRefs: list[str] = Field(
        default_factory=list, description="来源取证单编号，如 ['QZ-0001']"
    )
    origin: str | None = Field(
        default=None, description="form（取证单） | user（用户指令） | model"
    )


class WriteSectionArgs(BaseModel):
    section_id: str = Field(description="章节 id，例如 S1")
    blocks: list[BlockItem] = Field(
        description=(
            "内容块数组。paragraph 用 text；bullets 用 items；table 用 columns + rows。"
            "每个块都要带 sourceRefs；用户直接要求的内容用 origin='user'。"
        )
    )


class TitleArgs(BaseModel):
    title: str


def _dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _compact_skeleton(skeleton: dict[str, Any]) -> dict[str, Any]:
    return {
        "confidence": skeleton.get("confidence"),
        "title": (skeleton.get("title") or {}).get("text"),
        "body": {
            key: (skeleton.get("body") or {}).get(key)
            for key in ("eastAsia", "size", "lineSpacing")
        },
        "headings": [
            {"level": item.get("level"), "sample": (item.get("style") or {}).get("eastAsia")}
            for item in skeleton.get("headings") or []
        ],
        "sections": [
            {
                "title": item.get("title"),
                "level": item.get("level"),
                "sampleText": (item.get("sampleText") or [])[:1],
            }
            for item in skeleton.get("sections") or []
        ],
        "tables": [
            {"columns": item.get("columns"), "headers": item.get("headers")}
            for item in skeleton.get("tables") or []
        ],
        "warnings": skeleton.get("warnings") or [],
    }


def _compact_forms(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    forms: list[dict[str, Any]] = []
    for form in manifest.get("formsSnapshot") or []:
        findings = []
        for finding in form.get("findings") or []:
            findings.append(
                {
                    "编号": finding.get("id"),
                    "标题": finding.get("title"),
                    "描述": str(finding.get("description") or "")[:_CONTEXT_FORM_CHARS],
                    "风险": finding.get("severity"),
                    "状态": finding.get("status"),
                    "科目": finding.get("subjects"),
                    "金额": finding.get("amount"),
                    "币种": finding.get("currency"),
                    "证据": (finding.get("evidence") or [])[:10],
                }
            )
        forms.append(
            {
                "编号": form.get("id"),
                "标题": form.get("title"),
                "编制人": (form.get("header") or {}).get("preparedBy"),
                "回执": (form.get("receipt") or {}).get("name"),
                "疑点": findings,
            }
        )
    return forms


def _compact_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in blocks:
        kind = block.get("type")
        item: dict[str, Any]
        if kind == "paragraph":
            item = {"类型": "paragraph", "文本": block.get("text") or ""}
        elif kind == "bullets":
            item = {"类型": "bullets", "条目": block.get("items") or []}
        elif kind == "table":
            item = {
                "类型": "table",
                "表头": block.get("columns") or [],
                "行": block.get("rows") or [],
            }
        else:
            continue
        refs = block.get("sourceRefs") or []
        if refs:
            item["来源"] = refs
        if block.get("origin"):
            item["提供方"] = block.get("origin")
        out.append(item)
    return out


def _body_snapshot(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "标题": body.get("title"),
        "大纲已确认": body.get("outlineApproved"),
        "章节": [
            {
                "id": section.get("id"),
                "标题": section.get("title"),
                "层级": section.get("level"),
                "要点": section.get("goal"),
                "内容": _compact_blocks(list(section.get("blocks") or [])),
            }
            for section in body.get("sections") or []
        ],
    }


def build_context(root: Path, report_id: str) -> dict[str, Any]:
    doc = report_docs.get_document(root, report_id)
    body = doc["body"]
    return {
        "报告": {"标题": body.get("title"), "大纲已确认": body.get("outlineApproved")},
        "模板骨架": _compact_skeleton(doc["skeleton"] or {}),
        "选中取证单": _compact_forms(doc["manifest"]),
        "当前大纲": [
            {
                "id": section.get("id"),
                "标题": section.get("title"),
                "层级": section.get("level"),
                "要点": section.get("goal"),
                "状态": "已写" if section.get("blocks") else "空",
                "块数": len(section.get("blocks") or []),
            }
            for section in body.get("sections") or []
        ],
        "当前正文": _body_snapshot(body),
        "校验": verify_report(root, report_id),
    }


def _tools(root: Path, report_id: str) -> list[StructuredTool]:
    def context() -> str:
        return _dump(build_context(root, report_id))

    def set_outline(sections: list[OutlineItem]) -> str:
        body = report_docs.set_outline(
            root,
            report_id,
            [item.model_dump() for item in sections],
            approved=False,
        )
        return _dump(
            {
                "ok": True,
                "outline": [
                    {"id": section["id"], "title": section["title"], "level": section["level"]}
                    for section in body.get("sections") or []
                ],
                "note": "大纲已保存，等待用户在预览区确认后才能写入正文。",
            }
        )

    def write_section(section_id: str, blocks: list[BlockItem]) -> str:
        current = report_docs.get_document(root, report_id)["body"]
        if not current.get("outlineApproved"):
            return _dump(
                {
                    "ok": False,
                    "code": "E_OUTLINE_NOT_APPROVED",
                    "message": "大纲尚未确认，请先请用户在右侧预览区确认大纲。",
                }
            )
        section = report_docs.write_section(
            root,
            report_id,
            section_id,
            [block.model_dump(exclude_none=True) for block in blocks],
        )
        return _dump(
            {
                "ok": True,
                "sectionId": section["id"],
                "title": section["title"],
                "blocks": len(section.get("blocks") or []),
            }
        )

    def set_title(title: str) -> str:
        report_docs.set_title(root, report_id, title)
        return _dump({"ok": True, "title": title})

    def check() -> str:
        return _dump(verify_report(root, report_id))

    return [
        StructuredTool.from_function(
            func=context,
            name="report_context",
            description=(
                "读取当前报告的全部上下文：模板骨架（章节与样式）、选中的取证单及其疑点、"
                "当前大纲、校验结果。每次开始写作或需要确认事实时先调用。"
            ),
        ),
        StructuredTool.from_function(
            func=set_outline,
            name="report_set_outline",
            description=(
                "保存报告大纲（章节标题、层级、写作要点）。先出大纲让用户确认；"
                "确认前不要写正文。"
            ),
            args_schema=SetOutlineArgs,
        ),
        StructuredTool.from_function(
            func=write_section,
            name="report_write_section",
            description=(
                "写入或覆盖某一章节的内容块。每个段落必须带 sourceRefs（取证单编号），"
                "用户直接提供的内容用 origin='user'。"
            ),
            args_schema=WriteSectionArgs,
        ),
        StructuredTool.from_function(
            func=set_title,
            name="report_set_title",
            description="修改报告标题。",
            args_schema=TitleArgs,
        ),
        StructuredTool.from_function(
            func=check,
            name="report_verify",
            description="运行报告校验，返回错误与警告；导出前必须通过。",
        ),
    ]


def system_prompt(report_title: str, locale: str | None) -> str:
    language = "中文" if (locale or "zh").lower().startswith("zh") else "英文"
    return f"""你是审计项目报告的写作助手，正在协助撰写《{report_title}》。

工作方式：
1. 先调用 report_context 读取模板骨架、选中的取证单、当前大纲与校验结果。
2. 若还没有大纲，调用 report_set_outline 给出章节大纲（标题、层级、每节要点），然后请用户在右侧预览区确认。确认前不要写正文。
3. 用户确认后，按章节调用 report_write_section 逐节写入。每写完一节简要说明依据。
4. 全部写完后调用 report_verify；如果返回错误，按错误提示修正后再校验。
5. 用户可能在右侧预览区直接编辑正文。每次写入前以「当前报告正文」为准；未明确要求修改的章节和内容块必须原样保留，不得覆盖用户的手动修改。
6. 用户每轮发送时可以增删「选中取证单」。以本轮注入的「选中取证单」为唯一可用范围，并按用户要求同步改写报告：新增取证单时补充依据，移除取证单时删除或改写对其的引用。

硬性规则：
- 只能使用「选中取证单」里的事实与用户明确给出的信息。不得编造金额、日期、编号、单位名称。
- 每个 paragraph 块必须带 sourceRefs（来源取证单编号，如 ["QZ-0001"]）；用户口述的内容用 origin="user"。
- 报告中的金额、日期、编号必须与取证单一致；不确定就写「待确认」，不要猜。
- 结构按模板骨架的章节顺序；模板没有的章节不要硬加，除非用户要求。
- 语言为{language}，公文风格，简洁、客观，不用第一人称。
- 不要输出 Markdown 表格；表格用 type="table" 的块。
"""


def _load_history(root: Path, report_id: str) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for entry in report_docs.load_chat(root, report_id, limit=20):
        content = str(entry.get("content") or "").strip()
        if not content:
            continue
        if entry.get("role") == "user":
            messages.append(HumanMessage(content=content))
        elif entry.get("role") == "assistant":
            messages.append(AIMessage(content=content))
    return messages


async def stream_report_chat(
    root: Path,
    report_id: str,
    message: str,
    *,
    model_id: str | None = None,
    locale: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    root = Path(root)
    text = (message or "").strip()
    if not text:
        yield {
            "event": "error",
            "data": {
                "code": "E_EMPTY_MESSAGE",
                "messageKey": "error.emptyMessage",
            },
        }
        return

    doc = report_docs.get_document(root, report_id)
    title = str(doc["body"].get("title") or doc["manifest"].get("title") or report_id)
    selected_forms = _compact_forms(doc["manifest"])

    # 历史要在写入本轮用户消息之前取，否则同一句话会重复发给模型
    history = _load_history(root, report_id)
    report_docs.append_chat(root, report_id, {"role": "user", "content": text})
    yield {"event": "status", "data": {"phase": "thinking"}}

    try:
        from ..config.models import build_chat_model

        model = build_chat_model(root, model_id)
        tools = _tools(root, report_id)
        tool_map = {tool.name: tool for tool in tools}

        messages: list[BaseMessage] = [
            SystemMessage(content=system_prompt(title, locale)),
            SystemMessage(
                content=(
                    "当前报告正文（用户可能在预览区手动修改过，以此为准）：\n"
                    + _dump(_body_snapshot(doc["body"]))
                )
            ),
            SystemMessage(
                content=(
                    "本轮选中取证单（以此为准；用户可能刚增删，增删后需同步改写正文）：\n"
                    + _dump(selected_forms)
                )
            ),
            *history,
            HumanMessage(content=text),
        ]

        async for event in doc_chat.run_tool_loop(
            model,
            messages,
            tool_map,
            mutated_names={
                "report_set_outline",
                "report_write_section",
                "report_set_title",
            },
            on_assistant_text=lambda content: report_docs.append_chat(
                root, report_id, {"role": "assistant", "content": content}
            ),
            revision=lambda: _revision(root, report_id),
        ):
            yield event
    except ApiError as exc:
        yield {
            "event": "error",
            "data": {"messageKey": exc.message_key, "params": exc.params},
        }
    except Exception as exc:  # 模型/网络错误统一展示
        yield {"event": "error", "data": {"messageKey": "error.opFailed", "detail": str(exc)[:300]}}


def _revision(root: Path, report_id: str) -> str:
    try:
        return str(report_docs.get_document(root, report_id)["body"].get("updatedAt") or "")
    except ApiError:
        return ""
