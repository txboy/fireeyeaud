from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_skills():
    text = system_prompt(
        "zh-CN", None, [{"name": "持续经营评估", "prompt": "关注现金流与债务。"}]
    )
    assert "持续经营评估" in text
    assert "关注现金流与债务。" in text
    assert "请用简体中文回答。" in text


def test_system_prompt_without_skills():
    text = system_prompt("zh-CN")
    assert "审计规则" not in text
