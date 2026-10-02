"""Check web-editor exports with the installed G3M source tree, using temporary profiles."""

import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(sys.argv[1]).resolve() / "src"))
from controllers.mod.import_export_controller import ModImportExportController
from utils.mod.config import parse_mod_config, validate_mod_config
from utils.mod.hashing import sha256_path
from utils.mod.legacy_config_migration import migrate_legacy_config


def require(condition, message):
    if not condition:
        raise AssertionError(message)


request = json.load(sys.stdin)
disagreements = []
for item in request.get("configs", []):
    issues = validate_mod_config(item["config"])
    if bool(issues) == item["valid"]:
        disagreements.append(f"{item['label']}: {issues}")
require(not disagreements, "\n".join(disagreements))

for item in request.get("legacy", []):
    with tempfile.TemporaryDirectory(prefix="mce_legacy_contract_") as temporary:
        root = Path(temporary)
        for name, content in item["files"].items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(content))
        for name in item["directories"]:
            (root / name).mkdir(parents=True, exist_ok=True)
        actual = migrate_legacy_config(item["data"], mod_root_path=root)
        require(
            actual == item["expected"],
            f"Migration disagreement: {item['label']}\nG3M: {actual}\nMCE: {item['expected']}",
        )

for item in request.get("hashes", []):
    with tempfile.TemporaryDirectory(prefix="mce_hash_contract_") as temporary:
        root = Path(temporary)
        for name, content in item["files"].items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(content))
        for name in item["directories"]:
            (root / name).mkdir(parents=True, exist_ok=True)
        require(
            sha256_path(root / item["relative"]) == item["expected"],
            "Folder hash differs from G3M",
        )

for item in request.get("archives", []):
    with tempfile.TemporaryDirectory(prefix="mce_g3m_import_") as temporary:
        root = Path(temporary)
        mods = root / "mods"
        mods.mkdir()
        archive = root / "export.zip"
        archive.write_bytes(base64.b64decode(item["base64"]))
        events, errors = [], []
        service = SimpleNamespace(
            get_mod_folder_path=lambda _id: None,
            invalidate_mods_cache=lambda events=events: events.append("invalidate"),
            load_local_mods=lambda events=events: events.append("load"),
            mod_list_updated=SimpleNamespace(
                emit=lambda events=events: events.append("emit")
            ),
        )
        controller = ModImportExportController(
            SimpleNamespace(mods_dir=str(mods)), service, SimpleNamespace()
        )
        controller._safe_show_information = lambda *args, events=events: events.append(
            "success"
        )
        controller._safe_show_critical = lambda *args, errors=errors: errors.append(
            args
        )
        controller._show_import_error_with_manual_install = (
            lambda *args, errors=errors: errors.append(args)
        )
        controller._install_mod_from_file(str(archive))
        require(not errors, f"G3M import failed for {item['label']}: {errors}")
        installed = list(mods.iterdir())
        require(
            len(installed) == 1 and "success" in events,
            f"G3M did not install {item['label']}",
        )
        config = json.loads(
            (installed[0] / "mod_config.json").read_text(encoding="utf-8")
        )
        require(
            parse_mod_config(config) == item["config"],
            f"G3M changed exported config: {item['label']}",
        )
        for name, content in item["files"].items():
            require(
                (installed[0] / name).read_bytes() == base64.b64decode(content),
                f"Payload changed: {name}",
            )
        for name in item.get("directories", []):
            require(
                (installed[0] / name).is_dir(), f"Bundled folder disappeared: {name}"
            )
print(
    json.dumps(
        {
            "configs": len(request.get("configs", [])),
            "legacy": len(request.get("legacy", [])),
            "hashes": len(request.get("hashes", [])),
            "archives": len(request.get("archives", [])),
            "status": "passed",
        }
    )
)
