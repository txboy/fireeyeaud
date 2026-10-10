from fireeyeaud_agent.config import store
from fireeyeaud_agent.config.models import build_chat_model
from fireeyeaud_agent.store import secrets


def test_build_chat_model_uses_store_profile(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"
    store.create_item(
        "models",
        {
            "name": "本地模型",
            "provider": "openai",
            "baseUrl": "http://localhost:9999/v1",
            "model": "my-model",
            "temperature": 0.5,
            "apiKeyRef": "sec_1",
            "isDefault": True,
            "scope": "project",
        },
        root,
    )
    secrets.clear()
    secrets.set_one("sec_1", "sk-x")

    model = build_chat_model(root)
    assert model.model_name == "my-model"
    secrets.clear()
