# SDD ledger â€” plan: docs/plans/2026-10-24-evidence-form-workspace-plan.md

Spec: docs/plans/2026-10-24-evidence-form-workspace-design.md

## Pre-flight scan

- Task 1 â†’ Task 4/7/9/10/12: `evidence_forms.forms_dir / next_form_id / save_manifest / load_manifest
  / snapshot_finding` â€” Task 1 å®šä¹‰ï¼Œåç»­æ¶ˆè´¹ï¼Œä¸€è‡´ã€‚
- Task 2 â†’ Task 4/7: `report_skeleton.template_text(path)` ä¸ `analyze_template()["templateText"]`
  â€” Task 4 å­˜åº“ã€Task 7 æ³¨å…¥ï¼Œä¸€è‡´ã€‚
- Task 3 â†’ Task 4/6: `docx_blocks` å…¬å¼€å‡½æ•°å â€” Task 4 åªç”¨ `normalize_blocks / normalize_outline`ï¼Œ
  Task 6 ç”¨ `clear_body / add_text / heading_style / write_cell / apply_style`ï¼Œä¸€è‡´ã€‚
- Task 4 â†’ Task 5/6/8: `form_docs.create_form / get_document / set_findings / set_outline / write_section
  / set_title / append_chat / load_chat` â€” ä¸€è‡´ã€‚
- Task 5 â†’ Task 6/7/8: `form_verify.verify_form(root, form_id) -> dict` â€” ä¸€è‡´ã€‚
- Task 7 â†’ Task 8: `form_agent.stream_form_chat` â€” ä¸€è‡´ã€‚
- Task 11 â†’ Task 12/13: `EvidenceFormDocument / EvidenceFormBody / streamFormChat / createFormDraft` â€” ä¸€è‡´ã€‚
- Ruling (é¢„æ£€): Task 3 çš„æµ‹è¯•å¼•ç”¨ `report_docs._dir` ç­‰ç§æœ‰åï¼Œæ¬ç§»æ—¶åªæ¬æ¸²æŸ“åŸè¯­ï¼Œ
  `_dir / _load_manifest / _load_body / _load_skeleton / _save_* / _form_snapshot / _revision`
  ç•™åœ¨ `report_docs.py` â€” ä¸ Task 3 Step 3 ç»“å°¾è¯´æ˜ä¸€è‡´ â€” cost if wrong: æŠ¥å‘Šæµ‹è¯•æ‰¹é‡æŠ¥é”™ï¼Œç›´æ¥å¯è§ã€‚

## Progress

Task 1: Ruling: æ—§æ¸²æŸ“é“¾è·¯çš„æµ‹è¯• `tests/test_reports.py`ï¼ˆæ—§æŠ¥å‘Š preview/commitï¼‰ä¸
  `tests/test_evidence_forms_api.py`ï¼ˆæ—§å–è¯å• preview/commitï¼‰åœ¨åˆ é™¤ store å‡½æ•°åå¿…ç„¶å¤±è´¥ â€”
  å‰è€…åœ¨ Task 14 æ•´æ–‡ä»¶åˆ é™¤ï¼Œåè€…åœ¨ Task 8 é‡å†™ï¼›Task 1 æäº¤æ—¶è¿™ä¸¤å¤„ä¸ºå·²çŸ¥çº¢ç¯ â€”
  cost if wrong: è‹¥ Task 8/14 æ¼åšï¼ŒCI ä¼šä¸€ç›´çº¢ï¼Œä¸ä¼šé™é»˜ã€‚
Task 1: complete (tests: pytest tests/test_evidence_forms.py â†’ 5 passed)Task 2: complete (tests: pytest tests/test_report_skeleton.py tests/test_report_docs.py -> 22 passed)
Task 3: complete (tests: pytest test_report_docs + test_report_workspace_api + test_report_agent_tools -> 24 passed, same as baseline)
Task 4: Ruling: ²âÊÔÔ­¶ÏÑÔÄ¬ÈÏÈı½Ú´ó¸Ù£¬µ«¼Ğ¾ßÄ£°å×Ô´øÁ½¸ö±êÌâÑùÊ½£¬°´ spec Ó¦È¡Ä£°å´ó¸Ù ¡ª ¸Ä¶ÏÑÔÎªÁ½½Ú ¡ª cost if wrong: ½ö²âÊÔÆÚÍû´íÎó
Task 4: complete (tests: pytest tests/test_form_docs.py -> 6 passed)
Task 5: complete (tests: pytest tests/test_form_verify.py -> 7 passed)
Task 6: Ruling: export_form Óë Task 4 Ò»²¢Ğ´ºÃ£¬²âÊÔÊ×´ÎÔËĞĞ¼´ÂÌ ¡ª ÓÃ±äÒìÑéÖ¤²âÊÔÓĞĞ§ĞÔ£ºÈ¥µôĞ£ÑéÊØÎÀ¡útest_export_blocks_when_verification_fails FAIL£»¸Ä±êÌâ¶ÔÆë¡úÑùÊ½²âÊÔ FAIL£»»Ö¸´ºó 16 passed ¡ª cost if wrong: ÎŞ£¨±äÒìÒÑÖ¤Ã÷²âÊÔÄÜ×¥£©
Task 6: complete (tests: pytest tests/test_form_export.py tests/test_form_docs.py tests/test_form_verify.py -> 16 passed)
