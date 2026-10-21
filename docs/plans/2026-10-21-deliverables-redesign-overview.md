# 成果栏重构与交付归档 — 总体设计

> 本文件是拆分计划的索引与共识记录。具体实施按四份子计划执行，彼此有依赖顺序。

- 日期：2026-10-21
- 状态：设计已确认，待实施
- 涉及范围：成果栏、疑点/证据、模板中心、取证单、项目报告、回执单、项目归档

---

## 1. 目标

把现有成果栏从「疑点 / 证据图谱 / 底稿预览 / 证据日志」重构为：

```
疑点 · 取证单 · 项目报告 · 归档
```

形成一条可交付、可追溯的审计链路：

```
Agent / 人工创建疑点
        ↓
补充证据（文件 / 文字 / 手工记录）
        ↓
勾选疑点 → 按 docx 模板生成取证单 → 预览 → 保存
        ↓
上传签收回执单（项目根目录 回执单/）
        ↓
勾选取证单 → 按 docx 模板生成项目报告 → 预览 → 保存
        ↓
归档 = Git commit（整个项目文件夹）→ 推送远程 → 可从远程还原
```

---

## 2. 已确认的关键决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 成果栏 tab | 只保留 `疑点` / `取证单` / `项目报告` / `归档`；移除证据图谱、证据日志 tab |
| 2 | 疑点来源 | Agent 可生成；用户可手动创建；用户可删除 |
| 3 | 疑点删除 | 软删除：追加 `deleted` 事件，列表隐藏，日志与已生成文档不受影响 |
| 4 | 疑点详情 | 上半部分疑点内容，下半部分证据 |
| 5 | 证据补充 | 上传文件（复制到项目根目录 `证据/`）、文字说明、手工核查记录 |
| 6 | 证据移除 | 仅从疑点移除（`evidence_detached` 事件），证据与哈希链保留 |
| 7 | 取证单 | 勾选一个或多个疑点 → 合并生成**一份**取证单；模板循环列示 |
| 8 | 取证单保存 | 先生成到临时区并立即预览，点「保存」才落盘并出现在列表；取消则删除临时文件 |
| 9 | 列表操作 | 点击预览、下载；支持删除；不做打印 |
| 10 | 回执单 | 上传扫描件，统一放项目根目录 `回执单/`，每个取证单最多一份，可替换/删除；Agent 可感知 |
| 11 | 项目报告 | 勾选一份或多份取证单 → 合并生成一份报告；同样预览后保存 |
| 12 | 模板中心 | 左侧活动栏新增；模板作用域与规则/模型/技能一致，分**全局 / 本项目**；支持多选上传 docx，上传时可勾选「设为默认」；生成弹窗默认选中当前作用域的默认模板；项目模板随项目归档，全局模板不进入项目历史 |
| 13 | 模板语法 | 简单占位符 `{{项目名称}}`；表格循环用 `{{#疑点}}...{{/疑点}}`；上传时体检 |
| 14 | 打印 | 不做打印；生成物用 `docx-preview` 应用内预览，下载走系统「另存为」 |
| 15 | 归档模型 | Git 模式：一次归档 = 一次 commit + 标签 `archive/A-0001` |
| 16 | 仓库边界 | 仓库根 = 项目文件夹；单分支 `main`；整个项目提交 |
| 17 | 归档排除项 | `.fireeye/workspace.duckdb`、`.fireeye/.lock`、`.fireeye/staging/` |
| 18 | 远程 | 每个项目独立 remote，由用户填写；支持推送；支持 clone 还原 |
| 19 | 归档实现 | `dulwich`，不依赖用户安装系统 Git |
| 20 | 冲突策略 | 单写者约定 + 文件级冲突解决；不自动合并证据链、不 force push |
| 21 | 冲突合并粒度 | 文件级：本地 / 远程 / 两份都留；JSONL 先试文本合并并校验 ID/seq；证据与 project.json 整份二选一 |
| 22 | 归档认证 | 第一期 HTTPS + 用户名/Token；SSH 后续按需 |

---

## 3. 数据模型变更

### 3.1 疑点事件（`.fireeye/findings.jsonl`）

新增事件类型：

```jsonc
{ "event": "deleted", "id": "F-0011", "author": "张审计", "ts": "..." }

{ "event": "evidence_attached", "id": "F-0011", "evidenceId": "ev_42",
  "author": "张审计", "ts": "..." }

{ "event": "evidence_detached", "id": "F-0011", "evidenceId": "ev_42",
  "author": "张审计", "ts": "..." }
```

折叠规则：

- `deleted` → 标记删除，最终列表过滤。
- `evidence_attached` → 加入 `evidenceRefs`（去重）。
- `evidence_detached` → 从 `evidenceRefs` 移除。

