import importlib.util
import json
import re
import shutil
import subprocess
import sys
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
GENERATORS = {
    "city-index": {
        "script": REPO_ROOT / "generators" / "generate-city-indexes.py",
        "relative_paths": tuple(
            sorted(
                path.relative_to(HTML_ROOT)
                for path in (HTML_ROOT / "krym").glob("*/index.html")
            )
        ),
    },
    "city-septik": {
        "script": REPO_ROOT / "generators" / "generate-city-septik.py",
        "relative_paths": tuple(
            sorted(
                path.relative_to(HTML_ROOT)
                for path in (HTML_ROOT / "krym").glob("*/septik-pod-kluch/index.html")
            )
        ),
    },
}


def load_generator(name, script):
    spec = importlib.util.spec_from_file_location(name, script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot(root, relative_paths):
    return {
        relative_path: (
            (root / relative_path).read_bytes(),
            (root / relative_path).stat().st_mtime_ns,
        )
        for relative_path in relative_paths
    }


@contextmanager
def temporary_repo():
    base = REPO_ROOT / "tests" / "generator-safety.tmp"
    base.mkdir(exist_ok=True)
    path = base / uuid.uuid4().hex
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path)
        try:
            base.rmdir()
        except OSError:
            pass


class GeneratorSafetyTests(unittest.TestCase):
    def setUp(self):
        for name, config in GENERATORS.items():
            self.assertEqual(
                12,
                len(config["relative_paths"]),
                f"{name} must own exactly 12 published pages",
            )

    def make_published_copy(self, root, relative_paths):
        for relative_path in relative_paths:
            target = root / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(HTML_ROOT / relative_path, target)

    def run_generator(self, script, root, *mode):
        sandbox_generators = root.parent / "generators"
        sandbox_generators.mkdir(parents=True, exist_ok=True)
        sources = (
            script,
            *sorted((REPO_ROOT / "generators").glob("city-*-template.html")),
            REPO_ROOT / "generators" / "city-septik-data.json",
        )
        for source in sources:
            shutil.copy2(source, sandbox_generators / source.name)
        sandbox_script = sandbox_generators / script.name
        return subprocess.run(
            [sys.executable, str(sandbox_script), *mode, "--output-root", str(root)],
            cwd=root.parent,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )

    def test_default_and_explicit_check_report_drift_without_writing(self):
        for name, config in GENERATORS.items():
            for mode in ((), ("--check",)):
                with self.subTest(generator=name, mode=mode or ("default",)):
                    with temporary_repo() as temp_dir:
                        output_root = temp_dir / "html"
                        output_root.mkdir()
                        paths = config["relative_paths"]
                        self.make_published_copy(output_root, paths)
                        drift_path = output_root / paths[0]
                        drift_path.write_bytes(
                            drift_path.read_bytes() + b"\n<!-- intentional drift -->\n"
                        )
                        before = snapshot(output_root, paths)

                        result = self.run_generator(config["script"], output_root, *mode)

                        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
                        self.assertIn(paths[0].as_posix(), result.stdout + result.stderr)
                        self.assertIn("drift", (result.stdout + result.stderr).lower())
                        self.assertEqual(before, snapshot(output_root, paths))

    def test_check_succeeds_for_published_pages_without_writing(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()
                    paths = config["relative_paths"]
                    self.make_published_copy(output_root, paths)
                    before = snapshot(output_root, paths)

                    result = self.run_generator(config["script"], output_root, "--check")

                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertIn("up to date", (result.stdout + result.stderr).lower())
                    self.assertEqual(before, snapshot(output_root, paths))

    def test_write_replaces_only_changed_files(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()
                    paths = config["relative_paths"]
                    self.make_published_copy(output_root, paths)
                    drift_relative = paths[0]
                    drift_path = output_root / drift_relative
                    drift_path.write_bytes(b"truncated")
                    before = snapshot(output_root, paths)

                    result = self.run_generator(config["script"], output_root, "--write")

                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertEqual(
                        (HTML_ROOT / drift_relative).read_bytes(),
                        drift_path.read_bytes(),
                    )
                    for relative_path in paths[1:]:
                        self.assertEqual(
                            before[relative_path],
                            snapshot(output_root, (relative_path,))[relative_path],
                            f"unchanged file was replaced: {relative_path.as_posix()}",
                        )

    def test_write_to_empty_root_produces_only_expected_valid_pages(self):
        with temporary_repo() as temp_dir:
            output_root = temp_dir / "html"
            output_root.mkdir()
            for config in GENERATORS.values():
                result = self.run_generator(config["script"], output_root, "--write")
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)

            expected = {
                relative_path
                for config in GENERATORS.values()
                for relative_path in config["relative_paths"]
            }
            actual = {
                path.relative_to(output_root)
                for path in (output_root / "krym").glob("*/index.html")
            } | {
                path.relative_to(output_root)
                for path in (output_root / "krym").glob("*/septik-pod-kluch/index.html")
            }
            self.assertEqual(24, len(expected))
            self.assertEqual(expected, actual)

            for relative_path in sorted(expected):
                with self.subTest(path=relative_path.as_posix()):
                    path = output_root / relative_path
                    self.assertEqual(
                        (HTML_ROOT / relative_path).read_bytes(), path.read_bytes()
                    )
                    source = path.read_text(encoding="utf-8")
                    ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', source))
                    fragments = re.findall(r'\bhref=["\']#([^"\']+)["\']', source)
                    self.assertEqual(
                        [], [fragment for fragment in fragments if fragment not in ids]
                    )
                    for payload in re.findall(
                        r'<script\s+type="application/ld\+json">(.*?)</script>',
                        source,
                        re.DOTALL | re.IGNORECASE,
                    ):
                        json.loads(payload)

    def test_atomic_write_failure_preserves_target_and_removes_temp_file(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                module = load_generator(name.replace("-", "_"), config["script"])
                self.assertTrue(
                    hasattr(module, "atomic_write"),
                    "generator must expose atomic_write",
                )
                with temporary_repo() as temp_dir:
                    target = temp_dir / "index.html"
                    target.write_bytes(b"approved")
                    with mock.patch.object(
                        module.os, "replace", side_effect=OSError("replace failed")
                    ):
                        with self.assertRaisesRegex(OSError, "replace failed"):
                            module.atomic_write(target, "replacement")
                    self.assertEqual(b"approved", target.read_bytes())
                    self.assertEqual([], list(target.parent.glob(f".{target.name}.*.tmp")))

    def test_output_root_must_be_an_existing_directory(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    missing = temp_dir / "missing"
                    result = self.run_generator(config["script"], missing, "--check")
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("existing directory", (result.stdout + result.stderr).lower())
                    self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
