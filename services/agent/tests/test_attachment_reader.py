import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.attachment_reader import read_attachments
from fireeyeaud_agent.config import store as config_store
from fireeyeaud_agent.store import attachments as att


class _FakeModel:
    def __init__(self, reply: str = "转写正文") -> None:
        self.reply = reply
        self.calls = 0

    async def astream(self, messages):
        self.calls += 1
        yield AIMessageChunk(content=self.reply)


def _ws(tmp_path, monkeypatch, vision=None):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    if vision is not None:
        config_store.create_item(
            "models",
            {
                "name": "m",
                "baseUrl": "http://x/v1",
                "model": "m",
                "vision": vision,
                "isDefault": True,
                "scope": "project",
            },
            root,
        )
    return root


def _png(path):
    from PIL import Image

    Image.new("RGB", (200, 120), "white").save(path)


@pytest.mark.asyncio
async def test_text_file_is_local_and_does_not_call_model(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    path = tmp_path / "a.txt"
    path.write_text("hello 你好", encoding="utf-8")
    fake = _FakeModel()

    result = await read_attachments(
        root, None, [{"path": str(path), "name": "a.txt"}], build_model=lambda: fake
    )

    assert [t.source for t in result.texts] == ["local"]
    assert result.texts[0].text == "hello 你好"
    assert result.image_blocks == []
    assert result.unsupported == []
    assert fake.calls == 0


@pytest.mark.asyncio
async def test_image_vision_transcribes_and_keeps_block(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch, vision=True)
    path = tmp_path / "pic.png"
    _png(path)
    fake = _FakeModel(reply="发票金额 1000 元")

    result = await read_attachments(
        root, None, [{"path": str(path), "name": "pic.png"}], build_model=lambda: fake
    )

    assert [t.source for t in result.texts] == ["vision"]
    assert result.texts[0].text == "发票金额 1000 元"
    assert len(result.image_blocks) == 1
    assert result.image_blocks[0]["type"] == "image_url"
    assert fake.calls == 1


@pytest.mark.asyncio
async def test_image_without_vision_is_unsupported(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch, vision=False)
    path = tmp_path / "pic.png"
    _png(path)
    fake = _FakeModel()

    result = await read_attachments(
        root, None, [{"path": str(path), "name": "pic.png"}], build_model=lambda: fake
    )

    assert result.texts == []
    assert result.image_blocks == []
    assert result.unsupported == ["pic.png"]
    assert fake.calls == 0


@pytest.mark.asyncio
async def test_pdf_with_text_layer_is_local(tmp_path, monkeypatch):
    from reportlab.pdfgen import canvas

    root = _ws(tmp_path, monkeypatch, vision=True)
    path = tmp_path / "doc.pdf"
    pdf = canvas.Canvas(str(path))
    pdf.drawString(72, 720, "Audit PDF text")
    pdf.save()
    fake = _FakeModel()

    result = await read_attachments(
        root, None, [{"path": str(path), "name": "doc.pdf"}], build_model=lambda: fake
    )

    assert [t.source for t in result.texts] == ["local"]
    assert "Audit PDF text" in result.texts[0].text
    assert result.image_blocks == []
    assert fake.calls == 0


@pytest.mark.asyncio
async def test_scanned_pdf_uses_vision(tmp_path, monkeypatch):
    from reportlab.pdfgen import canvas

    root = _ws(tmp_path, monkeypatch, vision=True)
    path = tmp_path / "scan.pdf"
    pdf = canvas.Canvas(str(path))
    pdf.showPage()  # 空白页：无文字层
    pdf.save()
    fake = _FakeModel(reply="扫描页转写")

    result = await read_attachments(
        root, None, [{"path": str(path), "name": "scan.pdf"}], build_model=lambda: fake
    )

    assert [t.source for t in result.texts] == ["vision"]
    assert len(result.image_blocks) == 1
    assert fake.calls == 1


@pytest.mark.asyncio
async def test_missing_file_records_note_without_crash(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch, vision=True)
    fake = _FakeModel()

    result = await read_attachments(
        root,
        None,
        [{"path": str(tmp_path / "nope.txt"), "name": "nope.txt"}],
        build_model=lambda: fake,
    )

    assert result.texts == []
    assert result.notes
    assert fake.calls == 0


def test_render_attachment_texts():
    block = att.render_attachment_texts(
        [
            {"name": "a.txt", "text": "hello"},
            {"name": "empty.txt", "text": "   "},
        ]
    )
    assert block is not None
    assert "a.txt" in block
    assert "hello" in block
    assert "empty.txt" not in block
    assert att.render_attachment_texts([]) is None
