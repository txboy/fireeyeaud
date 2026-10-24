"""docx 模板存储：全局 / 本项目双作用域、占位符体检与内置示例。

元数据复用统一配置存储（`config/store`，kind=`templates`），因此同 id 的项目项
会自动覆盖全局项；模板文件分作用域落盘，不写第二份清单。

目录：

- 全局：`<global_dir>/config/templates.json` + `<global_dir>/templates/<kind>/<id>.docx`
- 项目：`<root>/.fireeye/config/templates.json` + `<root>/.fireeye/templates/<kind>/<id>.docx`
- 示例：`<global_dir>/templates/samples/<kind>.docx`（虚拟项，不写清单）
"""

from __future__ import annotations

import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from docx import Document

from ..config import store
from ..errors import ApiError
from ..util import now_iso
from .lock import WORKSPACE_MUTATION_LOCK

logger = logging.getLogger(__name__)

KIND = "templates"
MAX_BYTES = 20 * 1024 * 1024
DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

KINDS = ("evidence-form", "report")
KIND_LABEL = {"evidence-form": "取证单模板", "report": "项目报告模板"}

SAMPLE_IDS = {
    "sample-evidence-form": "evidence-form",
    "sample-report": "report",
}

# ---- 路径 ----


def templates_root(scope: str, root: Path | None) -> Path:
    """模板文件根目录（不含 kind 子目录）。"""
    if scope == "project":
        if root is None:
            raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
        return Path(root) / ".fireeye" / "templates"
    return store.global_config_dir().parent / "templates"


def samples_dir() -> Path:
    return store.global_config_dir().parent / "templates" / "samples"


def template_file(scope: str, root: Path | None, kind: str, template_id: str) -> Path:
    return templates_root(scope, root) / kind / f"{template_id}.docx"


def _sample_path(kind: str) -> Path:
    return samples_dir() / f"{kind}.docx"


def _is_sample_id(template_id: str) -> bool:
    return template_id in SAMPLE_IDS or template_id.startswith("sample-")


def _kind_of_sample(template_id: str) -> str | None:
    return SAMPLE_IDS.get(template_id)


def _under(base: Path, candidate: Path) -> bool:
    """防止清单里的 fileName 被改成越界路径。"""
    try:
        candidate.resolve().relative_to(base.resolve())
    except (OSError, ValueError):
        return False
    return True


# ---- 体检 ----


def scan_docx(path: Path, kind: str) -> None:
    """只校验模板能不能用：文件存在、是 .docx、能被 python-docx 打开。

    模板只作**参考范本**，正文由模型参照范本仿写，导出时不替换占位符；
    因此这里不再扫描、也不再返回任何占位符信息。
    """
    path = Path(path)
    if not path.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": path.name}
        )
    if path.suffix.lower() != ".docx":
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": path.name})
    try:
        Document(str(path))
    except Exception as exc:  # noqa: BLE001 - 损坏的 docx 统一报类型错误
        raise ApiError(
            "E_FILE_TYPE", 400, "error.fileType", {"name": path.name}
        ) from exc


# ---- 项装饰 ----


def _decorate(item: dict[str, Any], scope: str, root: Path | None) -> dict[str, Any]:
    """补 absPath / size（不写回清单）。"""
    kind = str(item.get("kind") or "")
    template_id = str(item.get("id") or "")
    path = template_path(root, template_id, scope)
    size = item.get("size")
    if path is not None:
        try:
            size = path.stat().st_size
        except OSError:
            pass
    return {
        **item,
        "scope": scope,
        "kind": kind,
        "absPath": str(path) if path is not None else "",
        "size": int(size or 0),
        "isDefault": bool(item.get("isDefault")),
        "builtin": bool(item.get("builtin")),
    }


def _sort_key(item: dict[str, Any]) -> tuple:
    return (
        0 if item.get("isDefault") else 1,
        str(item.get("createdAt") or ""),
        str(item.get("id") or ""),
    )


# ---- 列表 / 查询 ----


def list_templates(
    root: Path | None, kind: str | None = None
) -> list[dict[str, Any]]:
    """合并生效模板（项目覆盖全局），并追加全局内置示例。"""
    out: list[dict[str, Any]] = []
    # 作用域以「项来自哪份清单」为准，不信任项里的 scope 字段（手改/同步可能写脏）。
    project_ids: set[str] = set()
    if root is not None:
        project_ids = {
            str(item.get("id"))
            for item in store.list_items(KIND, "project", root)
            if item.get("id")
        }
    for item in store.load_effective(KIND, root):
        item_kind = str(item.get("kind") or "")
        if kind is not None and item_kind != kind:
            continue
        scope = "project" if str(item.get("id")) in project_ids else "global"
        out.append(_decorate(item, scope, root))

    for sample in ensure_samples(root):
        if kind is not None and sample["kind"] != kind:
            continue
        out.append(sample)

    out.sort(key=_sort_key)
    return out


