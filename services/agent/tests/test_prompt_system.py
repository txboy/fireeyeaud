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
