# 取证单写作台（仿照项目报告）设计

日期：2026-10-24
状态：已实施（2026-10-24）

## 1. 意图

现有取证单是「选模板 → 勾疑点 → 填抬头 → 渲染一次 docx → 保存」，之后只能下载、传回执、删除；改内容只能删掉重做。项目报告已经改成「和模型一起写结构化正文 → 校验 → 导出」，本设计把取证单也改成同一形态，并**下线旧的取证单生成链路与已生成的旧数据**。

## 2. 目标 / 非目标

目标：
- 新建取证单 = 选取证单模板 + 勾若干疑点 → 直接进写作台，不再有渲染预览步骤。
- 左侧「取证单」面板仿「项目报告」：上栏取证单记录、下栏可选疑点（勾选即纳入新建范围）。
- 右侧取证单 tab：左对话、右实时预览；支持人工富文本编辑、校验、导出 Word、下载、回执、删除。
- 模板定位为**参考范本**：只提供格式与栏目结构，不再填充 placeholders。
- 章节结构由模型读完**整份模板原文 + 选中疑点**后自行决定，系统不预设「一条一段」或「汇成表」的规则。
- 校验沿用报告规则：大纲确认、章节非空、引用疑点编号必须在范围内、金额必须能在疑点快照找到。
- 导出仍以模板 docx 为底（字体 / 字号 / 行距 / 页边距继承模板），正文按新结构化内容重建。

非目标：
- 不保留旧取证单渲染链路（`/evidence-forms/preview`、`/evidence-forms` commit）。
- 不迁移旧数据：旧产物目录、暂存 payload、旧 manifest、旧回执单文件一并清除。
- 不改变项目报告自身的写作台逻辑（只同步清理其对旧取证单的引用）。

anti-goals（即使能跑也算失败）：
- 写作台导出的 docx 丢掉模板样式（变成「通用排版」）。
- 旧取证单或旧回执单残留，列表里还能看到点不开的条目。
- 报告因旧取证单被删而出现悬空引用或疑点数对不上。

## 3. 约束

- 现有 bug：`ReportsPanel` 下栏仍展示 `useFormsStore`（旧取证单），必须一并改掉。
- `report_docs.py` 与 `report_verify.py` 强绑 `RPT-` 前缀与 `report` kind，需要参数化复用，避免复制
  900 行渲染/校验代码；若发现差异过大（如需要疑点看板）则拆独立组件。
- 正文行内格式（runs / align）由 `report_docs._normalize_blocks` 处理，取证单直接复用。
- **模板 placeholders 不再执行**：`{{疑点}}` / `{{#疑点}}` / `{{项目名称}}` 只作为参考范本的文字内容
  展示给模型，导出时已被新正文取代，模板里的原占位段落/表格不再输出。
- **整份模板原文提交给模型**（用户确认）：不压缩、不只给表头，段落文本 + 表格内容按原顺序全部给出。

## 4. 数据模型

新目录 `.fireeye/artifacts/evidence-forms/QZ-xxxx/`（旧的 `evidence-forms/` 目录在清理时删除）：

```
manifest.json    取证单元数据（status: draft|saved）
body.json        结构化正文（大纲确认、选中疑点、章节、块）
skeleton.json    模板骨架（创建时固化；含 templateText 范本原文）
template.docx    模板副本
document.docx    导出产物（导出后才有）
chat.jsonl       写作对话记录
```

回执单仍存放 `<workspace>/回执单/`，manifest 记录路径；旧回执单文件随旧取证单一起删除，编号从
`QZ-0001` 重新开始（`next_counter(..., "evidenceForm")` 清 0）。

`body.json`：与 `ReportBody` 同构，章节结构完全复用；疑点范围字段用 `selectedFindingIds`。
（`ReportBody.selectedFormIds` 不复用于取证单，避免「取证单里装取证单」的歧义。）
`manifest.json`：`kind: "evidence-form"`、`id: "QZ-xxxx"`、`title`、
`header`（抬头字段）、`findingIds`、`findingsSnapshot`、`receipt`、`artifactRef`、`files`、`status`。

`findingsSnapshot` 元素：`{id, title, description, severity, status, subjects, amount, currency, evidence}`，
与 `FindingSnapshot`（types.ts:425）一致。

