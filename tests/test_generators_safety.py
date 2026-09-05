import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
GIT_ATTRIBUTES = REPO_ROOT / ".gitattributes"
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

    def make_published_copy(self, root, relative_paths, newline=None):
        for relative_path in relative_paths:
            target = root / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            source = HTML_ROOT / relative_path
            if newline is None:
                shutil.copy2(source, target)
            else:
                target.write_text(
                    source.read_text(encoding="utf-8"),
                    encoding="utf-8",
                    newline=newline,
                )

    def run_generator(self, script, root, *mode, data=None, template_suffix=None):
        sandbox_generators = root.parent / "generators"
        sandbox_generators.mkdir(parents=True, exist_ok=True)
        sources = (
            script,
            *sorted((REPO_ROOT / "generators").glob("city-*-template.html")),
            REPO_ROOT / "generators" / "city-septik-data.json",
        )
        for source in sources:
            shutil.copy2(source, sandbox_generators / source.name)
        if data is not None:
            (sandbox_generators / "city-septik-data.json").write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )
        if template_suffix is not None:
            template_path = sandbox_generators / (
                "city-index-template.html"
                if script.name == "generate-city-indexes.py"
                else "city-septik-template.html"
            )
            template_path.write_text(
                template_path.read_text(encoding="utf-8") + template_suffix,
                encoding="utf-8",
            )
        sandbox_script = sandbox_generators / script.name
        return subprocess.run(
            [sys.executable, str(sandbox_script), *mode, "--output-root", str(root)],
            cwd=root.parent,
            text=True,
            encoding="utf-8",
            errors="replace",
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

    def test_check_tolerates_crlf_checkout_without_rewriting_it(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()
                    paths = config["relative_paths"]
                    self.make_published_copy(output_root, paths, newline="\r\n")
                    before = snapshot(output_root, paths)

                    result = self.run_generator(config["script"], output_root, "--check")

                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertEqual(before, snapshot(output_root, paths))

    def test_rendered_pages_use_lf_even_if_checkout_and_platform_use_crlf(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                module = load_generator(name.replace("-", "_"), config["script"])
                with temporary_repo() as temp_dir:
                    template = temp_dir / module.TEMPLATE_PATH.name
                    template.write_text(
                        module.TEMPLATE_PATH.read_text(encoding="utf-8"),
                        encoding="utf-8",
                        newline="\r\n",
                    )
                    with mock.patch.object(os, "linesep", "\r\n"):
                        rendered = module.render_pages(template_path=template)
                self.assertTrue(rendered)
                self.assertTrue(all("\r" not in source for source in rendered.values()))

    def test_city_templates_and_owned_outputs_are_pinned_to_lf(self):
        self.assertTrue(GIT_ATTRIBUTES.exists())
        attributes = GIT_ATTRIBUTES.read_text(encoding="utf-8").splitlines()
        self.assertIn("generators/city-index-template.html text eol=lf", attributes)
        self.assertIn("generators/city-septik-template.html text eol=lf", attributes)
        self.assertIn("html/krym/*/index.html text eol=lf", attributes)
        self.assertIn(
            "html/krym/*/septik-pod-kluch/index.html text eol=lf", attributes
        )

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
                        (HTML_ROOT / drift_relative).read_text(encoding="utf-8"),
                        drift_path.read_text(encoding="utf-8"),
                    )
                    for relative_path in paths[1:]:
                        self.assertEqual(
                            before[relative_path],
                            snapshot(output_root, (relative_path,))[relative_path],
                            f"unchanged file was replaced: {relative_path.as_posix()}",
                        )

    def test_invalid_utf8_owned_output_is_drift_and_write_replaces_it(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()
                    paths = config["relative_paths"]
                    self.make_published_copy(output_root, paths)
                    drift_relative = paths[0]
                    drift_path = output_root / drift_relative
                    drift_path.write_bytes(b"\xff\xfeinvalid utf-8")
                    before = snapshot(output_root, paths)

                    check = self.run_generator(
                        config["script"], output_root, "--check"
                    )

                    self.assertEqual(1, check.returncode, check.stdout + check.stderr)
                    self.assertIn("drift", (check.stdout + check.stderr).lower())
                    self.assertIn(
                        drift_relative.as_posix(), check.stdout + check.stderr
                    )
                    self.assertEqual(before, snapshot(output_root, paths))

                    write = self.run_generator(
                        config["script"], output_root, "--write"
                    )

                    self.assertEqual(0, write.returncode, write.stdout + write.stderr)
                    self.assertEqual(
                        (HTML_ROOT / drift_relative).read_text(encoding="utf-8"),
                        drift_path.read_text(encoding="utf-8"),
                    )

    def test_check_and_write_report_unexpected_outputs_without_deleting_them(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()
                    paths = config["relative_paths"]
                    self.make_published_copy(output_root, paths)
                    unexpected_relative = (
                        Path("krym/obsolete/index.html")
                        if name == "city-index"
                        else Path("krym/obsolete/septik-pod-kluch/index.html")
                    )
                    unexpected = output_root / unexpected_relative
                    unexpected.parent.mkdir(parents=True)
                    unexpected.write_bytes(b"obsolete")
                    before = snapshot(
                        output_root, (*paths, unexpected_relative)
                    )

                    check = self.run_generator(
                        config["script"], output_root, "--check"
                    )
                    write = self.run_generator(
                        config["script"], output_root, "--write"
                    )

                    for result in (check, write):
                        self.assertNotEqual(0, result.returncode)
                        output = result.stdout + result.stderr
                        self.assertIn("unexpected", output.lower())
                        self.assertIn(unexpected_relative.as_posix(), output)
                    self.assertEqual(
                        before,
                        snapshot(output_root, (*paths, unexpected_relative)),
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
                        (HTML_ROOT / relative_path).read_text(encoding="utf-8"),
                        path.read_text(encoding="utf-8"),
                    )
                    self.assertNotIn(b"\r\n", path.read_bytes())
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

    def test_atomic_write_applies_existing_mode_and_0644_for_new_files(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                module = load_generator(name.replace("-", "_"), config["script"])
                for exists in (True, False):
                    with self.subTest(exists=exists), temporary_repo() as temp_dir:
                        target = temp_dir / "index.html"
                        if exists:
                            target.write_bytes(b"approved")
                            expected_mode = stat.S_IMODE(target.stat().st_mode)
                        else:
                            expected_mode = 0o644

                        with mock.patch.object(
                            module.os, "chmod", wraps=module.os.chmod
                        ) as chmod:
                            module.atomic_write(target, "replacement")

                        chmod.assert_called_once()
                        temp_path, applied_mode = chmod.call_args.args
                        self.assertEqual(expected_mode, applied_mode)
                        self.assertEqual(target.parent, Path(temp_path).parent)
                        self.assertNotEqual(target, Path(temp_path))

    @unittest.skipIf(os.name == "nt", "POSIX mode semantics are unavailable")
    def test_atomic_write_preserves_real_posix_mode(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name), temporary_repo() as temp_dir:
                module = load_generator(name.replace("-", "_"), config["script"])
                existing = temp_dir / "existing.html"
                existing.write_bytes(b"approved")
                existing.chmod(0o754)
                module.atomic_write(existing, "replacement")
                self.assertEqual(0o754, stat.S_IMODE(existing.stat().st_mode))

                created = temp_dir / "created.html"
                module.atomic_write(created, "created")
                self.assertEqual(0o644, stat.S_IMODE(created.stat().st_mode))

    def test_output_root_must_be_an_existing_directory(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    missing = temp_dir / "missing"
                    result = self.run_generator(config["script"], missing, "--check")
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("existing directory", (result.stdout + result.stderr).lower())
                    self.assertFalse(missing.exists())

    def test_unknown_template_placeholder_aborts_before_any_output(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()

                    result = self.run_generator(
                        config["script"],
                        output_root,
                        "--write",
                        template_suffix="\n${unknown_placeholder}\n",
                    )

                    self.assertNotEqual(0, result.returncode)
                    self.assertIn(
                        "unknown_placeholder", result.stdout + result.stderr
                    )
                    self.assertEqual([], list(output_root.rglob("*.html")))

    def test_invalid_city_slugs_are_rejected_before_creating_output_paths(self):
        source_data = json.loads(
            (REPO_ROOT / "generators" / "city-septik-data.json").read_text(
                encoding="utf-8"
            )
        )
        for malicious_slug in ("../escape", "../../escape"):
            for name, config in GENERATORS.items():
                with self.subTest(generator=name, slug=malicious_slug):
                    data = json.loads(json.dumps(source_data))
                    data["cities"][0]["slug"] = malicious_slug
                    with temporary_repo() as temp_dir:
                        output_root = temp_dir / "html"
                        output_root.mkdir()

                        result = self.run_generator(
                            config["script"], output_root, "--write", data=data
                        )

                        self.assertNotEqual(0, result.returncode)
                        self.assertIn(
                            "invalid city slug", (result.stdout + result.stderr).lower()
                        )
                        self.assertEqual([], list(output_root.rglob("*.html")))
                        self.assertFalse((temp_dir / "escape").exists())

    def test_absolute_cross_platform_slugs_fail_validation(self):
        source_data = json.loads(
            (REPO_ROOT / "generators" / "city-septik-data.json").read_text(
                encoding="utf-8"
            )
        )
        for malicious_slug in ("/absolute", r"C:\absolute"):
            for name, config in GENERATORS.items():
                with self.subTest(generator=name, slug=malicious_slug):
                    module = load_generator(name.replace("-", "_"), config["script"])
                    self.assertTrue(
                        hasattr(module, "validate_cities"),
                        "generator must validate data before building paths",
                    )
                    data = json.loads(json.dumps(source_data))
                    data["cities"][0]["slug"] = malicious_slug
                    with self.assertRaisesRegex(ValueError, "(?i)invalid city slug"):
                        module.validate_cities(data["cities"])

    def test_duplicate_city_slugs_are_rejected_before_writing(self):
        source_data = json.loads(
            (REPO_ROOT / "generators" / "city-septik-data.json").read_text(
                encoding="utf-8"
            )
        )
        source_data["cities"][1]["slug"] = source_data["cities"][0]["slug"]
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    output_root.mkdir()

                    result = self.run_generator(
                        config["script"], output_root, "--write", data=source_data
                    )

                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("duplicate city slug", (result.stdout + result.stderr).lower())
                    self.assertEqual([], list(output_root.rglob("*.html")))

    def test_symlinked_city_directory_cannot_escape_output_root(self):
        for name, config in GENERATORS.items():
            with self.subTest(generator=name):
                with temporary_repo() as temp_dir:
                    output_root = temp_dir / "html"
                    city_root = output_root / "krym"
                    city_root.mkdir(parents=True)
                    outside = temp_dir / "outside"
                    outside.mkdir()
                    link = city_root / "simferopol"
                    try:
                        link.symlink_to(outside, target_is_directory=True)
                    except OSError as error:
                        self.skipTest(f"directory symlinks are unavailable: {error}")

                    result = self.run_generator(
                        config["script"], output_root, "--write"
                    )

                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("escapes output root", (result.stdout + result.stderr).lower())
                    self.assertEqual([], list(outside.iterdir()))


if __name__ == "__main__":
    unittest.main()
