#!/usr/bin/env python3
"""Derive the remaining work units from a Spec Kit tasks.md.

The checkboxes in tasks.md are the only source of truth: this script keeps no
state, so any run can be stopped and restarted and will pick up where the
file says work stands.

Usage:
    units.py TASKS_MD [--scope SCOPE] [--max-tasks N] [--exclude IDS]

Scope grammar (case-insensitive, default = everything remaining):
    all                       everything remaining
    4 phases | next 4 phases  the next 4 phases that still have open tasks
    phase 3 | phases 3-5      those phases (lists allowed: "phases 3, 5, 7-8")
    tasks T011-T015, T040     only those task IDs, grouped by phase
    US2 | US2, US3            tasks tagged with those user stories

Output (stdout, JSON):
    {
      "tasks_file": str, "scope": str,
      "all_done": bool,            # no unchecked task anywhere in the file
      "total": int, "remaining": int,
      "covers_all": bool,          # the units hold every open task (finishing = all_done)
      "units": [{"phase": int|null, "title": str, "task_ids": [str],
                 "ids_label": str, "done": int, "total": int, "part": str|null}],
      "warnings": [str]
    }
Exit codes: 0 ok, 2 bad arguments/scope, 3 unreadable tasks file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field

PHASE_RE = re.compile(r"^##\s+Phase\s+(\d+)\b\s*[:.\-–—]?\s*(.*?)\s*$", re.IGNORECASE)
SECTION_RE = re.compile(r"^##\s+(?!#)(.*?)\s*$")
TASK_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(T(\d+)[a-z]?)\b(.*)$")
STORY_RE = re.compile(r"\[(US\d+)\]", re.IGNORECASE)


class ScopeError(ValueError):
    pass


@dataclass
class Task:
    id: str
    num: int
    done: bool
    stories: set[str]
    description: str


@dataclass
class Section:
    phase: int | None  # None for non-phase "## ..." sections that hold tasks
    title: str
    tasks: list[Task] = field(default_factory=list)

    @property
    def open_tasks(self) -> list[Task]:
        return [t for t in self.tasks if not t.done]

    @property
    def done_count(self) -> int:
        return sum(t.done for t in self.tasks)


def parse(text: str) -> list[Section]:
    """Return the sections of tasks.md that contain at least one task, in file order."""
    sections: list[Section] = []
    current: Section | None = None
    in_fence = False
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = PHASE_RE.match(line)
        if m:
            current = Section(int(m.group(1)), line[2:].strip())
            sections.append(current)
            continue
        m = SECTION_RE.match(line)
        if m:
            current = Section(None, m.group(1))
            sections.append(current)
            continue
        m = TASK_RE.match(line)
        if m:
            if current is None:
                current = Section(None, "(no phase)")
                sections.append(current)
            desc = m.group(4).strip()
            current.tasks.append(Task(
                id=m.group(2).upper(),
                num=int(m.group(3)),
                done=m.group(1).lower() == "x",
                stories={s.upper() for s in STORY_RE.findall(desc)},
                description=STORY_RE.sub("", desc).replace("[P]", "").strip(),
            ))
    return [s for s in sections if s.tasks]


def _int_list(spec: str) -> list[int]:
    """'3, 5, 7-8' -> [3, 5, 7, 8]"""
    out: list[int] = []
    for part in re.split(r"\s*,\s*|\s+and\s+|\s+", spec.strip()):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\s*(?:-|–|\.\.|to)\s*(\d+)", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if a > b:
                raise ScopeError(f"descending range: {part}")
            out.extend(range(a, b + 1))
        elif part.isdigit():
            out.append(int(part))
        else:
            raise ScopeError(f"not a number or range: {part!r}")
    return out


def _task_ranges(spec: str) -> list[tuple[int, int]]:
    """'T011-T015, T040' -> [(11, 15), (40, 40)]"""
    ranges = []
    for part in re.split(r"\s*,\s*|\s+", spec.strip()):
        if not part:
            continue
        m = re.fullmatch(r"T(\d+)[a-z]?(?:\s*(?:-|–|\.\.)\s*T?(\d+)[a-z]?)?", part, re.IGNORECASE)
        if not m:
            raise ScopeError(f"not a task ID or range: {part!r}")
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if a > b:
            raise ScopeError(f"descending range: {part}")
        ranges.append((a, b))
    return ranges


def select(sections: list[Section], scope: str) -> tuple[list[tuple[Section, list[Task]]], list[str]]:
    """Apply the scope; return [(section, open tasks in scope)] in file order, plus warnings."""
    s = re.sub(r"\s+", " ", (scope or "").strip()).lower()
    # Normalise "T011 - T015" so range parsing sees one token.
    s = re.sub(r"\s*(-|–|\.\.)\s*", r"\1", s)
    warnings: list[str] = []
    pending = [(sec, sec.open_tasks) for sec in sections if sec.open_tasks]

    if s in ("", "all", "everything", "remaining", "all remaining"):
        return pending, warnings

    m = re.fullmatch(r"(?:next )?(\d+) phases?", s)
    if m:
        n = int(m.group(1))
        if n < 1:
            raise ScopeError("phase count must be >= 1")
        return pending[:n], warnings

    m = re.fullmatch(r"phases? (.+)", s)
    if m:
        wanted = _int_list(m.group(1))
        known = {sec.phase for sec in sections}
        for p in wanted:
            if p not in known:
                warnings.append(f"phase {p} not found in tasks.md")
            elif not any(sec.phase == p and sec.open_tasks for sec in sections):
                warnings.append(f"phase {p} already complete")
        return [(sec, open_) for sec, open_ in pending if sec.phase in wanted], warnings

    m = re.fullmatch(r"(?:tasks? )?(t\d.*)", s)
    if m:
        ranges = _task_ranges(m.group(1))
        in_scope = lambda t: any(a <= t.num <= b for a, b in ranges)  # noqa: E731
        all_tasks = [t for sec in sections for t in sec.tasks]
        for a, b in ranges:
            if not any(a <= t.num <= b for t in all_tasks):
                warnings.append(f"no tasks match T{a:03d}" + (f"-T{b:03d}" if b != a else ""))
        done = [t.id for t in all_tasks if t.done and in_scope(t)]
        if done:
            warnings.append("already done, skipped: " + ", ".join(done))
        picked = [(sec, [t for t in open_ if in_scope(t)]) for sec, open_ in pending]
        return [(sec, ts) for sec, ts in picked if ts], warnings

    if re.fullmatch(r"us\d+(?:(?:,| |, | and )us\d+)*", s):
        stories = {x.upper() for x in re.findall(r"us\d+", s)}
        tagged = {st for sec in sections for t in sec.tasks for st in t.stories}
        for st in sorted(stories - tagged):
            warnings.append(f"no tasks tagged [{st}]")
        for st in sorted(stories & tagged):
            if not any(st in t.stories and not t.done for sec in sections for t in sec.tasks):
                warnings.append(f"all [{st}] tasks already done")
        picked = [(sec, [t for t in open_ if t.stories & stories]) for sec, open_ in pending]
        return [(sec, ts) for sec, ts in picked if ts], warnings

    raise ScopeError(
        f"unrecognised scope {scope!r}; expected e.g. 'all', '4 phases', 'phase 3', "
        "'phases 3-5', 'tasks T011-T015, T040', 'US2'"
    )


def ids_label(tasks: list[Task]) -> str:
    """Compact contiguous runs: T011,T012,T013,T015 -> 'T011-T013, T015'."""
    parts: list[str] = []
    i = 0
    while i < len(tasks):
        j = i
        while j + 1 < len(tasks) and tasks[j + 1].num == tasks[j].num + 1:
            j += 1
        parts.append(tasks[i].id if i == j else f"{tasks[i].id}-{tasks[j].id}")
        i = j + 1
    return ", ".join(parts)


def build(text: str, scope: str = "", max_tasks: int = 8, tasks_file: str = "",
          exclude: str = "") -> dict:
    sections = parse(text)
    selected, warnings = select(sections, scope)
    if exclude.strip():
        skip = _task_ranges(re.sub(r"\s*(-|–|\.\.)\s*", r"\1", exclude))
        keep = lambda t: not any(a <= t.num <= b for a, b in skip)  # noqa: E731
        selected = [(sec, [t for t in ts if keep(t)]) for sec, ts in selected]
        selected = [(sec, ts) for sec, ts in selected if ts]
    units = []
    for sec, tasks in selected:
        size = max_tasks if max_tasks > 0 else len(tasks)
        chunks = [tasks[i:i + size] for i in range(0, len(tasks), size)]
        for n, chunk in enumerate(chunks, 1):
            units.append({
                "phase": sec.phase,
                "title": sec.title,
                "task_ids": [t.id for t in chunk],
                "ids_label": ids_label(chunk),
                "done": sec.done_count,
                "total": len(sec.tasks),
                "part": f"{n}/{len(chunks)}" if len(chunks) > 1 else None,
            })
    all_tasks = [t for sec in sections for t in sec.tasks]
    if not all_tasks:
        warnings.append("no tasks found (expected lines like '- [ ] T001 description')")
    remaining = sum(not t.done for t in all_tasks)
    in_units = sum(len(u["task_ids"]) for u in units)
    return {
        "tasks_file": tasks_file,
        "scope": scope or "all",
        "all_done": bool(all_tasks) and remaining == 0,
        "total": len(all_tasks),
        "remaining": remaining,
        "covers_all": remaining > 0 and in_units == remaining,
        "units": units,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tasks_md")
    ap.add_argument("--scope", default="", help="see module docstring")
    ap.add_argument("--max-tasks", type=int, default=8,
                    help="split a phase into units of at most N tasks (0 = never split)")
    ap.add_argument("--exclude", default="",
                    help="task IDs/ranges to leave out, e.g. 'T011-T013,T040' (skipped units)")
    args = ap.parse_args(argv)
    try:
        with open(args.tasks_md, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        print(json.dumps({"error": f"cannot read {args.tasks_md}: {e.strerror}"}))
        return 3
    try:
        result = build(text, args.scope, args.max_tasks, args.tasks_md, args.exclude)
    except ScopeError as e:
        print(json.dumps({"error": str(e)}))
        return 2
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
