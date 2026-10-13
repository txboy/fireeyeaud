from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_rules():
    base = system_prompt("zh-CN")
    injected = system_prompt(
        "zh-CN",
        rules=[
            {
                "id": "R-0001",
                "name": "余额非零",
                "description": "查非零余额",
                "sql": "SELECT 1",
            }
        ],
    )
    assert "R-0001" in injected
    assert "余额非零" in injected
    assert "SELECT 1" in injected
    assert injected != base
