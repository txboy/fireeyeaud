from langchain_core.messages import AIMessage, HumanMessage

from fireeyeaud_agent.agent.token_budget import (
    Budget,
    compute_budget,
    estimate_messages_tokens,
    estimate_tokens,
    heuristic_tokens,
    resolve_context_window,
    resolve_reserve_output,
)


def test_heuristic_tokens_cjk():
    assert heuristic_tokens("审计") == 2


def test_heuristic_tokens_latin():
    assert heuristic_tokens("abcd") == 1
    assert heuristic_tokens("abcde") == 2


def test_heuristic_tokens_mixed():
    # 2 个 CJK + 4 个拉丁字符 → 2 + 1
    assert heuristic_tokens("审计abcd") == 3


def test_heuristic_tokens_empty():
    assert heuristic_tokens("") == 0


def test_heuristic_tokens_very_long():
    text = "审" * 50_000
    assert heuristic_tokens(text) == 50_000


def test_estimate_tokens_empty_and_positive():
    assert estimate_tokens("") == 0
    assert estimate_tokens("审计规则") > 0


def test_estimate_tokens_monotonic():
    short = estimate_tokens("审计")
    long = estimate_tokens("审计" * 1000)
    assert long >= short


def test_estimate_messages_tokens_sums_content():
    messages = [HumanMessage(content="你好"), AIMessage(content="world")]
    total = estimate_messages_tokens(messages)
    assert total == sum(estimate_tokens(m.content) for m in messages)


def test_estimate_messages_tokens_handles_text_blocks():
    messages = [
        HumanMessage(content=[{"type": "text", "text": "看到这张图"}]),
    ]
    assert estimate_messages_tokens(messages) >= estimate_tokens("看到这张图")


def test_resolve_context_window_prefers_profile():
    assert resolve_context_window({"contextWindow": 131072}, default=8192) == 131072


def test_resolve_context_window_falls_back():
    assert resolve_context_window(None, default=8192) == 8192
    assert resolve_context_window({}, default=8192) == 8192
    assert resolve_context_window({"contextWindow": 0}, default=8192) == 8192
    assert resolve_context_window({"contextWindow": None}, default=8192) == 8192


def test_resolve_reserve_output():
    assert resolve_reserve_output({"maxOutputTokens": 8192}, default=4096) == 8192
    assert resolve_reserve_output({}, default=4096) == 4096


def test_compute_budget_arithmetic():
    budget = compute_budget(
        window=100_000,
        reserve_output=4_096,
        safety_factor=0.8,
        threshold=0.9,
    )
    assert isinstance(budget, Budget)
    assert budget.window == 100_000
    assert budget.available == 100_000 - 4_096
    assert budget.safe == int((100_000 - 4_096) * 0.8)
    assert budget.trigger == int(budget.safe * 0.9)


def test_compute_budget_small_window_not_negative():
    budget = compute_budget(
        window=2_000, reserve_output=4_096, safety_factor=0.8, threshold=0.9
    )
    assert budget.available == 0
    assert budget.safe == 0
    assert budget.trigger == 0
