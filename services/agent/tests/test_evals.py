import pytest

from evals.cases import CASES
from evals.runner import run_case


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
async def test_eval_case(case):
    result = await run_case(case)
    assert result.done, "agent did not finish with done"
    assert result.tools == case.expect_tools
    for needle in case.expect_answer_contains:
        assert needle in result.answer
    assert result.answer != ""
