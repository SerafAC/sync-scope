# Fallback: no dynamic workflows

Use this when the Workflow tool is missing, or when launching `workflows/speckit-autopilot-run.js` fails because workflows are disabled. The loop, statuses and handling in SKILL.md stay exactly the same. Only step 3 changes: you run the per-unit pipeline yourself with the **Agent** tool, one fresh subagent per step.

The single source for the prompts is `SKILL_DIR/workflows/speckit-autopilot-run.js`. Read it once, then use its `implementPrompt`, `verifyPrompt` and `commitPrompt` text with the same `args` values filled in. Don't paraphrase them. The restrictions they encode (only these task IDs, skip hooks, never commit or push from the implementer, run units.py for checkbox state) are what make the loop safe.

For each unit, in order:

1. **Implement.** Spawn a general-purpose Agent with the implement prompt. At the end, ask it to reply with a single JSON object `{status, completed_ids, question?, options?, summary}` (the IMPL_SCHEMA). Parse it. If the status isn't `done`, stop and handle it as in SKILL.md step 4.
2. **Verify.** Spawn a new Agent with the verify prompt. Ask for JSON in `{ok, unchecked_ids, tests_passed, expected_failures, problems}` form.
   - **Stall rule:** if `unchecked_ids` still contains every task ID of the unit, treat it as `blocked` ("claimed done, nothing ticked").
   - If `ok` is false: spawn **one** fix Agent (the implement prompt with the problems list), then one more verify Agent. If it still fails, the status is `verify_failed`.
3. **Commit.** Spawn an Agent with the commit prompt. Record its sha and message.
4. Go on to the next unit. After the last one, the status is `all_done` if `covers_all`, else `scope_done`.

You can confirm checkbox state yourself too: re-run `units.py --scope "tasks <ids>"` after the implementer returns. It's cheap and deterministic, and a good cross-check on the verifier.

What you lose without workflows: a live progress tree in `/workflows`, and some of the context isolation, because each subagent's final answer lands in your context. Keep those answers short by asking for the JSON only.
