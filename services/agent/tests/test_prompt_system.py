from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_custom():
    base = system_prompt("zh-CN")
    injected = system_prompt("zh-CN", custom="只关注应收账款与坏账准备")
    assert base != injected
    assert "只关注应收账款与坏账准备" in injected


def test_system_prompt_ignores_blank_custom():
    assert system_prompt("zh-CN", custom="   ") == system_prompt("zh-CN")
    assert system_prompt("zh-CN", custom=None) == system_prompt("zh-CN")


def test_system_prompt_lists_connected_mcp_tools():
    text = system_prompt(
        "zh-CN",
        mcp_servers=[
            {"serverId": "mcp_1", "name": "echo-server", "tools": ["echo", "ping"]}
        ],
    )
    assert "MCP" in text
    assert "echo-server" in text
    assert "echo" in text and "ping" in text
    assert "不可信" in text


def test_system_prompt_omits_mcp_section_without_servers():
    assert "MCP" not in system_prompt("zh-CN")
    assert "MCP" not in system_prompt("zh-CN", mcp_servers=[])


def test_tool_catalog_covers_registry(tmp_path):
    from fireeyeaud_agent.agent.prompts import tool_catalog_lines
    from fireeyeaud_agent.tools.registry import build_langchain_tools

    tools = build_langchain_tools(tmp_path)
    text = "\n".join(tool_catalog_lines(tools))
    for name in ("sql_query", "describe_source", "kb_search", "read_artifact"):
        assert name in text


def test_rules_sql_moves_after_invariant_block():
    text = system_prompt(
        "zh-CN",
        rules=[{"id": "R-1", "name": "大额费用", "sql": "SELECT 1"}],
    )
    assert text.index("不可信数据") < text.index("SELECT 1")


def test_tool_catalog_precedes_custom_and_rules():
    tools = [
        type(
            "Tool",
            (),
            {"name": "sql_query", "description": "运行只读 SQL"},
        )()
    ]
    text = system_prompt(
        "zh-CN",
        rules=[{"id": "R-1", "name": "规则", "sql": "SELECT 1"}],
        custom="只看应收账款",
        tools=tools,
    )
    assert text.index("sql_query") < text.index("只看应收账款")
    assert text.index("只看应收账款") < text.index("SELECT 1")