手动疑点仍写 `created` 事件，`origin="manual"`，`sessionId=""`。

### 3.2 证据事件（`.fireeye/evidence.jsonl`）

在现有字段基础上新增可选字段：

```jsonc
{
  "step": "manual",                 // tool_call | tool_result | manual
  "source": "manual",               // agent | manual（缺省 agent）
  "kind": "file",                   // file | text | record（缺省 tool）
  "title": "银行回单",
  "note": "客户提供的纸质回单扫描件",
  "filePath": "证据/QZ-0001_银行回单.pdf",
  "fileHash": "sha256:...",
  "findingRefs": ["F-0011"]
}
```

哈希链规则不变：人工证据也参与 `prevHash/hash` 计算。

### 3.3 模板（全局 / 本项目双作用域）

模板复用其他配置板块的统一存储：`config/store`、`load_effective`、`scope` 字段、`ScopeBadge`。不是模板专属的第二套清单格式。

```
<global_dir>/
├─ config/templates.json          # 全局模板清单
└─ templates/
   ├─ evidence-form/<tpl_id>.docx
   ├─ report/<tpl_id>.docx
   └─ samples/                    # 内置示例（只读，可复制）
      ├─ evidence-form.docx
      └─ report.docx

<项目根>/.fireeye/
├─ config/templates.json          # 项目模板清单，随项目归档
└─ templates/
   ├─ evidence-form/<tpl_id>.docx
   └─ report/<tpl_id>.docx
```

清单项（两个作用域同一结构）：

```jsonc
{
  "items": [{
    "id": "tpl_1",
    "scope": "project",             // global | project
    "kind": "evidence-form",        // evidence-form | report
    "name": "标准取证单",
    "fileName": "tpl_1.docx",
    "size": 18234,
    "createdAt": "...",
    "updatedAt": "...",
    "isDefault": true,
    "check": {
      "tags": ["项目名称", "取证单编号", "疑点.标题"],
      "loops": ["疑点"],
      "unknown": ["未识别字段"],
      "missing": []
    }
  }]
}
```

约定：

- 元数据走 `config/store`：全局 `<global_dir>/config/templates.json`，项目 `<root>/.fireeye/config/templates.json`；同 id 项目项覆盖全局项。
- ID 由全局计数器生成，`_ID_PREFIX["templates"] = "tpl"`，与规则/模型/技能一致。
- 列表默认返回 `load_effective` 合并结果，每项带 `scope`；UI 用 `ScopeBadge` 展示，可按作用域筛选。
- 默认模板按作用域独立：项目默认优先于全局默认；同作用域设默认时只清除该作用域同 kind 的旧默认。上传弹窗可勾选「设为默认」；生成弹窗打开时自动选中默认模板，也可在弹窗内勾选把当前模板设为默认。
- 内置示例是虚拟的全局项（`builtin: true`，不写入清单），可复制到全局或本项目。
- 全局模板文件在项目目录外，渲染器不能再用 `readFile({root, path})` 读取；改由后端 `GET /templates/{id}/content?scope=` 返回 base64。
- 项目模板和 `.fireeye/config/templates.json` 随项目归档；全局模板属于机器级配置，不进入项目历史。

### 3.4 取证单（`.fireeye/artifacts/evidence-forms/<id>/`）

```
QZ-0001/
├─ document.docx
├─ template.docx        # 生成时使用的原始模板快照
└─ manifest.json
```

`manifest.json`：

```jsonc
{
  "id": "QZ-0001",
  "kind": "evidence-form",
  "title": "关于关联方交易的取证单",
  "templateId": "tpl_1",
  "templateScope": "project",     // global | project
  "templateName": "标准取证单",
  "createdAt": "...",
  "createdBy": "张审计",
  "header": {
    "projectName": "2025 年报审计",
    "auditee": "某某公司",
    "period": "2025-01-01 ~ 2025-12-31",
    "preparedBy": "张审计",
    "reviewedBy": "李复核",
    "date": "2026-10-21"
  },
  "findingIds": ["F-0011", "F-0012"],
  "findingsSnapshot": [ /* 生成时的疑点摘要，供报告与追溯使用 */ ],
  "evidenceIds": ["ev_42"],
  "receipt": {
    "path": "回执单/QZ-0001_客户签收.pdf",
    "name": "客户签收.pdf",
    "uploadedAt": "..."
  },
  "artifactRef": "evidence-forms/QZ-0001",
  "files": ["document.docx", "template.docx"]
}
```

### 3.5 项目报告（`.fireeye/artifacts/reports/<id>/`）

