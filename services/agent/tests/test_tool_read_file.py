import asyncio

import pytest
from langchain_core.messages import AIMessage
from PIL import Image

from fake_model import FakeChatModel
from fireeyeaud_agent.agent import attachment_reader
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.tools.read_file import read_file


def _run(coro):
    return asyncio.run(coro)


def test_read_text_file(tmp_path):
    (tmp_path / "说明.md").write_text("Hello 底稿", encoding="utf-8")
    out = _run(read_file(tmp_path, {"path": "说明.md"}))
    assert out["kind"] == "text"
    assert "Hello 底稿" in out["text"]
    assert out["source"] == "local"
    assert out["cached"] is False


def test_read_xlsx_as_table(tmp_path):

    import pandas as pd

    frame = pd.DataFrame({"科目": ["1001"], "金额": ["42"]})
    frame.to_excel(tmp_path / "账.xlsx", index=False)

    out = _run(read_file(tmp_path, {"path": "账.xlsx"}))
    assert out["kind"] == "table"
    assert "科目" in out["text"]
    assert "1001" in out["text"]


def test_read_unsupported_binary(tmp_path):
    (tmp_path / "blob.bin").write_bytes(b"\x00\x01\x02")
    out = _run(read_file(tmp_path, {"path": "blob.bin"}))
    assert out["error"] == "unsupported"
    assert out["text"] == ""


def test_read_rejects_outside(tmp_path):
    with pytest.raises(ApiError) as exc:
        _run(read_file(tmp_path, {"path": "../secret.txt"}))
    assert exc.value.code == "E_FILE_OUTSIDE"


def test_read_text_is_cached(tmp_path):
    (tmp_path / "a.txt").write_text("内容", encoding="utf-8")
    first = _run(read_file(tmp_path, {"path": "a.txt"}))
    second = _run(read_file(tmp_path, {"path": "a.txt"}))
    assert first["cached"] is False
    assert second["cached"] is True
    assert second["text"] == first["text"]


def test_image_without_model_needs_vision(tmp_path):
    Image.new("RGB", (4, 4), "white").save(tmp_path / "scan.png")
    out = _run(read_file(tmp_path, {"path": "scan.png"}))
    assert out["error"] == "needsVision"


def test_image_transcribed_once_then_cached(tmp_path, monkeypatch):
    Image.new("RGB", (4, 4), "white").save(tmp_path / "scan.png")
    monkeypatch.setattr(
        attachment_reader, "select_profile", lambda *_a, **_k: {"vision": True}
    )
    calls = {"n": 0}

    def build_model():
        calls["n"] += 1
        return FakeChatModel(messages=iter([AIMessage(content="转写后的文本")]))

    first = _run(
        read_file(
            tmp_path,
            {"path": "scan.png"},
            model_id="mdl_vision",
            build_model=build_model,
        )
    )
    second = _run(
        read_file(
            tmp_path,
            {"path": "scan.png"},
            model_id="mdl_vision",
            build_model=build_model,
        )
    )
    assert first["source"] == "vision"
    assert first["text"] == "转写后的文本"
    assert first["cached"] is False
    assert second["text"] == "转写后的文本"
    assert second["cached"] is True
    assert calls["n"] == 1
