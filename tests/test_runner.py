import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "runner.py"


class RunnerCliTest(unittest.TestCase):
    def run_cli(self, *args: str, cwd: Path, runner: str | None = None):
        env = os.environ.copy()
        env.pop("DESIGN_RUNNER", None)
        if runner:
            env["DESIGN_RUNNER"] = runner
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def parse_json(self, result):
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self.fail(f"invalid JSON output: {exc}: {result.stdout!r}")

    def test_safe_default_resolves_local_design_to_code(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_cli(
                "resolve", "figma-design-to-code", "--json", cwd=Path(directory)
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = self.parse_json(result)
            self.assertEqual(report["runner"], "local-files")
            self.assertEqual(report["workflow"], "design-to-code")
            self.assertTrue(report["ok"])

    def test_cloud_runner_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.run_cli(
                "use", "figma-remote", "--project", str(root), cwd=root
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("requires cloud", result.stderr)
            self.assertFalse((root / ".design-runner.json").exists())

    def test_write_workflow_needs_explicit_write_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected = self.run_cli(
                "use",
                "figma-remote",
                "--project",
                str(root),
                "--cloud",
                "allow",
                cwd=root,
            )
            self.assertEqual(selected.returncode, 0, selected.stderr)
            blocked = self.run_cli("resolve", "generate-design", cwd=root)
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("design write blocked", blocked.stdout)
            allowed = self.run_cli(
                "use",
                "figma-remote",
                "--project",
                str(root),
                "--design-writes",
                "allow",
                cwd=root,
            )
            self.assertEqual(allowed.returncode, 0, allowed.stderr)
            resolved = self.run_cli("resolve", "generate-design", cwd=root)
            self.assertEqual(resolved.returncode, 0, resolved.stdout + resolved.stderr)

    def test_desktop_runner_needs_explicit_desktop_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked = self.run_cli(
                "use", "ardot-desktop", "--project", str(root), cwd=root
            )
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("requires a desktop app", blocked.stderr)
            allowed = self.run_cli(
                "use",
                "ardot-desktop",
                "--project",
                str(root),
                "--desktop",
                "allow",
                cwd=root,
            )
            self.assertEqual(allowed.returncode, 0, allowed.stderr)

    def test_verified_ardot_capabilities_and_gaps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected = self.run_cli(
                "use",
                "ardot-desktop",
                "--project",
                str(root),
                "--desktop",
                "allow",
                "--design-writes",
                "allow",
                cwd=root,
            )
            self.assertEqual(selected.returncode, 0, selected.stderr)

            canvas = self.run_cli("resolve", "canvas", "--json", cwd=root)
            self.assertEqual(canvas.returncode, 0, canvas.stderr)
            required = {
                item["capability"]: item for item in self.parse_json(canvas)["required"]
            }
            self.assertIn("batch_edit", required["canvas.execute"]["candidates"])
            self.assertIn(
                "capture_screenshot", required["render.capture"]["candidates"]
            )

            whiteboard = self.run_cli("resolve", "figma-use-figjam", "--json", cwd=root)
            self.assertEqual(whiteboard.returncode, 0, whiteboard.stderr)
            self.assertEqual(
                self.parse_json(whiteboard)["required"][0]["status"], "emulated"
            )

            motion = self.run_cli("resolve", "figma-use-motion", cwd=root)
            self.assertEqual(motion.returncode, 2)
            self.assertIn("unsupported", motion.stdout)

    def test_unified_product_flow_resolves_for_ardot_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected = self.run_cli(
                "use",
                "ardot-remote",
                "--project",
                str(root),
                "--cloud",
                "allow",
                "--design-writes",
                "allow",
                cwd=root,
            )
            self.assertEqual(selected.returncode, 0, selected.stderr)
            resolved = self.run_cli(
                "resolve", "one-page-product-flow", "--json", cwd=root
            )
            self.assertEqual(resolved.returncode, 0, resolved.stderr)
            report = self.parse_json(resolved)
            self.assertEqual(report["workflow"], "unified-product-flow")
            self.assertEqual(
                [item["capability"] for item in report["required"]],
                ["document.inspect", "canvas.execute", "render.capture"],
            )
            self.assertTrue(report["ok"])

    def test_nearest_parent_config_is_inherited(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "project" / "src"
            child.mkdir(parents=True)
            config = {
                "runner": "local-files",
                "policy": {
                    "allowCloud": False,
                    "allowDesktopApp": False,
                    "allowDesignWrites": False,
                },
            }
            (root / ".design-runner.json").write_text(json.dumps(config))
            result = self.run_cli("check", "--json", cwd=child)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                Path(self.parse_json(result)["config"]),
                (root / ".design-runner.json").resolve(),
            )

    def test_unknown_runner_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_cli("show", "not-a-runner", cwd=Path(directory))
            self.assertEqual(result.returncode, 2)
            self.assertIn("unknown runner", result.stderr)


if __name__ == "__main__":
    unittest.main()
