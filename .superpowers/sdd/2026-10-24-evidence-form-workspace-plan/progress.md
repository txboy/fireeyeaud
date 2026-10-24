# SDD ledger — plan: docs/plans/2026-10-24-evidence-form-workspace-plan.md

Spec: docs/plans/2026-10-24-evidence-form-workspace-design.md

## Pre-flight scan

- Task 1 → Task 4/7/9/10/12: `evidence_forms.forms_dir / next_form_id / save_manifest / load_manifest
  / snapshot_finding` — Task 1 定义，后续消费，一致。
- Task 2 → Task 4/7: `report_skeleton.template_text(path)` 与 `analyze_template()["templateText"]`
  — Task 4 存库、Task 7 注入，一致。
- Task 3 → Task 4/6: `docx_blocks` 公开函数名 — Task 4 只用 `normalize_blocks / normalize_outline`，
  Task 6 用 `clear_body / add_text / heading_style / write_cell / apply_style`，一致。
- Task 4 → Task 5/6/8: `form_docs.create_form / get_document / set_findings / set_outline / write_section
  / set_title / append_chat / load_chat` — 一致。
- Task 5 → Task 6/7/8: `form_verify.verify_form(root, form_id) -> dict` — 一致。
- Task 7 → Task 8: `form_agent.stream_form_chat` — 一致。
- Task 11 → Task 12/13: `EvidenceFormDocument / EvidenceFormBody / streamFormChat / createFormDraft` — 一致。
- Ruling (预检): Task 3 的测试引用 `report_docs._dir` 等私有名，搬移时只搬渲染原语，
  `_dir / _load_manifest / _load_body / _load_skeleton / _save_* / _form_snapshot / _revision`
  留在 `report_docs.py` — 与 Task 3 Step 3 结尾说明一致 — cost if wrong: 报告测试批量报错，直接可见。

## Progress

Task 1: Ruling: 旧渲染链路的测试 `tests/test_reports.py`（旧报告 preview/commit）与
  `tests/test_evidence_forms_api.py`（旧取证单 preview/commit）在删除 store 函数后必然失败 —
  前者在 Task 14 整文件删除，后者在 Task 8 重写；Task 1 提交时这两处为已知红灯 —
  cost if wrong: 若 Task 8/14 漏做，CI 会一直红，不会静默。
Task 1: complete (tests: pytest tests/test_evidence_forms.py → 5 passed)Task 2: complete (tests: pytest tests/test_report_skeleton.py tests/test_report_docs.py -> 22 passed)
Task 3: complete (tests: pytest test_report_docs + test_report_workspace_api + test_report_agent_tools -> 24 passed, same as baseline)
