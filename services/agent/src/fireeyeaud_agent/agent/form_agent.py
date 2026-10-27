"""取证单写作代理：与 LLM 对话，先出大纲，再逐节写结构化正文。

模板只作**参考范本**：整份模板原文（含 {{占位符}} 与表格）随每轮注入，模型据此仿写新正文；
导出时不执行模板占位符。工具只作用于当前取证单（body.json），对话记录写取证单目录。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ..errors import ApiError
from ..store import evidence_forms
from ..store import form_docs
from ..store.form_verify import verify_form
from . import doc_chat

MAX_STEPS = doc_chat.MAX_STEPS
_CONTEXT_FINDING_CHARS = 1500

TOOL_NAMES = {
    "context": "form_context",
    "outline": "form_set_outline",
    "section": "form_write_section",
    "title": "form_set_title",
    "verify": "form_verify",
}

_MUTATED = {TOOL_NAMES["outline"], TOOL_NAMES["section"], TOOL_NAMES["title"]}


class OutlineItem(BaseModel):
    title: str = Field(description="章节标题，例如「一、基本情况」")
    level: int = Field(default=1, description="层级：1 或 2")
    goal: str = Field(default="", description="这一节写什么、引用哪些疑点")


class SetOutlineArgs(BaseModel):
    sections: list[OutlineItem] = Field(description="完整章节列表，顺序即取证单顺序")


class BlockItem(BaseModel):
    type: str = Field(description="paragraph | bullets | table")
    text: str | None = Field(default=None, description="paragraph 的正文")
    items: list[str] = Field(default_factory=list, description="bullets 的条目")
    columns: list[str] = Field(default_factory=list, description="table 的表头")
    rows: list[list[str]] = Field(default_factory=list, description="table 的数据行")
    sourceRefs: list[str] = Field(
        default_factory=list, description="来源疑点编号，如 ['F-0001']"
    )
    origin: str | None = Field(
        default=None, description="form（疑点） | user（用户指令） | model"
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
    return doc_chat.dump(data)


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


def _compact_findings(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for finding in manifest.get("findingsSnapshot") or []:
        findings.append(
            {
                "编号": finding.get("id"),
                "标题": finding.get("title"),
                "描述": str(finding.get("description") or "")[:_CONTEXT_FINDING_CHARS],
                "风险": evidence_forms.SEVERITY_LABEL.get(
                    str(finding.get("severity") or ""),
                    str(finding.get("severity") or ""),
                ),
                "状态": evidence_forms.STATUS_LABEL.get(
                    str(finding.get("status") or ""), str(finding.get("status") or "")
                ),
                "科目": finding.get("subjects"),
                "金额": finding.get("amount"),
                "币种": finding.get("currency"),
                "证据": (finding.get("evidence") or [])[:10],
            }
        )
    return findings


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


def build_context(root: Path, form_id: str) -> dict[str, Any]:
    doc = form_docs.get_document(root, form_id)
    body = doc["body"]
    return {
        "取证单": {
            "编号": doc["manifest"].get("id"),
            "标题": body.get("title"),
            "大纲已确认": body.get("outlineApproved"),
        },
        "模板骨架": _compact_skeleton(doc["skeleton"] or {}),
        "模板原文": (doc["skeleton"] or {}).get("templateText") or {"blocks": []},
        "选中疑点": _compact_findings(doc["manifest"]),
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
        "校验": verify_form(root, form_id),
    }


def _tools(root: Path, form_id: str) -> list[StructuredTool]:
    def context() -> str:
        return _dump(build_context(root, form_id))

    def set_outline(sections: list[OutlineItem]) -> str:
        body = form_docs.set_outline(
            root,
            form_id,
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
        current = form_docs.get_document(root, form_id)["body"]
        if not current.get("outlineApproved"):
            return _dump(
                {
                    "ok": False,
                    "code": "E_OUTLINE_NOT_APPROVED",
                    "message": "大纲尚未确认，请先请用户在右侧预览区确认大纲。",
                }
            )
        section = form_docs.write_section(
            root,
            form_id,
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
        form_docs.set_title(root, form_id, title)
        return _dump({"ok": True, "title": title})

    def check() -> str:
        return _dump(verify_form(root, form_id))

    return [
        StructuredTool.from_function(
            func=context,
            name=TOOL_NAMES["context"],
            description=(
                "读取当前取证单的全部上下文：模板骨架与**模板原文**（栏目与表格样式）、"
                "选中的疑点及其事实、当前大纲、校验结果。开始写作或需要确认事实时先调用。"
            ),
        ),
        StructuredTool.from_function(
            func=set_outline,
            name=TOOL_NAMES["outline"],
            description=(
                "保存取证单大纲（章节标题、层级、写作要点）。先出大纲让用户确认；"
                "确认前不要写正文。"
            ),
            args_schema=SetOutlineArgs,
        ),
        StructuredTool.from_function(
            func=write_section,
            name=TOOL_NAMES["section"],
            description=(
                "写入或覆盖某一章节的内容块。每个段落必须带 sourceRefs（疑点编号），"
                "用户直接提供的内容用 origin='user'。"
            ),
            args_schema=WriteSectionArgs,
        ),
        StructuredTool.from_function(
            func=set_title,
            name=TOOL_NAMES["title"],
            description="修改取证单标题。",
            args_schema=TitleArgs,
        ),
        StructuredTool.from_function(
            func=check,
            name=TOOL_NAMES["verify"],
            description="运行取证单校验，返回错误与警告；导出前必须通过。",
        ),
    ]


def system_prompt(form_title: str, locale: str | None) -> str:
    language = "中文" if (locale or "zh").lower().startswith("zh") else "英文"
    return f"""你是审计取证单的写作助手，正在协助撰写《{form_title}》。

