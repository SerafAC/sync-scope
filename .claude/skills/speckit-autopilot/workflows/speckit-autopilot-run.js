export const meta = {
  name: 'speckit-autopilot-run',
  description: 'Implement Spec Kit task units one at a time: fresh implementer, skeptical verifier, one commit per unit',
  whenToUse: 'Launched by the speckit-autopilot skill with units derived from tasks.md by units.py',
}

// args (prepared by the speckit-autopilot skill; this script cannot read files):
// {
//   feature: '003-nocturnal-redesign',          // spec dir name, used in commit messages
//   featureDir: 'specs/003-nocturnal-redesign', // repo-relative
//   implementCommand: '.claude/skills/speckit-implement/SKILL.md',
//   unitsScript: '/abs/path/to/units.py',
//   testCommand: 'npm test --prefix frontend && go test ./...',
//   coversAll: true,                            // units.py covers_all: finishing = all_done
//   units: [{phase, title, task_ids, ids_label, done, total, part}],
// }

const A = args || {}
if (!A.feature || !A.featureDir || !Array.isArray(A.units) || !A.units.length) {
  return { status: 'failed', summary: 'speckit-autopilot-run needs args {feature, featureDir, units[], ...}; got ' + JSON.stringify(A).slice(0, 300) }
}
const TASKS = `${A.featureDir}/tasks.md`
const DECISIONS = `${A.featureDir}/decisions.md`
const TEST_CMD = A.testCommand || ''

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked', 'needs_decision', 'failed'] },
    completed_ids: { type: 'array', items: { type: 'string' } },
    question: { type: 'string', description: 'Required when blocked/needs_decision: one concrete question for the human' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, description: { type: 'string' } },
        required: ['label', 'description'],
      },
      description: '2-4 mutually exclusive answers, recommended one first',
    },
    summary: { type: 'string' },
  },
  required: ['status', 'completed_ids', 'summary'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    unchecked_ids: { type: 'array', items: { type: 'string' }, description: 'Unit task IDs still unchecked per units.py' },
    tests_passed: { type: 'boolean' },
    expected_failures: { type: 'array', items: { type: 'string' }, description: 'Failing tests that tasks.md says must fail until a later, still-open task' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'unchecked_ids', 'tests_passed', 'problems'],
}

const COMMIT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    message: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    problem: { type: 'string' },
  },
  required: ['committed'],
}

const CONTEXT = `Feature: ${A.feature}
Feature dir: ${A.featureDir}
Tasks file: ${TASKS}
Decision log: ${DECISIONS} (human answers to earlier questions; binding — read it if it exists)`

function unitHeader(u) {
  return `Unit: ${u.title}${u.part ? ` (part ${u.part})` : ''}
Task IDs in this unit (and ONLY these): ${u.task_ids.join(', ')}`
}

function implementPrompt(u, problems) {
  const fix = problems
    ? `\nTHIS IS A FIX ATTEMPT. A verifier rejected the previous attempt at this unit with these problems:\n${problems.map(p => `- ${p}`).join('\n')}\nThe earlier work is still in the working tree. Fix these problems; do not start over.\n`
    : ''
  return `You are implementing one unit of a GitHub Spec Kit feature.

${CONTEXT}
${unitHeader(u)}
${fix}
Steps:
1. Read ${A.featureDir}/spec.md, ${A.featureDir}/plan.md and ${DECISIONS} (if it exists) first. Then read the Spec Kit implement instructions at ${A.implementCommand || '(not found — use the Spec Kit /speckit.implement conventions)'} and follow them, restricted to the task IDs above. Read any other design docs they list (data-model.md, contracts/, research.md, constitution) as needed.
2. Deviations from the implement instructions, because an orchestrator is driving you:
   - Do the listed task IDs only, in file order. Do NOT edit, implement or tick any other task in tasks.md, even if it looks trivial.
   - Skip the checklist gate (the orchestrator already handled it) and skip ALL extension hooks (before_implement/after_implement). If a mandatory hook exists, mention it in your summary.
   - Do not commit, stash, reset, or push. Leave all changes in the working tree.
   - Nobody can answer you mid-run. If you hit something only a human can decide or do (ambiguous requirement not settled by the decision log, missing credentials/hardware/service, a choice with real trade-offs), stop and return status "needs_decision" (a choice) or "blocked" (a human action) with ONE concrete question and 2-4 options, recommended first.
3. As each task is finished, change its "- [ ]" to "- [X]" in ${TASKS} immediately. Only tick a task that is genuinely complete.
4. Test-first tasks: if a task says to write a failing test, the test must exist and fail for the right reason; that is success for that task.
5. Run the relevant tests${TEST_CMD ? ` (project test command: \`${TEST_CMD}\`)` : ''} before returning.

Return status "done" only if every task ID in this unit is implemented and ticked. Use "failed" for errors you could not resolve yourself. completed_ids = the IDs you ticked in this attempt.`
}

function verifyPrompt(u, impl) {
  return `You are a skeptical verifier for one unit of a Spec Kit feature. Assume the implementer overstated its progress until the code proves otherwise. Do NOT modify any file.

${CONTEXT}
${unitHeader(u)}
Implementer's claim: status=${impl.status}, completed=${JSON.stringify(impl.completed_ids)}. Summary: ${impl.summary}

1. Checkbox state (deterministic, do not eyeball): run
   python3 ${A.unitsScript} ${TASKS} --scope "tasks ${u.task_ids.join(', ')}" --max-tasks 0
   Every task ID still listed in its "units" is unchecked. Report them as unchecked_ids.
2. For each task ID in the unit, read its description in ${TASKS} and inspect the working-tree changes (git status, git diff, and new untracked files). Confirm the described work really exists and matches spec.md/plan.md. Stubs, TODOs, skipped tests and hollow implementations are problems.
3. Confirm nothing outside this unit was changed in ${TASKS} (no other checkboxes flipped or text edited).
4. ${TEST_CMD ? `Run the test command: \`${TEST_CMD}\`` : 'No test command was configured. Find and run the project\'s tests if obvious, otherwise say so in problems'}. tests_passed = it exits 0. If it fails ONLY because of tests that tasks.md explicitly says must fail until a later task (test-first, where that later task is still unchecked and outside this unit), list them in expected_failures and treat them as acceptable. Any other failure is a problem.

ok = no unchecked_ids AND the work is really implemented AND (tests_passed OR every failure is an expected failure) AND tasks.md is untouched outside the unit. Put each concrete, actionable defect in problems (file:line where possible).`
}

function commitPrompt(u) {
  return `Commit the working-tree changes for one finished unit of a Spec Kit feature. Never push.

${CONTEXT}
${unitHeader(u)}

1. Run git status and git diff --stat. The tree was clean before this unit started (or held earlier unfinished work for the same feature), so the changes belong to this feature. Stage them by explicit path: never "git add -A" or "git add .". Leave out anything that looks like a secret (.env, keys, credentials), editor or OS junk, and build output that should be gitignored. Name every file you left out in "problem".
2. Work out the ticked IDs from git diff of ${TASKS}: the task IDs whose "- [ ]" became "- [X]". Compact consecutive IDs into ranges, e.g. [T011-T013, T015].
3. Commit with exactly this subject line:
   feat(${A.feature}): ${u.title.replace(/^Phase\s+\d+\s*[:.\-–—]?\s*/i, '')} [<ranges from step 2>]
   Add a short body (2-5 lines) listing what was implemented. Do not use --no-verify. If a pre-commit hook fails because of formatting, run the formatter it names, restage and retry once. Otherwise return committed=false with the hook output in problem.
4. Return the new commit's short sha, its full message, and the committed files.`
}