def ensure_samples(root: Path | None) -> list[dict[str, Any]]:
    """确保示例 docx 存在，返回其虚拟项（不写任何 templates.json）。

    示例损坏（空文件 / 半截写入）时尝试重建一次；仍失败就跳过该示例，
    绝不让一个坏文件把整个模板列表打挂（用户没有修复示例的入口）。
    """
    out: list[dict[str, Any]] = []
    for template_id, kind in SAMPLE_IDS.items():
        path = _sample_path(kind)
        for attempt in range(2):
            if not path.is_file():
                try:
                    create_sample(root, kind)
                except (ApiError, OSError):
                    logger.warning("template sample generation failed: %s", kind)
                    break
            try:
                out.append(_sample_item(template_id, kind, path))
                break
            except (ApiError, OSError):
                logger.warning("template sample unreadable, regenerating: %s", kind)
                if attempt == 0:
                    path.unlink(missing_ok=True)
                    continue
                break
    return out


def _sample_item(template_id: str, kind: str, path: Path) -> dict[str, Any]:
    try:
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        created = mtime.astimezone().isoformat()
        size = path.stat().st_size
    except OSError:
        created = now_iso()
        size = 0
    return {
        "id": template_id,
        "scope": "global",
        "kind": kind,
        "name": f"{KIND_LABEL[kind]}示例",
        "fileName": path.name,
        "absPath": str(path),
        "size": size,
        "createdAt": created,
        "isDefault": False,
        "builtin": True,
    }


def get_template(
    root: Path | None, template_id: str, scope: str
) -> dict[str, Any] | None:
    """只查询指定作用域。"""
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    sample_kind = _kind_of_sample(template_id)
    if sample_kind is not None:
        # 示例是全局虚拟项：列表里带 scope=global，显式作用域解析必须也能拿到（P3 依赖）。
        if scope != "global":
            return None
        ensure_samples(root)
        path = _sample_path(sample_kind)
        return _sample_item(template_id, sample_kind, path) if path.is_file() else None
    item = store.get_item(KIND, template_id, scope, root)
    if item is None:
        return None
    return _decorate(item, scope, root)


def resolve_template(
    root: Path | None, template_id: str, scope: str | None
) -> dict[str, Any]:
    """按显式作用域取模板；scope 缺省时在生效列表中解析（供 P3 兼容）。"""
    if scope in ("global", "project"):
        found = get_template(root, template_id, scope)
        if found is not None:
            return found
        raise ApiError("E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id})

    for item in list_templates(root):
        if item.get("id") == template_id:
            return item
    raise ApiError("E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id})


def template_path(
    root: Path | None, template_id: str, scope: str
) -> Path | None:
    """模板文件路径；不存在或越界返回 None。"""
    sample_kind = _kind_of_sample(template_id)
    if sample_kind is not None:
        path = _sample_path(sample_kind)
        return path if path.is_file() else None

    if not template_id or "/" in template_id or "\\" in template_id:
        return None
    item = store.get_item(KIND, template_id, scope, root)
    if item is None:
        return None
    kind = str(item.get("kind") or "")
    if kind not in KINDS:
        return None
    base = templates_root(scope, root) / kind
    file_name = str(item.get("fileName") or f"{template_id}.docx")
    candidate = base / file_name
    if not _under(base, candidate):
        return None
    return candidate if candidate.is_file() else None


def read_template_content(
    root: Path | None, template_id: str, scope: str
) -> tuple[bytes, str]:
    path = template_path(root, template_id, scope)
    if path is None:
        raise ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id})
    try:
        return path.read_bytes(), DOCX_MIME
    except OSError as exc:
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id}
        ) from exc


# ---- 写入 ----


def _same_scope_kind(
    root: Path | None, scope: str, kind: str, *, exclude: str | None = None
) -> list[dict[str, Any]]:
    items = [
        item
        for item in store.list_items(KIND, scope, root)
        if item.get("kind") == kind and item.get("id") != exclude
    ]
    items.sort(
        key=lambda item: (
            str(item.get("createdAt") or ""),
            str(item.get("id") or ""),
        )
    )
    return items


def _promote_default(root: Path | None, scope: str, kind: str) -> None:
    """保证同作用域/类型至少有一个默认（只影响该作用域）。"""
    items = _same_scope_kind(root, scope, kind)
    if not items or any(item.get("isDefault") for item in items):
        return
    store.update_item(
        KIND, str(items[0]["id"]), scope, {"isDefault": True}, root
    )