```
RPT-0001/
├─ document.docx
├─ template.docx        # 生成时使用的原始模板快照
└─ manifest.json
```

`manifest.json`：

```jsonc
{
  "id": "RPT-0001",
  "kind": "report",
  "title": "2025 年度审计项目报告",
  "templateId": "tpl_2",
  "templateScope": "global",
  "templateName": "标准项目报告",
  "createdAt": "...",
  "createdBy": "张审计",
  "header": { "projectName": "...", "period": "...", "preparedBy": "...", "reviewedBy": "...", "date": "..." },
  "formIds": ["QZ-0001", "QZ-0002"],
  "formsSnapshot": [ /* 取证单摘要 */ ],
  "findingCount": 5,
  "artifactRef": "reports/RPT-0001",
  "files": ["document.docx", "template.docx"]
}
```

### 3.6 归档

```
.fireeye/archives/A-0001.json     # 随 commit 提交
.git/                             # 项目根目录
.git/fireeye-push-state.json      # 本地推送状态，不提交
.fireeye/config/archive.json      # remoteUrl / autoPush / credRef，提交（不含明文）
.fireeye/config/templates.json    # 项目模板清单，提交
.fireeye/templates/               # 项目模板文件，提交
```

全局模板位于 `<global_dir>/config/templates.json` 与 `<global_dir>/templates/`，不在项目目录内，因此不进入项目归档。

`A-0001.json`：

```jsonc
{
  "id": "A-0001",
  "createdAt": "...",
  "author": { "name": "张审计", "email": "zhang@example.com" },
  "message": "归档 2026-10-21 · 3 份取证单 · 1 份报告",
  "commit": "<sha>",
  "branch": "main",
  "counts": { "findings": 12, "evidenceForms": 3, "reports": 1 },
  "appVersion": "0.0.0",
  "schemaVersion": 1
}
```

ID 规则：`A-<序号>`，序号取已有 `archive/*` 标签最大值 +1，避免还原旧版本后重号。

---

