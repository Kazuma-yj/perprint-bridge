"""Run the release XPI in a disposable real Zotero profile.

Usage: MOZ_HEADLESS=1 python scripts/zotero-smoke.py /path/to/zotero XPI OUTPUT
Use xvfb-run instead of MOZ_HEADLESS for a visible Linux window/screenshot.
No access to the user's Zotero profile or data directory is needed.
"""
from pathlib import Path
from zipfile import ZipFile
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = Path(__file__).resolve().parents[1]
binary, package, output = (Path(arg).resolve() for arg in sys.argv[1:4])
expect_blank = '--expect-blank' in sys.argv[4:]
output.mkdir(parents=True, exist_ok=True)
result = output / 'result.json'
result.unlink(missing_ok=True)
with tempfile.TemporaryDirectory(prefix='preprint-bridge-zotero-') as temp:
    temp = Path(temp)
    profile = temp / 'profile'
    extensions = profile / 'extensions'
    extensions.mkdir(parents=True)
    data = temp / 'data'
    data.mkdir()
    shutil.copyfile(package, extensions / 'preprint-bridge@research.local.xpi')
    manifest = {
        'manifest_version': 2, 'name': 'Preprint Bridge test companion', 'version': '1.0',
        'applications': {'zotero': {'id': 'preprint-bridge-test@research.local',
            'strict_min_version': '10.0', 'strict_max_version': '10.0.*',
            'update_url': 'https://example.invalid/test-only.json'}}
    }
    with ZipFile(extensions / 'preprint-bridge-test@research.local.xpi', 'w') as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('bootstrap.js', (ROOT / 'tests/zotero-helper.js').read_bytes())
    prefs = {
        'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
        'extensions.startupScanScopes': 15, 'extensions.update.enabled': False,
        'extensions.zotero.firstRun': False, 'extensions.zotero.firstRun2': False,
        'extensions.zotero.dataDir': str(data), 'extensions.zotero.useDataDir': True,
        'extensions.zotero.automaticScraperUpdates': False,
        'extensions.zotero.sync.autoSync': False, 'app.update.auto': False,
        'browser.shell.checkDefaultBrowser': False,
        'intl.locale.requested': 'en-US'
    }
    (profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()))
    env = {**os.environ, 'PB_TEST_OUTPUT': str(output),
        'PB_TEST_FIXTURES': str(ROOT / 'tests/fixtures/crossref-publications.json'),
        'PB_TEST_EXPECT_BLANK': '1' if expect_blank else '0',
        'MOZ_CRASHREPORTER_DISABLE': '1', 'MOZ_NO_REMOTE': '1'}
    with (output / 'process.log').open('w') as log:
        process = subprocess.Popen([str(binary), '-no-remote', '-profile', str(profile), '-ZoteroDebugText'], env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            end = time.monotonic() + 120
            while not result.exists() and process.poll() is None and time.monotonic() < end:
                time.sleep(0.25)
            if not result.exists():
                print((output / 'process.log').read_text(errors='replace')[-12000:])
                raise RuntimeError(f'Zotero test did not produce a result (exit={process.poll()})')
            report = json.loads(result.read_text())
            if env.get('DISPLAY') and shutil.which('scrot'):
                subprocess.run(['scrot', '-o', str(output / 'desktop.png')], check=False)
            print(json.dumps(report, indent=2))
            if not report.get('passed'):
                raise RuntimeError('Real Zotero smoke test failed')
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