def _set_default(
    root: Path | None, item: dict[str, Any], scope: str
) -> dict[str, Any]:
    for other in store.list_items(KIND, scope, root):
        if (
            other.get("id") != item["id"]
            and other.get("kind") == item.get("kind")
            and other.get("isDefault")
        ):
            store.update_item(KIND, str(other["id"]), scope, {"isDefault": False}, root)
    return store.update_item(KIND, item["id"], scope, {"isDefault": True}, root)


def upload_template(
    root: Path | None,
    source: Path,
    *,
    kind: str,
    scope: str = "project",
    name: str | None = None,
    is_default: bool = False,
) -> dict[str, Any]:
    """导入一份 docx；同作用域同 kind 的第一份自动成为默认。"""
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if kind not in KINDS:
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": str(source)})
    if scope == "project" and root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")

    source = Path(source)
    if not source.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": source.name}
        )
    if source.suffix.lower() != ".docx":
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": source.name})
    size = source.stat().st_size
    if size > MAX_BYTES:
        raise ApiError(
            "E_FILE_TOO_LARGE", 400, "error.fileTooLarge", {"name": source.name}
        )

    scan_docx(source, kind)

    with WORKSPACE_MUTATION_LOCK:
        existing = [
            item
            for item in store.list_items(KIND, scope, root)
            if item.get("kind") == kind
        ]
        make_default = bool(is_default or not existing)
        created = store.create_item(
            KIND,
            {
                "kind": kind,
                "name": name or source.stem,
                "scope": scope,
                "isDefault": False,
            },
            root,
        )
        target = template_file(scope, root, kind, str(created["id"]))
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            updated = store.update_item(
                KIND,
                str(created["id"]),
                scope,
                {"fileName": target.name, "size": size},
                root,
            )
            if make_default:
                updated = _set_default(root, updated, scope)
        except OSError as exc:
            # 半成品回滚：删掉刚创建的元数据与文件，不动旧默认
            target.unlink(missing_ok=True)
            try:
                store.delete_item(KIND, str(created["id"]), scope, root)
            except ApiError:
                pass
            raise ApiError(
                "E_FILE_WRITE", 500, "error.opFailed", {"name": source.name}
            ) from exc
        except ApiError:
            # 元数据写入失败：同样回滚文件，避免留下无主 docx
            target.unlink(missing_ok=True)
            try:
                store.delete_item(KIND, str(created["id"]), scope, root)
            except ApiError:
                pass
            raise
        return _decorate(updated, scope, root)


def update_template(
    root: Path | None,
    template_id: str,
    scope: str,
    *,
    name: str | None = None,
    is_default: bool | None = None,
    target_scope: str | None = None,
) -> dict[str, Any]:
    """重命名 / 设默认 / 搬家；kind 不可改。"""
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if target_scope is not None and target_scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if _is_sample_id(template_id):
        raise ApiError(
            "E_TEMPLATE_BUILTIN", 403, "error.templateBuiltinReadonly", {"id": template_id}
        )
    current = store.get_item(KIND, template_id, scope, root)
    if current is None:
        raise ApiError("E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id})

    with WORKSPACE_MUTATION_LOCK:
        if name is not None:
            current = store.update_item(KIND, template_id, scope, {"name": name}, root)
        if is_default is True:
            current = _set_default(root, current, scope)
        elif is_default is False:
            current = store.update_item(
                KIND, template_id, scope, {"isDefault": False}, root
            )
            # 不允许把该作用域/类型清成「没有默认」：自动提升下一条，与删除一致。
            _promote_default(root, scope, str(current.get("kind") or ""))
            current = store.get_item(KIND, template_id, scope, root) or current

        if target_scope is not None and target_scope != scope:
            current = _move_template(root, current, scope, target_scope)
    return _decorate(current, target_scope or scope, root)


def _move_template(
    root: Path | None,
    item: dict[str, Any],
    source_scope: str,
    target_scope: str,
) -> dict[str, Any]:
    """搬家：文件与元数据一起换作用域（原作用域不再保留）。

    先写目标、再删源：中途失败不会丢模板。
    """
    if target_scope == "project" and root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")

    template_id = str(item.get("id"))
    kind = str(item.get("kind") or "")
    source_path = template_path(root, template_id, source_scope)
    if source_path is None:
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id}
        )
    if store.get_item(KIND, template_id, target_scope, root) is not None:
        raise ApiError(
            "E_SCOPE_CONFLICT", 409, "error.templateScopeConflict", {"id": template_id}
        )

    target_path = template_file(target_scope, root, kind, template_id)
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, target_path)
    except OSError as exc:
        target_path.unlink(missing_ok=True)
        raise ApiError(
            "E_FILE_WRITE", 500, "error.opFailed", {"name": template_id}
        ) from exc

    try:
        was_default = bool(item.get("isDefault"))
        moved = store.put_item(
            KIND,
            {
                **item,
                "scope": target_scope,
                "fileName": target_path.name,
                "isDefault": False,
            },
            root,
        )
        if was_default:
            moved = _set_default(root, moved, target_scope)
    except ApiError:
        target_path.unlink(missing_ok=True)
        raise

    store.delete_item(KIND, template_id, source_scope, root)
    source_path.unlink(missing_ok=True)
    if was_default:
        _promote_default(root, source_scope, kind)
    return moved


