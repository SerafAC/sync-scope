# Contract: Migration Map

**File**: `specs/001-gsd-speckit-migration/migration-map.md`, created during implementation. It is kept
after GSD removal as the permanent migration record.

## Format

The file has one Markdown table per `kind`, in this order: tooling, document, requirement, decision,
memory, slice, task, runtime. Every table has the same columns:

```markdown
| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| R007 | transfer | specs/004-scan-engine-matching/spec.md#FR-00x | [X] |
| MEM018 | discard | Stale: Docker 29.7.2 pin superseded by D015 | [X] |
| .gsd/exec/** | discard | Workflow telemetry; no ongoing value | [X] |
```

## Rules

1. Every item in the inventory below MUST have exactly one row. If a row is missing, the checklist fails.
2. Every `transfer` destination MUST be a path that exists, optionally with `#anchor`.
3. `Verified` is `[X]` only after the destination has been read and its meaning confirmed.
4. After a conflict resolution in the merge (research R2), add a row under `tooling` naming the file and
   which side won.
5. Once the removal commit lands, the map is frozen. After that, only the removal commit hash is added, in
   a footer.

## Required inventory (minimum rows)

| Kind | Items |
| --- | --- |
| requirement | R001–R030 (30) |
| decision | D001–D015 (15) |
| memory | MEM001–MEM022 (22) |
| slice | S01–S07 (7) |
| task | S01/T01–T08 (8) |
| document | `.gsd/PROJECT.md`, `CODEBASE.md`, `CONTEXT.md`, `KNOWLEDGE.md`, `PREFERENCES.md`, `STATE.md`, `ROADMAP.md`, `QUEUE.md`, `last-snapshot.md`, `phases/01-syncscope-v1/{01-ROADMAP,01-CONTEXT,01-01-RESEARCH,01-01-PLAN,S01-CONTINUE}.md`, `S01-T0x-SUMMARY.md`, `forensics/report-*.md` |
| tooling | `.mcp.json`, `.claude/settings.local.json` (GSD entries), `.gitignore` (GSD block), `.bg-shell/`, `.gsd-id`, `.gsd-worktrees/`, `milestone/M001` branch, the master working-tree script edits |
| runtime | `.gsd/{gsd.db*, activity, journal, audit, event-log, runtime, quarantine, backups, recovery-applications, exec, migration, *.json, *.jsonl}` |

The total is at least 82 knowledge rows plus the document, tooling and runtime rows.
