# 数据模型

> English: [../en/05-data-model.md](../en/05-data-model.md)

## 一、工作区落盘

打开一个文件夹后，后端在其中创建 `.fireeye/`：

```
<工作区>/
├─ .fireeye/
│  ├─ project.json          项目元信息 + 计数器 + 数据源登记
│  ├─ .lock                 当前打开它的进程 pid / 端口
│  ├─ findings.jsonl        疑点事件流（追加写）
│  ├─ evidence.jsonl        证据事件流（哈希链）
│  ├─ workspace.duckdb      导入的表格（分析引擎）
│  ├─ checkpoints.sqlite    会话与消息投影
│  ├─ authorization.json    表 / 字段白名单
│  ├─ config/               项目级配置（模型、规则、技能、MCP、知识库、归档）
│  ├─ templates/            本项目上传的 docx 模板
│  ├─ index/
│  │  ├─ files.json         文件指纹（判断是否变化，供对账用）
│  │  └─ schema.json        所有数据源的表结构
│  └─ artifacts/            产物：底稿、报告、取证单、大查询结果
└─ 证据/                    人工证据的原文件副本
```

`_SUBDIRS = ["config", "templates", "index", "artifacts"]` 由 `store/workspace.py` 在打开时确保存在。

**这个目录就是审计档案**。拷走整个工作区，换台机器打开，疑点、证据、会话、产物都在。密钥不在里面（见第四节）。

## 二、事件流

### 为什么用事件流

疑点和证据都是**追加写、不改历史**。当前状态由回放事件算出。好处：任何一条记录都能回答"它是什么时候、由谁、因为什么变成这样的"。

### `findings.jsonl`

一个疑点一行。事件类型：

| `event` | 含义 |
|---|---|
| `created` | 新建疑点 |
| `status_changed` | 状态变更（确认/驳回/复核中/误报） |
| `severity_changed` | 级别调整 |
| `note_added` | 备注 |
| `evidence_attached` | 挂接证据 |
| `evidence_detached` | 解除挂接 |
| `deleted` | 删除 |

状态机：

```
pending ──→ in_review ──→ confirmed
   │            │      └→ rejected
   └────────────┴────────→ false_positive
```

级别只有三档：`high` / `medium` / `low`。

### `evidence.jsonl`

证据是**哈希链**，用于防篡改。结构：

```json
{
  "seq": 1,
  "id": "ev_1",
  "sessionId": "ses_...",
  "ts": "2026-10-27T...",
  "step": "tool_call | tool_result | manual",
  "findingRefs": ["F-0001"],
  "tool": "sql_query",
  "params": { "...": "..." },
  "resultSummary": "返回 12 行",
  "artifactRef": "artifacts/ev_1.json",
  "durationMs": 42,
  "tokens": {},
  "lang": "zh-CN",
  "prevHash": "sha256:...",
  "hash": "sha256:..."
}
```

**哈希计算**（`store/evidence.py::compute_hash`）：

```
hash = "sha256:" + sha256( prevHash + canonical(event without "hash") )
```

`canonical` 是去掉 `hash` 后按 key 递归字典序的紧凑 JSON，所以写入顺序不影响哈希。

第一条的 `prevHash` 是空串。校验时从第一条往后逐条重算，任何一条对不上就报告 `{ ok: false, breakAt: <seq>, reason: "hash_mismatch" }`。

打开工作区时会自动校验一次；`POST /workspaces/{id}/verify-evidence` 可手动触发。

**改证据必须新增事件，不能改旧的**——改了链就断了。

### 大结果

- 证据结果超过 **16KB**（`_ARTIFACT_THRESHOLD`）→ 完整结果写 `artifacts/ev_<seq>.json`，事件里留 `artifactRef`。
- `sql_query` 被行数上限截断时 → 完整结果写 `artifacts/query_<8位hex>.json`。

## 三、`project.json`