// ---- run units sequentially ----
const commits = []
const finished = []

for (const u of A.units) {
  const label = u.ids_label || u.task_ids.join(',')
  phase(u.title + (u.part ? ` (${u.part})` : ''))
  log(`${u.title} [${label}]`)

  let impl = await agent(implementPrompt(u, null), { label: `implement ${label}`, schema: IMPL_SCHEMA })
  if (!impl) return { status: 'failed', unit: u, summary: 'Implementer agent died or was skipped.', commits, finished }
  if (impl.status !== 'done') {
    return { status: impl.status, unit: u, question: impl.question, options: impl.options, completed_ids: impl.completed_ids, summary: impl.summary, commits, finished }
  }

  let verdict = await agent(verifyPrompt(u, impl), { label: `verify ${label}`, schema: VERIFY_SCHEMA })
  if (!verdict) return { status: 'failed', unit: u, summary: 'Verifier agent died or was skipped.', commits, finished }

  // Stall rule: the agent claims done, but not a single checkbox of the unit was ticked.
  if (verdict.unchecked_ids.length === u.task_ids.length) {
    return {
      status: 'blocked', unit: u, commits, finished,
      question: `The implementer said ${label} was done, but none of those checkboxes were ticked in tasks.md. How should autopilot proceed?`,
      options: [
        { label: 'Retry the unit', description: 'Run a fresh implementer on it' },
        { label: 'Skip the unit', description: 'Leave it for manual work and continue' },
        { label: 'Stop', description: 'End the run here' },
      ],
      summary: `Stalled. Implementer summary: ${impl.summary}`,
    }
  }

  if (!verdict.ok) {
    log(`verify failed (${verdict.problems.length} problems), one fix attempt`)
    const fix = await agent(implementPrompt(u, verdict.problems), { label: `fix ${label}`, schema: IMPL_SCHEMA })
    if (!fix) return { status: 'failed', unit: u, summary: 'Fix agent died or was skipped.', problems: verdict.problems, commits, finished }
    if (fix.status !== 'done') {
      return { status: fix.status, unit: u, question: fix.question, options: fix.options, completed_ids: fix.completed_ids, summary: fix.summary, problems: verdict.problems, commits, finished }
    }
    verdict = await agent(verifyPrompt(u, fix), { label: `re-verify ${label}`, schema: VERIFY_SCHEMA })
    if (!verdict || !verdict.ok) {
      return {
        status: 'verify_failed', unit: u, commits, finished,
        problems: verdict ? verdict.problems : ['re-verifier agent died or was skipped'],
        tests_passed: verdict ? verdict.tests_passed : null,
        summary: 'Still failing verification after one fix attempt. Changes are left uncommitted in the working tree.',
      }
    }
  }

  const commit = await agent(commitPrompt(u), { label: `commit ${label}`, schema: COMMIT_SCHEMA, effort: 'low' })
  if (!commit || !commit.committed) {
    return { status: 'failed', unit: u, summary: `Commit failed: ${commit ? commit.problem : 'committer agent died'}`, commits, finished }
  }
  commits.push({ sha: commit.sha, message: commit.message, unit: label })
  finished.push({ title: u.title, part: u.part, task_ids: u.task_ids, expected_failures: verdict.expected_failures || [] })
}

return {
  status: A.coversAll ? 'all_done' : 'scope_done',
  commits,
  finished,
  summary: `${finished.length} unit(s) implemented, verified and committed.`,
}
