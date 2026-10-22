"""归档设置的作者姓名/邮箱。"""

from fireeyeaud_agent.store import app_settings


def test_archive_settings_patch(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    app_settings.patch({"archive": {"authorName": "张审计", "authorEmail": "a@b.c"}})
    data = app_settings.load()
    assert data["archive"]["authorName"] == "张审计"
    assert data["archive"]["authorEmail"] == "a@b.c"

    # 再次 patch 只覆盖给定字段
    app_settings.patch({"archive": {"authorName": "李审计"}})
    data = app_settings.load()
    assert data["archive"]["authorName"] == "李审计"
    assert data["archive"]["authorEmail"] == "a@b.c"


def test_archive_settings_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    assert app_settings.load()["archive"] == {"authorName": "", "authorEmail": ""}