def delete_template(root: Path | None, template_id: str, scope: str) -> bool:
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if _is_sample_id(template_id):
        raise ApiError(
            "E_TEMPLATE_BUILTIN", 403, "error.templateBuiltinReadonly", {"id": template_id}
        )
    with WORKSPACE_MUTATION_LOCK:
        item = store.get_item(KIND, template_id, scope, root)
        if item is None:
            raise ApiError(
                "E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id}
            )
        path = template_path(root, template_id, scope)
        if path is not None:
            path.unlink(missing_ok=True)
        was_default = bool(item.get("isDefault"))
        kind = str(item.get("kind") or "")
        store.delete_item(KIND, template_id, scope, root)

        if was_default:
            remaining = [
                other
                for other in store.list_items(KIND, scope, root)
                if other.get("kind") == kind
            ]
            remaining.sort(
                key=lambda other: (
                    str(other.get("createdAt") or ""),
                    str(other.get("id") or ""),
                )
            )
            if remaining:
                store.update_item(
                    KIND,
                    str(remaining[0]["id"]),
                    scope,
                    {"isDefault": True},
                    root,
                )
    return True


def default_template(root: Path | None, kind: str) -> dict[str, Any] | None:
    """解析默认模板：项目默认 → 全局默认 → 项目首条 → 全局首条 → 示例。

    跳过文件已丢失的项：它有元数据但不可用，不该压过健康的模板。
    """
    items = [
        i
        for i in list_templates(root, kind)
        if not i.get("builtin") and i.get("absPath")
    ]
    project = [i for i in items if i["scope"] == "project"]
    glob = [i for i in items if i["scope"] == "global"]
    for group in (project, glob):
        for item in group:
            if item.get("isDefault"):
                return item
    for group in (project, glob):
        if group:
            return group[0]
    return next(
        (i for i in list_templates(root, kind) if i.get("builtin")),
        None,
    )


def replace_template_file(
    root: Path | None,
    template_id: str,
    scope: str,
    source: Path,
) -> dict[str, Any]:
    """用新 docx 覆盖已有模板文件：保留 id / 名称 / 作用域 / 默认标记。

    编辑模板的常规流程：下载 → 本地改 → 重新上传覆盖。
    写入用「临时文件 + os.replace」，避免中途失败留下半截文件。
    """
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if _is_sample_id(template_id):
        raise ApiError(
            "E_TEMPLATE_BUILTIN", 403, "error.templateBuiltinReadonly", {"id": template_id}
        )
    item = store.get_item(KIND, template_id, scope, root)
    if item is None:
        raise ApiError(
            "E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id}
        )

    source = Path(source)
    if not source.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": source.name}
        )
    if source.suffix.lower() != ".docx":
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": source.name})
    size = source.stat().st_size
    if size > MAX_BYTES:
        raise ApiError(
            "E_FILE_TOO_LARGE", 400, "error.fileTooLarge", {"name": source.name}
        )

    kind = str(item.get("kind") or "")
    scan_docx(source, kind)
    target = template_file(scope, root, kind, template_id)

    with WORKSPACE_MUTATION_LOCK:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".docx.tmp")
            shutil.copyfile(source, tmp)
            tmp.replace(target)
        except OSError as exc:
            target.with_suffix(".docx.tmp").unlink(missing_ok=True)
            raise ApiError(
                "E_FILE_WRITE", 500, "error.opFailed", {"name": source.name}
            ) from exc

        updated = store.update_item(
            KIND,
            template_id,
            scope,
            {"fileName": target.name, "size": size},
            root,
        )
    return _decorate(updated, scope, root)


