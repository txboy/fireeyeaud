from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "fireeyeaud_agent"
_ALLOWED = {
    Path("agent/streaming.py"),
    Path("agent/attachment_reader.py"),  # 视觉转写独立超时，后续再迁移
}


def test_only_streaming_module_calls_astream():
    offenders = []
    for path in SRC.rglob("*.py"):
        rel = path.relative_to(SRC)
        if rel in _ALLOWED:
            continue
        if ".astream(" in path.read_text(encoding="utf-8"):
            offenders.append(str(rel))
    assert not offenders, f"use agent.streaming.iter_model instead: {offenders}"
