"""技能按需加载接入 run_agent 的行为（T5）：广告目录 / eager 正文 / 全局模式。"""

import pytest
from langchain_core.messages import AIMessageChunk, SystemMessage

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store import app_settings, skills


def _ws(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / ".fireeye").mkdir(parents=True)
    return tmp_path


def _skill(root, name, prompt, **kw):
    data = {"name": name, "prompt": prompt, "enabled": True, "scope": "project"}
    data.update(kw)
    return skills.create_skill(data, root=root)


class _CaptureModel:
    """记录绑定的工具名与首步 system prompt。"""

    def __init__(self):
        self.tool_names: set[str] | None = None
        self.system: str | None = None

    def bind_tools(self, tools):
        self.tool_names = {t.name for t in tools}
        return self

    async def astream(self, messages):
        if self.system is None:
            self.system = next(
                m for m in messages if isinstance(m, SystemMessage)
            ).content
        yield AIMessageChunk(content="完成")


async def _run(root, model, **kw):
    return [
        e
        async for e in run_agent(
            root, "s_1", "问题", "zh-CN", model=model, context={}, **kw
        )
    ]


@pytest.mark.asyncio
async def test_lazy_mode_advertises_catalog_not_body(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    _skill(
        root,
        "收入舞弊",
        "完整正文-不应出现",
        description="识别收入异常。",
        isDefault=True,
    )
    model = _CaptureModel()
    await _run(root, model)

    assert "load_skill" in model.system
    assert "[sk_1] 收入舞弊：识别收入异常。" in model.system
    assert "完整正文-不应出现" not in model.system
    assert "load_skill" in model.tool_names


@pytest.mark.asyncio
async def test_eager_skill_injects_body_and_is_not_advertised(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    _skill(root, "常驻", "常驻正文", eager=True, isDefault=True)
    model = _CaptureModel()
    await _run(root, model)

    assert "常驻正文" in model.system
    assert "[sk_1]" not in model.system


@pytest.mark.asyncio
async def test_mixed_lazy_and_eager(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    _skill(root, "懒加载", "懒正文-不应出现", description="懒描述。", isDefault=True)
    _skill(root, "常驻", "常驻正文", eager=True, isDefault=True)
    model = _CaptureModel()
    await _run(root, model)

    assert "懒正文-不应出现" not in model.system
    assert "[sk_1] 懒加载：懒描述。" in model.system
    assert "常驻正文" in model.system


@pytest.mark.asyncio
async def test_mode_eager_injects_all_bodies(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    _skill(root, "普通技能", "普通正文", description="描述。", isDefault=True)
    app_settings.patch({"skills": {"mode": "eager"}})
    model = _CaptureModel()
    await _run(root, model)

    assert "普通正文" in model.system
    assert "load_skill" not in model.system
