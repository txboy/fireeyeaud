from fireeyeaud_agent.store import file_cache


def test_sha256_stable_and_changes(tmp_path):
    path = tmp_path / "a.txt"
    path.write_text("hello", encoding="utf-8")
    first = file_cache.file_sha256(path)
    assert first == file_cache.file_sha256(path)

    path.write_text("hello world", encoding="utf-8")
    assert file_cache.file_sha256(path) != first


def test_save_and_load_roundtrip(tmp_path):
    sha = "a" * 64
    record = {
        "path": "数据/序时账.xlsx",
        "kind": "table",
        "source": "local",
        "text": "a\tb\n1\t2",
        "truncated": False,
    }
    assert file_cache.load(tmp_path, sha, kind="table") is None

    file_cache.save(tmp_path, sha, record, kind="table")
    loaded = file_cache.load(tmp_path, sha, kind="table")
    assert loaded is not None
    assert loaded["text"] == "a\tb\n1\t2"


def test_kind_separates_entries(tmp_path):
    # 字节相同但归类不同（如同一份内容存成 .csv 与 .txt）应各自缓存。
    sha = "d" * 64
    file_cache.save(tmp_path, sha, {"text": "as-table"}, kind="table")
    assert file_cache.load(tmp_path, sha, kind="text") is None
    assert file_cache.load(tmp_path, sha, kind="table")["text"] == "as-table"


def test_model_id_separates_vision_entries(tmp_path):
    sha = "b" * 64
    file_cache.save(tmp_path, sha, {"text": "model-a"}, kind="image", model_id="mdl_a")
    assert file_cache.load(tmp_path, sha, kind="image", model_id="mdl_b") is None
    assert (
        file_cache.load(tmp_path, sha, kind="image", model_id="mdl_a")["text"]
        == "model-a"
    )
    # 本地抽取与视觉转写互不覆盖。
    file_cache.save(tmp_path, sha, {"text": "local"}, kind="image", model_id=None)
    assert file_cache.load(tmp_path, sha, kind="image")["text"] == "local"


def test_clear_removes_cache(tmp_path):
    file_cache.save(tmp_path, "c" * 64, {"text": "x"}, kind="text")
    assert file_cache.clear_file_cache(tmp_path) >= 1
    assert file_cache.load(tmp_path, "c" * 64, kind="text") is None
