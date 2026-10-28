"""PyInstaller 入口的启动参数解析。

主进程（`apps/desktop/src/sidecar.cjs`）给打包后的 sidecar 同时传命令行 `--host/--port`
和环境变量 `FIREYEAUD_*`；命令行优先，缺失时回落到环境变量，再回落到默认值。
"""

from __future__ import annotations

import pytest

from fireeyeaud_agent.__main__ import _resolve


def test_cli_args_win_over_env(monkeypatch):
    monkeypatch.setenv("FIREYEAUD_HOST", "127.0.0.2")
    monkeypatch.setenv("FIREYEAUD_PORT", "1111")
    assert _resolve(["--host", "127.0.0.9", "--port", "4321"]) == ("127.0.0.9", 4321)


def test_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("FIREYEAUD_HOST", "127.0.0.2")
    monkeypatch.setenv("FIREYEAUD_PORT", "2222")
    assert _resolve([]) == ("127.0.0.2", 2222)


def test_falls_back_to_defaults(monkeypatch):
    monkeypatch.delenv("FIREYEAUD_HOST", raising=False)
    monkeypatch.delenv("FIREYEAUD_PORT", raising=False)
    assert _resolve([]) == ("127.0.0.1", 8765)


def test_dangling_flag_is_ignored(monkeypatch):
    monkeypatch.setenv("FIREYEAUD_PORT", "3333")
    assert _resolve(["--port"]) == ("127.0.0.1", 3333)


@pytest.mark.parametrize("argv", [["--port", "not-a-number"]])
def test_non_numeric_port_raises_value_error(argv):
    with pytest.raises(ValueError):
        _resolve(argv)