## 4. API 契约新增

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/findings` | 手动创建疑点 |
| DELETE | `/findings/{id}` | 软删除疑点 |
| POST | `/findings/{id}/evidence` | 补充证据（文件 / 文字 / 记录） |
| DELETE | `/findings/{id}/evidence/{evId}` | 从疑点移除证据 |
| GET | `/templates?kind=&scope=` | 模板列表；缺省返回全局 + 项目合并结果，`scope` 仅用于筛选 |
| POST | `/templates` | 上传模板（body 含 `scope`，传本地路径，可多选） |
| PATCH | `/templates/{id}?scope=` | 重命名 / 设为默认（必须带作用域） |
| DELETE | `/templates/{id}?scope=` | 删除模板（内置示例拒绝） |
| GET | `/templates/{id}/file?scope=` | 下载模板原文件 |
| GET | `/templates/{id}/content?scope=` | 返回 base64 内容，供预览全局模板（项目目录外） |
| POST | `/templates/{id}/duplicate` | 复制示例/模板到指定 `scope` |
| POST | `/evidence-forms/preview` | 渲染到临时区，body 含 `templateId` + `templateScope` |
| POST | `/evidence-forms` | 保存临时渲染结果，落盘并写入清单 |
| GET | `/evidence-forms` | 取证单列表 |
| DELETE | `/evidence-forms/{id}` | 删除取证单及其产物 |
| POST | `/evidence-forms/{id}/receipt` | 上传回执单（传本地路径） |
| DELETE | `/evidence-forms/{id}/receipt` | 删除回执单 |
| POST | `/reports/preview` | 渲染报告到临时区，body 含 `templateId` + `templateScope` |
| POST | `/reports` | 保存报告 |
| GET | `/reports` | 报告列表 |
| DELETE | `/reports/{id}` | 删除报告 |
| GET | `/archive/status` | 仓库状态（分支/远程/未推送/变更） |
| POST | `/archive/init` | 初始化仓库 |
| POST | `/archive/commit` | 执行归档（commit + tag） |
| GET | `/archive/history` | 归档列表 |
| GET | `/archive/{id}/changes` | 某次归档的变更文件 |
| POST | `/archive/push` | 推送 |
| POST | `/archive/remote` | 配置远程与自动推送 |
| POST | `/archive/conflict/check` | 检查分叉并返回冲突文件 |
| POST | `/archive/conflict/resolve` | 按文件选择生成 merge commit |
| POST | `/archive/clone` | 从远程 clone 到新文件夹（无需打开工作区） |
| POST | `/archive/restore` | 恢复到新文件夹（本地历史） |

统一错误信封与 `Authorization` 规则沿用现有实现。

---

## 5. 前端页面变更

- `ResultsColumn`：四个 tab；`存档` 之外的旧 tab 内容下线。
- `FindingsView`：多选、新建、删除、筛选、统计；详情上下分块。
- `EvidenceFormsView`：列表、预览、下载、删除、上传回执。
- `ReportsView`：列表、生成、预览、下载、删除。
- `ArchiveView`：仓库状态、归档、推送、历史、变更、冲突解决、远程配置、恢复。
- 活动栏新增 `templates`（模板中心），`SideBar` 增加 `TemplatesPanel`。
- 模板中心沿用其他配置面板的形态：列表展示合并结果，行上显示 `ScopeBadge`；上传弹窗选择「全局 / 本项目」并可勾选「设为默认模板」；支持按作用域筛选；示例复制时选择目标作用域。
- 生成向导 / 预览弹窗：打开时默认选中默认模板（项目默认优先），模板选择带 `ScopeBadge`，可勾选「设为默认模板」；抬头字段、`docx-preview` 预览、保存/取消。
- 欢迎页增加「从远程还原项目」入口。

---

## 6. 计划拆分与依赖

| 计划 | 文件 | 依赖 | 内容 |
|---|---|---|---|
| P1 | `2026-10-21-findings-evidence-redesign.md` | 无 | 成果栏 tab 骨架、手动疑点、疑点删除、证据补充/移除 |
| P2 | `2026-10-21-template-center.md` | 无（可与 P1 并行） | 模板中心、全局/项目作用域、上传/体检/示例模板 |
| P3 | `2026-10-21-evidence-forms-reports.md` | P1 + P2 | docx 渲染、取证单、报告、回执、预览/下载 |
| P4 | `2026-10-21-git-project-archive.md` | P1（建议 P2/P3 完成后） | Git 归档、推送、还原、冲突解决 |

```
P1 ──┬──> P3 ──> P4
P2 ──┘
P1 ─────────────> P4
```

---

## 7. 跨计划约定

- **ID 计数器**：`project.json.counters` 新增 `evidenceForm`、`report`；`archive` 不使用计数器，按标签推导。模板 ID 走 `config/store` 的全局计数器（`_ID_PREFIX["templates"] = "tpl"`），不写入项目计数器。
- **模板作用域**：模板与规则/模型/技能一致，分 `global` / `project`；元数据走 `config/store`，列表走 `load_effective`；项目项覆盖同 id 全局项。生成时必须同时传 `templateId` + `templateScope`。
- **模板快照**：每份取证单/报告在产物目录保存 `template.docx`（上传的原始模板），清单记录 `templateId/templateScope/templateName`，保证全局模板变更或删除后仍可追溯。
- **归档边界**：项目模板（`.fireeye/config/templates.json` + `.fireeye/templates/`）和产物中的模板快照随项目提交；全局模板在用户目录，不进入项目 Git 历史。
- **i18n**：新增命名空间 `templates`、`evidence-form`、`report`、`archive`；`results`、`findings`、`evidence`、`enums.event` 扩充；`zh-CN` 与 `en-US` 同步。
- **错误 key**：新增 key 统一放 `error` 命名空间，两语言同步。
- **文件写入**：所有用户文件复制走白名单校验（后缀、大小、路径穿越），不覆盖同名文件时自动加序号。
- **测试**：后端 pytest（store + API），前端 `typecheck`，Electron `desktop:test`；关键流程需要 GUI 手测。
- **提交节奏**：每个 Task 一次 commit，消息使用 `feat(scope): ...` / `fix(scope): ...`。
- **不做**：证据图谱、证据日志独立 tab、打印、模板可视化插入器、成果级自动重编号合并、SSH 认证（第一期）。

---

## 8. 验收口径

1. 成果栏只有四个 tab，旧 tab 不再出现。
2. 手动创建、删除疑点后列表与统计正确；Agent 生成疑点仍正常。
3. 疑点详情上半内容、下半证据；可上传/填写/记录证据并预览；移除后证据日志仍可查。
4. 模板中心可一次上传多个 docx，能显示占位符体检结果和示例模板；上传时可选择全局/本项目，列表显示作用域，项目默认优先于全局默认。
5. 勾选多条疑点生成一份取证单；预览后保存才进入列表；取消不残留。
6. 取证单可上传/替换/删除回执，回执位于项目根目录 `回执单/`。
7. 勾选多份取证单生成一份项目报告；列表可预览/下载/删除；生成物内含所用模板快照，全局模板被删除后仍可预览。
8. 归档生成 commit + 标签，历史可见；推送后远程可查；clone 还原的项目可打开并重建 DuckDB。
9. 冲突时分叉可被识别，能按文件选择本地/远程/两份都留，并生成 merge commit；证据链不被拼接破坏。
