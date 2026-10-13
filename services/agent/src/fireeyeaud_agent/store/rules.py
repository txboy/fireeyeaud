"""审计规则库：用户自定义 SQL 规则（统一配置存储，global/project 作用域）。

一条规则 = 名称 + 描述 + 只读 SQL（+ 可选默认数据库连接）。
存储与 Models / Skills / MCP 等一致：全局在用户目录、本项目在工作区
`.fireeye/config/rules.json`，读取时按 id 合并（本项目覆盖全局）。
模型通过系统提示词感知这些 SQL，并用 `run_rule` 工具运行。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "rules"


def list_rules(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_rule(root: Path | None, rule_id: str) -> dict[str, Any] | None:
    for rule in list_rules(root):
        if rule.get("id") == rule_id:
            return rule
    return None


def create_rule(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    return store.create_item(KIND, data, root)


def update_rule(
    root: Path | None, rule_id: str, scope: str, patch: dict[str, Any]
) -> dict[str, Any]:
    # drop_none=False：允许显式传 databaseId=null 清除默认库。
    return store.update_item(KIND, rule_id, scope, patch, root, drop_none=False)


def delete_rule(root: Path | None, rule_id: str, scope: str) -> None:
    store.delete_item(KIND, rule_id, scope, root)
