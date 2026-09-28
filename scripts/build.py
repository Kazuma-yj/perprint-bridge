"""Make a deterministic, dependency-free Zotero XPI."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import json
import hashlib
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
ZOTERO = MANIFEST["applications"]["zotero"]
UPDATE_URL = ZOTERO.get("update_url", "")
PARSED_UPDATE_URL = urlparse(UPDATE_URL)
if PARSED_UPDATE_URL.scheme != "https" or not PARSED_UPDATE_URL.netloc:
    raise ValueError("applications.zotero.update_url must be an HTTPS URL")
if MANIFEST["version"] != json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]:
    raise ValueError("manifest.json and package.json versions differ")
OUT = ROOT / "dist" / f"preprint-bridge-{MANIFEST['version']}.xpi"
FILES = [ROOT / name for name in ("manifest.json", "bootstrap.js", "LICENSE", "DATA_SOURCES.md")]
FILES += sorted((ROOT / "content").rglob("*.js"))
FILES += sorted((ROOT / "locale").rglob("*.ftl"))
OUT.parent.mkdir(exist_ok=True)
with ZipFile(OUT, "w") as archive:
    for file in FILES:
        path = file.relative_to(ROOT).as_posix()
        info = ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, file.read_bytes())
repo = "https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main"
update = {"addons": {ZOTERO["id"]: {"updates": [{
    "version": MANIFEST["version"],
    "update_link": f"{repo}/dist/{OUT.name}",
    "update_hash": "sha256:" + hashlib.sha256(OUT.read_bytes()).hexdigest(),
    "applications": {"zotero": {
        "strict_min_version": ZOTERO["strict_min_version"],
        "strict_max_version": ZOTERO["strict_max_version"],
    }},
}]}}}
(ROOT / "update.json").write_text(json.dumps(update, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(OUT)
