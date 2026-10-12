from fireeyeaud_agent.config import store as cfg_store
from fireeyeaud_agent.config.models import select_profile


def _profile(name: str, model: str) -> dict:
    return {
        "name": name,
        "provider": "openai",
        "baseUrl": f"http://{name}.local/v1",
        "model": model,
        "scope": "project",
    }


def test_select_profile_by_id(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    root.mkdir()
    first = cfg_store.create_item("models", _profile("a", "m1"), root)
    second = cfg_store.create_item("models", _profile("b", "m2"), root)

    picked = select_profile(root, second["id"])
    assert picked is not None
    assert picked["id"] == second["id"]
    assert picked["model"] == "m2"

    # 未指定 id：回退默认（无 isDefault 时取首个）
    default = select_profile(root)
    assert default is not None
    assert default["id"] == first["id"]

    # 未知 id：返回 None
    assert select_profile(root, "mdl_missing") is None