## 5. 决定

1. **写作台复用报告组件**：`ReportWorkspace` / `ReportPreview` / `ReportChat` / `ReportSectionEditor`
   抽成通用「写作台」，通过 kind 参数区分 `report` / `evidence-form`。
2. **后端参数化复用**：`report_docs.py` 的读写/归一化/导出函数以 `reports_store` 风格新增
   `form_docs.py` 参数化模块（或给现有函数加 `kind`），二者共用 `_normalize_blocks` / `_apply_style` /
   `_clear_body` / `_heading_style` / `_add_text` 等渲染原语。
3. **对话代理复用**：`report_agent.py` 增 `kind` 参数，工具名与提示词按 kind 切换；`mutated` 判断改为
   名称无关；`ReportChat.tsx` 的 `TOOL_LABEL` 同步。
4. **整份模板交给模型**：新增 `analyze_template_text(path) -> dict`，输出
   `{"blocks": [{"kind": "paragraph", "text": "..."} | {"kind": "table", "rows": [["..."]]}]}`，
   创建时存 `skeleton.json.templateText`，写作对话每轮注入。占位符原样呈现。
5. **新接口**（`/evidence-forms/*` 重写）：
   - `POST /evidence-forms/drafts {templateId, templateScope, findingIds, header, title}`
   - `GET /evidence-forms`（列表）、`GET /evidence-forms/{id}`、`DELETE /evidence-forms/{id}`
   - `GET /evidence-forms/{id}/doc`、`PUT .../outline`、`PUT .../sections/{sid}`、`PUT .../title`、
     `PUT .../findings`、`POST .../verify`、`POST .../export`
   - `GET /evidence-forms/{id}/messages`、`POST /evidence-forms/{id}/chat`（SSE）
   - `POST /evidence-forms/{id}/receipt`、`DELETE /evidence-forms/{id}/receipt`
   - 删除旧 `POST /evidence-forms/preview`、`POST /evidence-forms`（commit）。
6. **清理旧数据**（一次性，按 `.fireeye/migrations.json` 的 `evidenceFormWorkspace` 标记只跑一次）：
   - 删除 `.fireeye/artifacts/evidence-forms/`、`.fireeye/staging/`；
   - 删除 `回执单/` 下旧取证单的回执单文件（用户已确认「一并删掉」）；
   - 改写所有报告 manifest：从 `formIds` 与 `formsSnapshot` 中剔除旧取证单，重算 `findingCount`；
     快照正文一并剔除（用户已确认）；
   - 清 `project.json` 的 `counters.evidenceForm`，编号从 QZ-0001 重来。
7. **左侧面板**：`EvidenceFormsView` 改为上下分栏，上栏取证单记录（新建 / 打开 / 下载 / 删除 / 回执），
   下栏「可选疑点」（复选框，与 `useFindingsStore.selectedIds` 同步）。
8. **报告面板**：`ReportsPanel` 下栏改为展示**取证单写作台记录**（`useFormsStore.items`），不再是旧取证单。
9. **回执单**：保留 `ReceiptDialog`，数据来源为 `useFormsStore.items` 中 `manifest.receipt`。
10. **归档统计**：`archive.py` 的 `list_evidence_forms` 调用点改指新 store。
11. **文案**：`zh-CN.ts` / `en.ts` 的 `evidence-form` 命名空间补齐新流程文案，保留回执相关文案，
    删除旧渲染/预览文案。
12. **测试**：后端 `pytest` 覆盖创建草稿、写入章节、校验、导出样式继承、模板原文注入、迁移清理；
    前端 `renderer:typecheck` / `renderer:build` / `npm test`；Electron 壳 `desktop:test`。

## 6. 留给实施者决定

- 通用写作台组件的具体拆分方式（先复制再抽象 vs 直接参数化）。
- 模板原文的存储形态（`skeleton.json` 内嵌 vs 独立 `template_text.json`）：采用内嵌。
- 旧数据清理的触发时机（启动 vs 首次打开工作区）：采用「打开工作区时跑一次 + 标记文件」。
- 取证单是否需要「疑点看板」侧栏：暂不需要，疑点作为来源标签展示。