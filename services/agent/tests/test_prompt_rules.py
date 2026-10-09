from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_prompt_rules():
    base = system_prompt("zh-CN")
    injected = system_prompt(
        "zh-CN",
        prompt_rules=[
            {"id": "related_party_undisclosed", "definition": "检查关联方披露。"},
        ],
    )
    assert "related_party_undisclosed" in injected
    assert "检查关联方披露。" in injected
    assert injected != base
