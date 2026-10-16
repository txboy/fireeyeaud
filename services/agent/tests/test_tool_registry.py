from fireeyeaud_agent.tools.registry import build_langchain_tools, build_tool_dict


def test_registry_has_phase1_tools():
    names = set(build_tool_dict().keys())
    assert {
        "describe_source",
        "sql_query",
        "run_rule",
        "parse_ledger",
        "aggregate_subject",
        "check_tie",
        "kb_search",
        "load_skill",
    } <= names


def test_registry_has_file_tools():
    names = set(build_tool_dict().keys())
    assert {"list_files", "read_file", "search_files"} <= names


def test_build_langchain_tools(tmp_path):
    tools = build_langchain_tools(tmp_path)
    names = {t.name for t in tools}
    assert "describe_source" in names
    assert "kb_search" in names
    assert "run_rule" in names
    assert {"list_files", "read_file", "search_files"} <= names
    assert len(tools) == 11


def test_read_file_tool_is_async(tmp_path):
    tools = {t.name: t for t in build_langchain_tools(tmp_path)}
    assert tools["read_file"].coroutine is not None
    assert tools["list_files"].coroutine is None
