# 项目报告工作台（A+B）实施计划

日期：2026-10-22
状态：实施中

## 1. 目标

把「项目报告」从「选模板 → 填字段 → 渲染一次」改成「和 LLM 一起写出符合模板格式的报告」：

- 左侧成果栏「项目报告」分上下两栏：上栏报告记录（可新建），下栏本项目取证单（可点击查看）。
- 新建 / 编辑报告 → 右侧开一个报告 tab：左边对话，右边实时预览。
- LLM 感知当前勾选的取证单、报告模板骨架，先给大纲，再逐节写正文。
- 正文是结构化数据（章节 / 段落 / 列表 / 表格），导出时才写回模板样式生成 docx。

## 2. 方案（A+B）

**A. 模板深解析**
模板 docx 解析出：页面设置、标题样式、各级标题样式、正文样式（字体 / 字号 / 加粗 / 行距 / 首行缩进 / 段前后）、表格样式、章节骨架、固定段落。
导出时以模板文件为底（保留 styles.xml、页眉页脚、节设置），清空正文后按骨架样式写入，因此字体、磅值、行距、页边距全部来自模板，模型无法写坏。

**B. 大纲 → 逐节生成 → 机器校验**
1. 模型先输出大纲（章节标题 / 层级 / 写作要点 / 引用取证单），用户在预览区确认。
2. 按节生成结构化正文，每个段落块必须带 `sourceRefs`（取证单编号）或标记来源为用户指令。
3. 校验器检查：章节完整性、空节、无来源段落、引用了未选中的取证单、报告中的金额是否都能在取证单里找到。
4. 校验通过后可导出 docx；有错误时导出按钮拦截并展示问题。

## 3. 数据模型

报告目录 `.fireeye/artifacts/reports/RPT-xxxx/`：

```
manifest.json    报告元数据（status: draft|saved）
body.json        结构化正文（大纲 + 章节 + 块）
skeleton.json    模板骨架（创建时固化，导出复用）
template.docx    模板副本
document.docx    导出产物（保存后才有）
chat.jsonl       报告对话记录
```

`body.json`：

```jsonc
{
  "schemaVersion": 1,
  "title": "…",
  "outlineApproved": true,
  "selectedFormIds": ["QZ-0001"],
  "sections": [
    {
      "id": "S1",
      "title": "一、基本情况",
      "level": 1,
      "goal": "说明审计范围与依据",
      "blocks": [
        { "type": "paragraph", "text": "…", "sourceRefs": ["QZ-0001"], "origin": "form" },
        { "type": "bullets", "items": ["…"], "sourceRefs": ["QZ-0001"] },
        { "type": "table", "columns": ["…"], "rows": [["…"]], "sourceRefs": ["QZ-0001"] }
      ]
    }
  ]
}
```

`skeleton.json` 关键字段：`page`、`title`、`body`、`headings[{level, style}]`、`sections[{title, level, sampleText}]`、`table`、`preamble[]`、`warnings[]`。

## 4. 任务

### T1 模板骨架解析
`store/report_skeleton.py` + `tests/test_report_skeleton.py`
- 页面设置、标题 / 标题级别 / 正文 / 表格样式提取（含 eastAsia 字体）。
- 章节识别：样式名 / outlineLvl / 加粗且字号更大三级回退。
- 无标题时给警告，不阻塞。

### T2 报告草稿与导出
`store/report_docs.py` + `tests/test_report_docs.py`
- 创建草稿（模板副本、骨架、初始大纲、清单）。
- 读写大纲 / 章节；章节块归一化（类型、来源、长度上限）。
- 导出：模板清空正文 → 按骨架样式写标题、章节、段落、列表、表格 → `document.docx`。
- 导出后 `status=saved`。

### T3 校验器
`store/report_verify.py` + `tests/test_report_verify.py`
- 大纲完整性、空章节、无来源段落、非法取证单引用、金额可追溯。
- 返回结构化 `errors/warnings`。

### T4 报告对话（LLM）
`agent/report_agent.py` + `tests/test_report_agent_tools.py`
- 工具：`report_context` / `report_set_outline` / `report_write_section` / `report_verify`。
- 系统提示：只依据选中取证单与用户指令；先大纲后正文；不得编造金额、编号。
- SSE 事件：`delta` / `tool` / `report` / `error` / `done`。
- 对话记录追加 `chat.jsonl`。

### T5 API
`api/reports.py` 扩展 + `tests/test_report_workspace_api.py`
- `POST /reports/drafts`、`GET /reports/{id}/doc`、`PUT .../outline`、`PUT .../sections/{sid}`、`POST .../verify`、`POST .../export`、`GET .../messages`、`POST .../chat`。
- 列表区分草稿与已保存。

### T6 前端
- `ReportsView` 上下分栏：报告记录 / 取证单。
- 新报告弹窗：选模板、勾选取证单、标题、页眉字段。
- 右侧新增 `report` tab：`ReportWorkspace`（左聊天、右预览）。
- 大纲确认、校验结果、导出 Word、docx 预览。
- 文案中英同步。

### T7 验证
- `pytest`、`npm run renderer:typecheck`、`renderer:build`、`desktop:test`、`npm test`。
- fresh-context 评审 + 修复。

## 5. 验收

- 新建报告后右侧 tab 打开，聊天能拿到模板骨架与选中取证单。
- 模型先出大纲，确认后逐节写入，预览实时更新。
- 未带来源的段落 / 编造金额被校验器指出，导出被拦截。
- 导出 docx 的标题、正文、表格字体字号行距与模板一致。
- 左侧取证单可点击查看。
- 原有模板生成流程（P2/P3）不受影响。

## 6. 决定

1. 报告正文以结构化 JSON 为唯一事实来源，docx 是导出产物。
2. 导出用「模板文件 + 清空正文 + 骨架样式」而不是自己排版，保证格式继承。
3. 报告对话独立于通用会话，聊天记录存报告目录，避免污染会话列表。
4. 草稿使用正式编号 `RPT-xxxx`（`status=draft`），保存后转 `saved`；编号不回收，与现有重建逻辑兼容。
5. 取证单查看复用现有 docx 预览 tab，不新建查看器。