工作方式：
1. 先调用 {TOOL_NAMES["context"]} 读取模板骨架、**模板原文**、选中的疑点、当前大纲与校验结果。
2. 仔细读模板原文：它是一份参考范本，说明这张取证单有哪些栏目、标题怎么写、表格怎么排。其中 {{{{占位符}}}} 只是范本里的占位文字，表示那里要写实际内容。
3. 若还没有大纲，调用 {TOOL_NAMES["outline"]} 按范本的栏目给出取证单大纲（标题、层级、每节要点），然后请用户在右侧确认。确认前不要写正文。
4. 用户确认后，按章节调用 {TOOL_NAMES["section"]} 逐节写入。范本里每个疑点排成一段还是汇成一张表，由你根据范本结构和疑点数量决定；表格用 type="table" 的块，不要输出 Markdown 表格。
5. 全部写完后调用 {TOOL_NAMES["verify"]}；如果返回错误，按提示修正后再校验。
6. 用户可能在右侧预览区直接编辑正文。每次写入前以「当前取证单正文」为准；未明确要求修改的章节和内容块必须原样保留。
7. 用户每轮发送时可以增删「选中疑点」。以本轮的选中疑点为准同步改写取证单：新增时补充依据，移除时删除或改写对其的引用。

硬性规则：
- 只能使用「选中疑点」里的事实与用户明确给出的信息。不得编造金额、日期、编号、单位名称。
- 每个 paragraph 块必须带 sourceRefs（来源疑点编号，如 ["F-0001"]）；用户口述的内容用 origin="user"。
- 取证单中的金额、日期、编号必须与疑点一致；不确定就写「待确认」，不要猜。
- 不要在正文里输出任何 {{{{...}}}} 占位符。
- 语言为{language}，公文风格，简洁、客观，不用第一人称。
"""


def _load_history(root: Path, form_id: str) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for entry in form_docs.load_chat(root, form_id, limit=20):
        content = str(entry.get("content") or "").strip()
        if not content:
            continue
        if entry.get("role") == "user":
            messages.append(HumanMessage(content=content))
        elif entry.get("role") == "assistant":
            messages.append(AIMessage(content=content))
    return messages


def _revision(root: Path, form_id: str) -> str:
    try:
        return str(form_docs.get_document(root, form_id)["body"].get("updatedAt") or "")
    except ApiError:
        return ""


async def stream_form_chat(
    root: Path,
    form_id: str,
    message: str,
    *,
    model_id: str | None = None,
    locale: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    root = Path(root)
    text = (message or "").strip()
    if not text:
        yield {"event": "error", "data": {"messageKey": "error.internal"}}
        return

    doc = form_docs.get_document(root, form_id)
    title = str(doc["body"].get("title") or doc["manifest"].get("title") or form_id)
    findings = _compact_findings(doc["manifest"])
    template = (doc["skeleton"] or {}).get("templateText") or {"blocks": []}

    # 历史要在写入本轮用户消息之前取，否则同一句话会重复发给模型
    history = _load_history(root, form_id)
    form_docs.append_chat(root, form_id, {"role": "user", "content": text})
    yield {"event": "status", "data": {"phase": "thinking"}}

    try:
        from ..config.models import build_chat_model

        model = build_chat_model(root, model_id)
        tool_map = {tool.name: tool for tool in _tools(root, form_id)}

        messages: list[BaseMessage] = [
            SystemMessage(content=system_prompt(title, locale)),
            SystemMessage(
                content="模板原文（参考范本，含 {{占位符}} 与表格；按它的栏目与结构仿写）：\n"
                + json.dumps(template, ensure_ascii=False)
            ),
            SystemMessage(
                content=(
                    "当前取证单正文（用户可能在预览区手动修改过，以此为准）：\n"
                    + _dump(_body_snapshot(doc["body"]))
                )
            ),
            SystemMessage(
                content=(
                    "本轮选中疑点（以此为准；用户可能刚增删，增删后需同步改写正文）：\n"
                    + _dump(findings)
                )
            ),
            *history,
            HumanMessage(content=text),
        ]

        async for event in doc_chat.run_tool_loop(
            model,
            messages,
            tool_map,
            mutated_names=_MUTATED,
            on_assistant_text=lambda content: form_docs.append_chat(
                root, form_id, {"role": "assistant", "content": content}
            ),
            revision=lambda: _revision(root, form_id),
        ):
            yield event
    except ApiError as exc:
        yield {
            "event": "error",
            "data": {"messageKey": exc.message_key, "params": exc.params},
        }
    except Exception as exc:  # noqa: BLE001 - 模型/网络错误统一展示
        yield {
            "event": "error",
            "data": {"messageKey": "error.opFailed", "detail": str(exc)[:300]},
        }