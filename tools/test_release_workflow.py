"""Execute the recovery workflow's real PowerShell checks with disposable fixtures."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


def workflow_step(name):
    text = (ROOT / '.github/workflows/release-windows.yml').read_text()
    section = text.split(f'      - name: {name}\n', 1)[1]
    block = section.split('        run: |\n', 1)[1]
    lines = []
    for line in block.splitlines():
        if line and not line.startswith('          '):
            break
        lines.append(line[10:])
    return '\n'.join(lines)


class RecoveryWorkflowTests(unittest.TestCase):
    def execute_repair(self, source):
        with tempfile.TemporaryDirectory(prefix='release-recovery-') as folder:
            root = Path(folder)
            (root / 'e2e').mkdir()
            harness = root / 'e2e/harness.mjs'
            harness.write_text(source, encoding='utf-8')
            script = root / 'repair.ps1'
            script.write_text("$ErrorActionPreference = 'Stop'\n" + workflow_step('Repair legacy test driver paths for recovery'), encoding='utf-8')
            result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], cwd=root, capture_output=True, text=True, timeout=15)
            return result, harness.read_text(encoding='utf-8')

    def test_legacy_path_is_repaired_without_changing_other_code(self):
        source = '// unchanged\nconst CARGO_BIN = "C:\\\\Users\\\\developer\\\\.cargo\\\\bin";\nconst app = "untouched";\n'
        result, repaired = self.execute_repair(source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(repaired.splitlines()[0], '// unchanged')
        self.assertEqual(repaired.splitlines()[2], 'const app = "untouched";')
        self.assertNotIn('developer', repaired)
        self.assertIn('process.env.CARGO_HOME', repaired)

    def test_current_harness_is_preserved(self):
        source = (ROOT / 'e2e/harness.mjs').read_text(encoding='utf-8')
        result, repaired = self.execute_repair(source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(source, repaired)

    def test_unrecognized_harness_fails_closed(self):
        source = 'const CARGO_BIN = unknown();\n'
        result, repaired = self.execute_repair(source)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(source, repaired)

    def test_recovery_refuses_a_changed_tag_commit(self):
        with tempfile.TemporaryDirectory(prefix='release-recovery-pin-') as folder:
            root = Path(folder)
            script = root / 'validate.ps1'
            script.write_text("$ErrorActionPreference = 'Stop'\nfunction git { '" + 'b' * 40 + "' }\n" + workflow_step('Validate release tag and version'), encoding='utf-8')
            env = dict(os.environ, RELEASE_TAG='v1.3.0', RECOVERY='true', SOURCE_SHA='a' * 40, GITHUB_REF='refs/heads/main')
            result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], cwd=root, env=env, capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Release tag changed', result.stderr)

    def test_branch_recovery_accepts_matching_source_and_version(self):
        with tempfile.TemporaryDirectory(prefix='release-recovery-version-') as folder:
            root = Path(folder)
            (root / 'src-tauri').mkdir()
            for file in ('package.json', 'src-tauri/tauri.conf.json'):
                (root / file).write_text('{"version":"1.3.0"}')
            (root / 'src-tauri/Cargo.toml').write_text('[package]\nversion = "1.3.0"\n')
            script = root / 'validate.ps1'
            script.write_text("$ErrorActionPreference = 'Stop'\nfunction git { '" + 'a' * 40 + "' }\n" + workflow_step('Validate release tag and version'), encoding='utf-8')
            env = dict(os.environ, RELEASE_TAG='v1.3.0', RECOVERY='true', SOURCE_SHA='a' * 40, GITHUB_REF='refs/heads/main')
            command = [str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)]
            result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            (root / 'package.json').write_text('{"version":"1.3.1"}')
            result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Version mismatch', result.stderr)

    def test_normal_mode_still_requires_tag_dispatch(self):
        with tempfile.TemporaryDirectory(prefix='release-normal-ref-') as folder:
            script = Path(folder) / 'validate.ps1'
            script.write_text("$ErrorActionPreference = 'Stop'\n" + workflow_step('Validate release tag and version'), encoding='utf-8')
            env = dict(os.environ, RELEASE_TAG='v1.3.0', RECOVERY='false', GITHUB_REF='refs/heads/main')
            result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], cwd=folder, env=env, capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Dispatch must use the release tag', result.stderr)


if __name__ == '__main__':
    unittest.main()
