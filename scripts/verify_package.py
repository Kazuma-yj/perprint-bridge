"""Check that the installable package, source files and update feed agree."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text())
version = manifest["version"]
assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a release version"
assert version == json.loads((ROOT / "package.json").read_text())["version"]
addon = manifest["applications"]["zotero"]
package = ROOT / "dist" / f"preprint-bridge-{version}.xpi"
expected = {"manifest.json", "bootstrap.js", "LICENSE", "DATA_SOURCES.md"}
expected.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "content").rglob("*.js"))
expected.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "locale").rglob("*.ftl"))
with ZipFile(package) as archive:
    assert len(archive.namelist()) == len(expected) and set(archive.namelist()) == expected
    for name in expected:
        assert archive.read(name) == (ROOT / name).read_bytes(), f"Stale packaged file: {name}"
    bootstrap = archive.read("bootstrap.js").decode()
    for method in ["startup", "shutdown", "install", "uninstall", "onMainWindowLoad", "onMainWindowUnload"]:
        assert f"function {method}(" in bootstrap, f"Missing bootstrap callback: {method}"
update = json.loads((ROOT / "update.json").read_text())["addons"][addon["id"]]["updates"][0]
digest = "sha256:" + hashlib.sha256(package.read_bytes()).hexdigest()
assert update["version"] == version
assert update["update_hash"] == digest
assert update["update_link"] == f"https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/dist/{package.name}"
assert addon["update_url"] == "https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/update.json"
for key in ["strict_min_version", "strict_max_version"]:
    assert update["applications"]["zotero"][key] == addon[key]
print(f"Verified {package.name}: {digest}")
