"""Create a local materials ZIP and compare every archived file with its source."""

import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    source = root / "marketing/wechat"
    destination = root / "dist/wechat-launch-v1.0-materials.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in source.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files:
            archive.write(file, file.relative_to(source.parent).as_posix())
    records = []
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert len(archive.infolist()) == len(files)
        for file in files:
            name = file.relative_to(source.parent).as_posix()
            payload = file.read_bytes()
            assert archive.read(name) == payload, name
            records.append({"file": name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
    manifest = {
        "article_version": "wechat-launch-v1.0",
        "created_at": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        "status": "local_materials_only_not_uploaded_or_published",
        "archive": destination.name,
        "archive_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "entries": len(records),
        "archive_matches_source": True,
        "files": records,
    }
    destination.with_suffix(".manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k != "files"}, ensure_ascii=True))
    print(f"ZIP bytes: {destination.stat().st_size}")


if __name__ == "__main__":
    main()
