from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_custom():
    base = system_prompt("zh-CN")
    injected = system_prompt("zh-CN", custom="只关注应收账款与坏账准备")
    assert base != injected
    assert "只关注应收账款与坏账准备" in injected


def test_system_prompt_ignores_blank_custom():
    assert system_prompt("zh-CN", custom="   ") == system_prompt("zh-CN")
    assert system_prompt("zh-CN", custom=None) == system_prompt("zh-CN")
