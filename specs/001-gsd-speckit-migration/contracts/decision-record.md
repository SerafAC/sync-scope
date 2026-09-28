# Contract: Decision Record

**Location**: `docs/decisions/00NN-<kebab-slug>.md`, where `NN` is the GSD D-ID number (D003 →
`0003-directory-agnostic-sync-matching.md`). New decisions made after the migration continue the sequence
from `0016`.

**Index**: `docs/decisions/README.md` lists every record with its ID, title, status and the date it was
decided.

## Template

```markdown
# D0NN: <Decision question as a title>

- **Status**: Accepted | Superseded by [D0xx](./00xx-….md)
- **Date / context**: <GSD "When" column>
- **Scope**: architecture | library | security | testing | observability | environment
- **Made by**: human | agent | collaborative
- **Revisable**: <GSD "Revisable?" column, verbatim meaning>

## Context
<The question and the constraints behind it>

## Decision
<GSD "Choice" column>

## Rationale
<GSD "Rationale" column, minus the rejected alternatives>

## Alternatives rejected
- <alternative> — <why rejected>

## Related
- Requirements: R0xx, …
- Features: specs/00x-…
```

## Rules

- Records are append-only in meaning. To reverse a decision, write a new record and set the old record's
  status to `Superseded by`. This keeps GSD's append-only rule.
- Every section is required. Write `none` when GSD recorded nothing for it.
- Specs and plans link to decision records instead of restating rationale (Principle III).