def duplicate_template(
    root: Path | None,
    template_id: str,
    scope: str,
    *,
    target_scope: str,
) -> dict[str, Any]:
    """把模板（含内置示例）复制为目标作用域下的可编辑模板。"""
    if target_scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    if target_scope == "project" and root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")

    sample_kind = _kind_of_sample(template_id)
    if sample_kind is not None:
        ensure_samples(root)
        path = _sample_path(sample_kind)
        kind = sample_kind
        base_name = f"{KIND_LABEL[kind]}示例"
    else:
        item = store.get_item(KIND, template_id, scope, root)
        if item is None:
            raise ApiError(
                "E_NOT_FOUND", 404, "error.templateNotFound", {"id": template_id}
            )
        path = template_path(root, template_id, scope)
        kind = str(item.get("kind") or "")
        base_name = str(item.get("name") or template_id)

    if path is None or not path.is_file():
        raise ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id})

    return upload_template(
        root,
        path,
        kind=kind,
        scope=target_scope,
        name=f"{base_name}（副本）",
    )


# ---- 内置示例 ----


def create_sample(root: Path | None, kind: str) -> dict[str, Any]:
    """生成内置示例 docx；已存在则直接返回。

    写入用「临时文件 + os.replace」，避免并发首次请求把示例写成半截文件。
    """
    if kind not in KINDS:
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": kind})
    path = _sample_path(kind)
    if path.is_file():
        return _sample_item(f"sample-{kind}", kind, path)

    document = Document()
    if kind == "evidence-form":
        _build_evidence_form(document)
    else:
        _build_report(document)

    with WORKSPACE_MUTATION_LOCK:
        if path.is_file():  # 另一个请求刚刚生成
            return _sample_item(f"sample-{kind}", kind, path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".docx.tmp")
            document.save(str(tmp))
            tmp.replace(path)
        except OSError as exc:
            raise ApiError(
                "E_FILE_WRITE", 500, "error.opFailed", {"name": kind}
            ) from exc
    return _sample_item(f"sample-{kind}", kind, path)


def _build_evidence_form(document: Any) -> None:
    document.add_heading("取证单", level=1)
    for label in (
        "项目名称：{{项目名称}}",
        "项目编号：{{项目编号}}",
        "被审计单位：{{被审计单位}}",
        "审计期间：{{审计期间}}",
        "取证单编号：{{取证单编号}}",
        "取证单标题：{{取证单标题}}",
        "疑点数量：{{疑点数量}}",
        "编制人：{{编制人}}　复核人：{{复核人}}　日期：{{日期}}",
    ):
        document.add_paragraph(label)

    table = document.add_table(rows=3, cols=6)
    headers = ["序号", "疑点编号", "疑点标题", "风险", "状态", "金额"]
    for index, header in enumerate(headers):
        table.cell(0, index).text = header
    first_row = ["{{#疑点}}", "{{疑点.编号}}", "{{疑点.标题}}", "{{疑点.风险}}", "{{疑点.状态}}", "{{疑点.金额}}"]
    for index, value in enumerate(first_row):
        table.cell(1, index).text = value
    table.cell(2, 0).text = "{{/疑点}}"


def _build_report(document: Any) -> None:
    document.add_heading("项目报告", level=1)
    for label in (
        "项目名称：{{项目名称}}",
        "项目编号：{{项目编号}}",
        "被审计单位：{{被审计单位}}",
        "审计期间：{{审计期间}}",
        "报告编号：{{报告编号}}",
        "报告标题：{{报告标题}}",
        "取证单数量：{{取证单数量}}",
        "疑点数量：{{疑点数量}}",
        "编制人：{{编制人}}　复核人：{{复核人}}　日期：{{日期}}",
    ):
        document.add_paragraph(label)

    table = document.add_table(rows=3, cols=7)
    headers = ["序号", "取证单编号", "标题", "日期", "疑点数量", "回执", "疑点摘要"]
    for index, header in enumerate(headers):
        table.cell(0, index).text = header
    first_row = [
        "{{#取证单}}",
        "{{取证单.编号}}",
        "{{取证单.标题}}",
        "{{取证单.日期}}",
        "{{取证单.疑点数量}}",
        "{{取证单.回执}}",
        "{{取证单.疑点摘要}}",
    ]
    for index, value in enumerate(first_row):
        table.cell(1, index).text = value
    table.cell(2, 0).text = "{{/取证单}}"

    document.add_heading("附：疑点清单", level=2)
    appendix = document.add_table(rows=3, cols=3)
    for index, header in enumerate(["编号", "标题", "风险"]):
        appendix.cell(0, index).text = header
    for index, value in enumerate(["{{#疑点}}", "{{疑点.标题}}", "{{疑点.风险}}"]):
        appendix.cell(1, index).text = value
    appendix.cell(2, 0).text = "{{/疑点}}"