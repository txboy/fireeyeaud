"""MCP 适配层（T3）：动态 schema、命名前缀、结果归一化。"""

from __future__ import annotations

from typing import get_args, get_origin

from pydantic import BaseModel

from fireeyeaud_agent.mcp import adapters
from fireeyeaud_agent.mcp.client import McpToolSpec


def test_tool_name_prefixes_server_and_tool():
    assert adapters.tool_name("mcp_1", "read_file") == "mcp__mcp_1__read_file"


def test_tool_name_sanitizes_invalid_chars():
    assert adapters.tool_name("srv", "a.b c") == "mcp__srv__a_b_c"


def test_tool_name_caps_length_with_hash():
    name = adapters.tool_name("mcp_1", "x" * 200)
    assert len(name) <= 64
    assert name.startswith("mcp__mcp_1__")


def test_tool_description_includes_server_name():
    spec = McpToolSpec(name="echo", description="回显", input_schema={})
    assert adapters.tool_description("echo-server", spec) == "[echo-server] 回显"


def test_tool_description_without_description():
    spec = McpToolSpec(name="echo", description="", input_schema={})
    assert adapters.tool_description("srv", spec) == "[srv]"


def test_schema_to_model_basic_types_and_required():
    model = adapters.schema_to_model(
        "Args",
        {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "文本"},
                "count": {"type": "integer"},
                "ratio": {"type": "number"},
                "flag": {"type": "boolean"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["text"],
        },
    )
    assert issubclass(model, BaseModel)
    fields = model.model_fields
    assert fields["text"].is_required()
    assert fields["text"].description == "文本"
    assert fields["count"].annotation == int | None
    assert fields["ratio"].annotation == float | None
    assert fields["flag"].annotation == bool | None
    list_inner = [a for a in get_args(fields["tags"].annotation) if a is not type(None)][0]
    assert get_origin(list_inner) is list

    obj = model(text="hi")
    assert obj.text == "hi"
    assert obj.count is None


def test_schema_to_model_enum_becomes_literal():
    model = adapters.schema_to_model(
        "Args",
        {
            "type": "object",
            "properties": {"mode": {"type": "string", "enum": ["fast", "slow"]}},
            "required": ["mode"],
        },
    )
    args = get_args(model.model_fields["mode"].annotation)
    assert args == ("fast", "slow")
    assert model(mode="fast").mode == "fast"


def test_schema_to_model_nested_object():
    model = adapters.schema_to_model(
        "Args",
        {
            "type": "object",
            "properties": {
                "opts": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}},
                    "required": ["key"],
                }
            },
        },
    )
    ann = model.model_fields["opts"].annotation
    inner = [a for a in get_args(ann) if a is not type(None)][0]
    assert issubclass(inner, BaseModel)
    assert inner(key="v").key == "v"


def test_schema_to_model_empty_schema_allows_empty_args():
    model = adapters.schema_to_model("Args", {"type": "object", "properties": {}})
    assert model().model_dump() == {}


async def test_build_tool_invokes_async_call():
    async def call(args):
        return f"called:{args.get('text')}"

    tool = adapters.build_tool(
        name="mcp__s__echo",
        description="[s] echo",
        args_schema=adapters.schema_to_model(
            "Args",
            {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        ),
        call=call,
    )
    assert tool.name == "mcp__s__echo"
    result = await tool.ainvoke({"text": "hi"})
    assert result == "called:hi"


async def test_dict_entry_routes_through_call():
    async def call(args):
        return {"echo": args.get("text")}

    entry = adapters.dict_entry(call)
    assert await entry(None, {"text": "x"}) == {"echo": "x"}


def test_normalize_result_concatenates_text_blocks():
    class _Block:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class _Result:
        content = [_Block(type="text", text="hello"), _Block(type="text", text="world")]
        is_error = False

    assert adapters.normalize_result(_Result()) == "hello\nworld"


def test_normalize_result_marks_non_text_blocks():
    class _Block:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class _Result:
        content = [_Block(type="image", uri="file://x.png")]
        is_error = False

    out = adapters.normalize_result(_Result())
    assert "image" in out and "file://x.png" in out


def test_normalize_result_truncates_to_cap(monkeypatch):
    from fireeyeaud_agent.mcp import adapters as mod

    monkeypatch.setattr(mod.settings, "mcp_max_output_chars", 10, raising=False)

    class _Block:
        type = "text"
        text = "x" * 100

    class _Result:
        content = [_Block()]
        is_error = False

    out = adapters.normalize_result(_Result())
    assert out.startswith("x" * 10)
    assert "truncated" in out


def test_normalize_result_falls_back_to_structured_content():
    class _Result:
        content = []
        structured_content = {"answer": 42, "note": "ok"}
        is_error = False

    out = adapters.normalize_result(_Result())
    assert "answer" in out and "42" in out
