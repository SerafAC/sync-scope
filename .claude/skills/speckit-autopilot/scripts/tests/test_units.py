import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import units  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "tasks.md"
TEXT = FIXTURE.read_text(encoding="utf-8")


def run(scope="", max_tasks=0):
    return units.build(TEXT, scope, max_tasks)


def ids(result):
    return [u["task_ids"] for u in result["units"]]


class ParseTests(unittest.TestCase):
    def test_phases_and_counts(self):
        secs = units.parse(TEXT)
        self.assertEqual([s.phase for s in secs], [1, 2, 3, 4, 5, 6])
        p3 = secs[2]
        self.assertEqual(p3.title, "Phase 3: User Story 1 – Upload a file (Priority: P1) 🎯 MVP")
        self.assertEqual((p3.done_count, len(p3.tasks)), (1, 5))

    def test_checked_marks_both_cases(self):
        secs = units.parse(TEXT)
        self.assertTrue(all(t.done for t in secs[0].tasks))  # [x] and [X]

    def test_ignores_idless_checkboxes_and_fenced_code(self):
        all_ids = [t.id for s in units.parse(TEXT) for t in s.tasks]
        self.assertNotIn("T999", all_ids)
        self.assertEqual(len(all_ids), 19)

    def test_story_tags(self):
        t6 = units.parse(TEXT)[2].tasks[0]
        self.assertEqual(t6.stories, {"US1"})
        self.assertEqual(t6.description, "Write failing upload test")


class ScopeTests(unittest.TestCase):
    def test_default_is_everything_remaining_in_order(self):
        r = run()
        self.assertEqual(ids(r), [
            ["T004", "T005"], ["T006", "T008", "T009", "T010"],
            ["T011", "T012", "T013", "T014", "T015"], ["T018", "T019"],
        ])
        self.assertFalse(r["all_done"])
        self.assertEqual((r["total"], r["remaining"]), (19, 13))

    def test_unit_shape(self):
        u = run()["units"][1]
        self.assertEqual(u["phase"], 3)
        self.assertEqual((u["done"], u["total"]), (1, 5))
        self.assertEqual(u["ids_label"], "T006, T008-T010")
        self.assertIsNone(u["part"])

    def test_next_n_phases_skips_finished(self):
        self.assertEqual([u["phase"] for u in run("2 phases")["units"]], [2, 3])
        self.assertEqual([u["phase"] for u in run("next 1 phase")["units"]], [2])

    def test_single_phase_and_ranges(self):
        self.assertEqual(ids(run("phase 4")), [["T011", "T012", "T013", "T014", "T015"]])
        self.assertEqual([u["phase"] for u in run("phases 3-5")["units"]], [3, 4])
        self.assertEqual([u["phase"] for u in run("Phases 2, 6")["units"]], [2, 6])

    def test_finished_phase_gives_no_units(self):
        r = run("phase 5")
        self.assertEqual(r["units"], [])
        self.assertIn("phase 5 already complete", r["warnings"])
        self.assertFalse(r["all_done"])

    def test_missing_phase_warns(self):
        self.assertIn("phase 9 not found in tasks.md", run("phase 9")["warnings"])

    def test_task_ids_grouped_by_phase(self):
        r = run("tasks T003-T006, T012")
        self.assertEqual(ids(r), [["T004", "T005"], ["T006"], ["T012"]])
        self.assertIn("already done, skipped: T003", r["warnings"])

    def test_task_ids_flexible_spelling(self):
        self.assertEqual(ids(run("T011 - T012")), [["T011", "T012"]])
        self.assertEqual(ids(run("task t018")), [["T018"]])

    def test_unknown_task_ids_warn(self):
        self.assertIn("no tasks match T500", run("tasks T500")["warnings"])

    def test_user_story(self):
        self.assertEqual(ids(run("US1")), [["T006", "T008", "T009", "T010"]])
        self.assertEqual(len(run("us1, US2")["units"]), 2)
        self.assertEqual(run("US3")["units"], [])
        self.assertIn("all [US3] tasks already done", run("US3")["warnings"])
        self.assertIn("no tasks tagged [US9]", run("US9")["warnings"])

    def test_bad_scope(self):
        for bad in ("banana", "phases 5-3", "phase x", "tasks T9-T2", "0 phases"):
            with self.subTest(bad), self.assertRaises(units.ScopeError):
                run(bad)


class SplitTests(unittest.TestCase):
    def test_max_tasks_splits_a_phase(self):
        r = units.build(TEXT, "phase 4", max_tasks=2)
        self.assertEqual(ids(r), [["T011", "T012"], ["T013", "T014"], ["T015"]])
        self.assertEqual([u["part"] for u in r["units"]], ["1/3", "2/3", "3/3"])


class ExcludeAndCoverageTests(unittest.TestCase):
    def test_exclude_drops_tasks_and_empty_units(self):
        r = units.build(TEXT, "", 0, exclude="T004-T005, T011")
        self.assertEqual(ids(r)[0], ["T006", "T008", "T009", "T010"])
        self.assertEqual(ids(r)[1], ["T012", "T013", "T014", "T015"])
        self.assertFalse(r["covers_all"])

    def test_covers_all(self):
        self.assertTrue(run()["covers_all"])
        self.assertFalse(run("phase 2")["covers_all"])
        self.assertFalse(units.build(TEXT.replace("- [ ]", "- [x]"))["covers_all"])


class AllDoneTests(unittest.TestCase):
    def test_all_done(self):
        text = TEXT.replace("- [ ]", "- [x]")
        r = units.build(text)
        self.assertTrue(r["all_done"])
        self.assertEqual(r["units"], [])

    def test_empty_file_is_not_all_done(self):
        r = units.build("# Tasks\n")
        self.assertFalse(r["all_done"])
        self.assertTrue(r["warnings"])


class CliTests(unittest.TestCase):
    def cli(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = units.main(list(argv))
        return code, json.loads(buf.getvalue())

    def test_ok(self):
        code, out = self.cli(str(FIXTURE), "--scope", "phase 2")
        self.assertEqual(code, 0)
        self.assertEqual(out["units"][0]["task_ids"], ["T004", "T005"])

    def test_bad_scope_exit_2(self):
        code, out = self.cli(str(FIXTURE), "--scope", "nope")
        self.assertEqual(code, 2)
        self.assertIn("error", out)

    def test_missing_file_exit_3(self):
        code, out = self.cli("/nonexistent/tasks.md")
        self.assertEqual(code, 3)


if __name__ == "__main__":
    unittest.main()
