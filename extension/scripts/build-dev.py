#!/usr/bin/env python3
"""Build a stable, separately named unpacked extension for local testing."""

import json
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile


root = Path(__file__).resolve().parent.parent
source_manifest = json.loads((root / "manifest.json").read_text())
archive = root / "dist" / f"profilebar-for-chrome-{source_manifest['version']}.zip"
dev_directory = root / "dist" / "profilebar-for-chrome-dev"

subprocess.run([root / "scripts" / "package.sh"], check=True, capture_output=True)
# Keep the folder path stable (it sets the unpacked extension ID) but drop files from older builds.
shutil.rmtree(dev_directory, ignore_errors=True)
dev_directory.mkdir(parents=True)
with ZipFile(archive) as package:
    package.extractall(dev_directory)

dev_manifest = json.loads((dev_directory / "manifest.json").read_text())
dev_manifest["name"] = "ProfileBar for Chrome Dev"
(dev_directory / "manifest.json").write_text(json.dumps(dev_manifest, indent=2) + "\n")

print(dev_directory)
