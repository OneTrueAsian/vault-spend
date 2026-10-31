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
    def test_diagnostic_runs_cannot_publish_installers(self):
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        self.assertTrue('diagnostic_only:' in source, 'missing non-publishing diagnostic input')
        self.assertTrue('ref: ${{ inputs.diagnostic_only && inputs.source_sha || inputs.tag }}' in source, 'diagnostics must test their pinned source, normal releases their immutable tag')
        packaging = source.split('      - name: Build and publish Windows installers\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('if: ${{ !inputs.diagnostic_only }}', packaging)
        signing = source.split('  sign-updates:\n', 1)[1]
        self.assertTrue('if: ${{ !inputs.recovery && !inputs.diagnostic_only }}' in signing, 'diagnostics must not enter protected signing')
        self.assertLess(source.index('      - name: Desktop WebDriver smoke preflight'), source.index('      - name: Full desktop E2E release gate'))

    def test_hosted_runner_gate_limits_concurrent_app_launches(self):
        # The hosted desktop has one OS foreground window. Concurrency 3 still failed focus checks
        # and protection flows (171/202); isolate these real UI checks rather than skip assertions.
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        gate = source.split('      - name: Full desktop E2E release gate\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('--integrity Medium', gate)
        self.assertIn('-Gate full', gate)

    def execute_desktop_gate(self, integrity, gate, code):
        with tempfile.TemporaryDirectory(prefix='release-desktop-gate-') as folder:
            root = Path(folder)
            commands = root / 'commands.json'
            helper = ROOT / 'tools/run-hosted-desktop-tests.ps1'
            script = root / 'gate.ps1'
            script.write_text(
                "$ErrorActionPreference = 'Stop'\nfunction whoami.exe { $global:LASTEXITCODE = 0; '" + integrity + "' }\n"
                "function npm.cmd { ConvertTo-Json -InputObject @($args) | Set-Content -LiteralPath '" + str(commands).replace("'", "''") + "'; $global:LASTEXITCODE = " + str(code) + " }\n"
                "& '" + str(helper).replace("'", "''") + "' -Gate " + gate + "\nexit $LASTEXITCODE\n",
                encoding='utf-8',
            )
            result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], env=dict(os.environ, GITHUB_ACTIONS='true'), capture_output=True, text=True, timeout=15)
            return result, commands.read_text() if commands.exists() else None

    def test_desktop_gate_refuses_elevated_context_before_starting_tests(self):
        result, commands = self.execute_desktop_gate('S-1-16-12288', 'full', 0)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('medium integrity', result.stderr)
        self.assertIsNone(commands)

    def test_desktop_gate_preserves_full_coverage_serial_retry_policy_and_failure_exit(self):
        import json
        result, commands = self.execute_desktop_gate('S-1-16-8192', 'full', 17)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(json.loads(commands), ['run', 'e2e', '--', '--concurrency=1', '--retry-failed'])

    def test_desktop_gate_smoke_success_is_forwarded(self):
        import json
        result, commands = self.execute_desktop_gate('S-1-16-8192', 'smoke', 0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(commands), ['run', 'e2e:smoke'])

    def test_native_browser_driver_is_separate_from_webview_driver(self):
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        setup = source.split('      - name: Install native Edge test driver\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('VersionInfo.ProductVersion', setup)
        self.assertIn('MSEDGEDRIVER=', setup)
        self.assertNotIn("Join-Path $cargoHome 'bin'", setup)
        self.assertLess(source.index('      - name: Install native Edge test driver'), source.index('      - name: Desktop WebDriver smoke preflight'))

    def test_hosted_edge_updates_are_pinned_before_the_driver_is_matched(self):
        # Run 38339761633: Edge moved from 152 to 155 during the 50 minute gate, after its driver was
        # installed, so the mobile spec could not start a session.
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        pin = source.split('      - name: Pin hosted Edge version\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('UpdateDefault', pin)
        self.assertIn('{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}', pin)
        self.assertIn('edgeupdate', pin)
        self.assertLess(source.index('      - name: Refresh hosted WebView2 runtime'), source.index('      - name: Pin hosted Edge version'))
        self.assertLess(source.index('      - name: Pin hosted Edge version'), source.index('      - name: Install native Edge test driver'))

    def test_edge_driver_match_is_rechecked_before_the_full_gate(self):
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        self.assertLess(source.index('      - name: Verify native Edge driver still matches Edge'), source.index('      - name: Full desktop E2E release gate'))
        gate = source.split('      - name: Full desktop E2E release gate\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn("VAULTSPEND_E2E_SPEC_TIMEOUT_MS: '180000'", gate)

    def run_edge_match(self, driver_output, driver_exit):
        with tempfile.TemporaryDirectory(prefix='edge-match-') as folder:
            root = Path(folder)
            edge = POWERSHELL  # any real executable: the helper only reads its file version
            version = subprocess.run([str(POWERSHELL), '-NoProfile', '-Command', f"(Get-Item -LiteralPath '{edge}').VersionInfo.ProductVersion"], capture_output=True, text=True, timeout=15).stdout.strip()
            driver = root / 'driver.cmd'
            driver.write_text('@echo off\r\necho ' + driver_output.replace('{version}', version) + '\r\nexit /b ' + str(driver_exit) + '\r\n')
            helper = ROOT / 'tools/assert-edge-driver-match.ps1'
            return subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(helper), '-Edge', str(edge), '-Driver', str(driver)], capture_output=True, text=True, timeout=15)

    def test_edge_driver_match_accepts_the_installed_version(self):
        result = self.run_edge_match('Microsoft Edge WebDriver {version} (abc)', 0)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_edge_driver_match_refuses_a_driver_for_another_version(self):
        result = self.run_edge_match('Microsoft Edge WebDriver 1.2.3.4 (abc)', 0)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no longer matches', result.stderr)

    def test_edge_driver_match_refuses_a_driver_that_fails_to_report(self):
        result = self.run_edge_match('Microsoft Edge WebDriver {version} (abc)', 3)
        self.assertNotEqual(result.returncode, 0)

    def test_hosted_runtime_is_verified_before_install_and_driver_matching(self):
        source = (ROOT / '.github/workflows/release-windows.yml').read_text()
        setup = workflow_step('Refresh hosted WebView2 runtime')
        self.assertLess(setup.index('Get-AuthenticodeSignature'), setup.index('Start-Process'))
        self.assertIn("$signature.Status -ne 'Valid'", setup)
        self.assertIn('O=Microsoft Corporation', setup)
        self.assertLess(source.index('      - name: Refresh hosted WebView2 runtime'), source.index('      - name: Install desktop test drivers'))
        build = source.split('      - name: Build current desktop test app\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('CARGO_PROFILE_DEV_OPT_LEVEL: 1', build)
        self.assertIn('npm run build:app', build)
        # The provenance wrapper retains the original debug Tauri compiler flags.
        builder = (ROOT / 'e2e/build-app.mjs').read_text(encoding='utf-8')
        self.assertIn('["tauri", "build", "--debug", "--no-bundle"]', builder)

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

    def test_diagnostics_require_explicit_pinned_recovery(self):
        with tempfile.TemporaryDirectory(prefix='release-diagnostic-ref-') as folder:
            script = Path(folder) / 'validate.ps1'
            script.write_text("$ErrorActionPreference = 'Stop'\n" + workflow_step('Validate release tag and version'), encoding='utf-8')
            env = dict(os.environ, RELEASE_TAG='v1.3.2', RECOVERY='false', DIAGNOSTIC_ONLY='true', GITHUB_REF='refs/tags/v1.3.2')
            result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], cwd=folder, env=env, capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Diagnostics require recovery mode', result.stderr)


if __name__ == '__main__':
    unittest.main()
