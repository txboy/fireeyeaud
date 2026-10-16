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


def test_system_prompt_renders_skill_catalog():
    """T3：广告只含元数据（id/name/description/whenToUse），并提示用 load_skill。"""
    text = system_prompt(
        "zh-CN",
        skill_catalog=[
            {
                "id": "sk_3",
                "name": "收入舞弊排查",
                "description": "识别收入确认异常与截止性测试思路。",
            },
            {
                "id": "sk_5",
                "name": "关联方交易",
                "description": "梳理关联方资金往来的核对要点。",
                "whenToUse": "分析关联方往来时。",
            },
        ],
    )
    assert "load_skill" in text
    assert "- [sk_3] 收入舞弊排查：识别收入确认异常与截止性测试思路。" in text
    assert "分析关联方往来时。" in text


def test_system_prompt_without_catalog_has_no_ad():
    assert "load_skill" not in system_prompt("zh-CN")
    assert "load_skill" not in system_prompt("zh-CN", skill_catalog=[])