只存元信息和计数器，不存业务数据：

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "name": "工作区名",
  "createdAt": "...",
  "updatedAt": "...",
  "defaultModelId": null,
  "counters": {
    "finding": 0, "rule": 0, "session": 0, "message": 0,
    "dataSource": 0, "connection": 0, "workingPaper": 0,
    "evidenceForm": 0, "report": 0
  },
  "dataSources": []
}
```

**`schemaVersion` 是兼容性闸门**：打开时若发现文件里的版本比程序支持的新，直接拒绝（`E_WS_SCHEMA_TOO_NEW`），不会尝试降级——避免新版本写的数据被旧版本改坏。

会话 id 的唯一性**以 `checkpoints.sqlite` 为准**，不是靠 `counters.session`（计数器会随工作区复制而重复）。

## 四、不在工作区里的数据

| 位置 | 内容 | 为什么分开 |
|---|---|---|
| `<userData>/secrets.json` | 模型 key、数据库密码、知识库 key、远程 token | 用 Electron `safeStorage` 加密；不进项目，避免随协作外泄 |
| `~/.fireeye/` | 全局作用域配置 | 跨项目复用（全局模型、全局规则等） |

密钥的流转：

```
渲染进程 → ipcRenderer.invoke('secret:put', 明文)
        → 主进程 safeStorage.encryptString → 写 secrets.json
        → 主进程把密文经 POST /secrets 推给 sidecar
        → sidecar 解密后仅存内存，不落盘
```

所以 sidecar 重启后密钥会重新推送。**任何情况下不要把明文密钥写进 `.fireeye/`**。

## 五、配置的作用域

以模型为例：

```
~/.fireeye/config/models.json           ← global
<工作区>/.fireeye/config/models.json    ← project
```

读取时 global ⊕ project 合并，**project 覆盖 global**（按 id 对齐）。列表接口用 `?scope=global|project` 指定只看一层。

同样的机制用于：`rules` / `skills` / `kb` / `mcp` / `db`。全局侧的 id 计数器存在 `~/.fireeye/config/_counters.json`。

## 六、数据源与索引

导入一个表格文件后：

1. 内容进 `workspace.duckdb`，表名形如 `src_ds1_序时账`
2. `index/schema.json` 记录该数据源的表与列
3. `index/files.json` 记录文件指纹（用于对账判断"改了没有"）
4. `project.json` 的 `dataSources[]` 加一条登记

数据库连接走同一套：`reflect` 反射表结构后也注册成数据源，Agent 用 `sql_query` 时按 `sourceId` 区分是查 DuckDB 还是查外部库。

**对账（sync）** 就是比对 `files.json` 里的指纹与磁盘实际文件：新增的导入、消失的移除、变化的替换。

## 七、归档

`archive` 面板基于 Git：

- 一次归档 = 一个 commit + 一个 `archive/A-xxxx` 标签（`TAG_PREFIX = "archive/"`）
- 整个项目文件夹入库，`.gitignore` 只排除可重建或易冲突的文件：
  `.fireeye/workspace.duckdb`（及 `.wal` / `.tmp`）、`.fireeye/.lock`、`.fireeye/staging/`
- 远程配置存 `.fireeye/config/archive.json`

**注意**：归档是项目文件夹级别的，`.fireeye/` 里的疑点、证据、会话记录都在版本控制内——历史本身就受 Git 保护。而 `workspace.duckdb` 不入库，换机克隆后表格需要重新导入（文件还在工作区里，走一次 sync 即可）。

## 八、产物

```
.fireeye/artifacts/
├─ working-paper/wp_<n>/        底稿.docx | 底稿.xlsx | 底稿.pdf
├─ evidence-forms/QZ-xxxx/      body.json + 导出的 docx
├─ reports/RPT-xxxx/            同上
├─ ev_<seq>.json                超过 16KB 的证据结果
└─ query_<hex>.json             被截断的 SQL 结果
```

前端通过 `GET /artifacts/{path:path}` 读取（有目录穿越防护），或直接用主进程的 `openPath` / `showItemInFolder` 交给系统打开。

## 九、改数据格式时的规矩

- **加字段可以，删字段不行**。旧工作区文件里没有新字段时，读取端要有默认值。
- **破坏性变更升 `schemaVersion`**，并在 `store/migrate.py` 里写迁移。迁移失败不能阻塞打开工作区（参考 `migrate_evidence_form_workspace` 的做法：失败就下次再试）。
- **事件流只追加**。要"撤销"某个操作，追加一条相反的事件，而不是删原来的行。
- 改完跑 `npm run agent:test`——数据结构相关的测试都在 `services/agent/tests/`。