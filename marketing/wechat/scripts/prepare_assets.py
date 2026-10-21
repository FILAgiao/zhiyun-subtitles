"""Archive project supplied assets unchanged and keep a reusable source index."""

import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HOME = ROOT / "marketing/wechat"
ARTICLE = HOME / "2026-10-20-launch"
LIBRARY = HOME / "library"


def info(source, destination, role, used):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == hashlib.sha256(destination.read_bytes()).hexdigest()
    with Image.open(source) as im:
        dimensions = list(im.size)
        frames = getattr(im, "n_frames", 1)
    return {"source": source.relative_to(ROOT).as_posix(), "archive": destination.relative_to(HOME).as_posix(), "sha256": digest, "width": dimensions[0], "height": dimensions[1], "frames": frames, "role": role, "used_in_article": used, "rights": "user-supplied project asset; third-party license not independently verified"}


def main():
    feature_sources = [
        ("ads/v2/image-02-1280x800.png", "01-cache.png", "video cache"),
        ("ads/v2/image-01-1280x800.png", "02-sync.png", "subtitle and PPT sync"),
        (next((ROOT / "ads/v2").glob("*10_04_25.png")).relative_to(ROOT).as_posix(), "03-bilingual.png", "bilingual translation illustration without real person"),
        ("ads/v2/image-03-1280x800.png", "04-classroom.png", "PPT classroom view"),
        ("ads/v2/image-04-1280x800.png", "05-ai-explain.png", "AI explanation"),
        ("ads/v2/image-05-1280x800.png", "06-capture.png", "middle-button capture and annotation"),
        ("ads/v2/image-06-1280x800.png", "07-knowledge-card.png", "knowledge cards"),
    ]
    catalog, mapping = [], []
    selected = set()
    for relative, name, role in feature_sources:
        source = ROOT / relative
        selected.add(source.resolve())
        item = info(source, LIBRARY / "features" / name, role, True)
        info(source, ARTICLE / "images" / name, role, True)
        catalog.append(item)
        mapping.append({**item, "article_path": f"images/{name}"})
    for relative in ["ads/v2/zhiyun-banner-1400x560.png", "ads/v2/zhiyun-440x280.png"]:
        source = ROOT / relative
        selected.add(source.resolve())
        catalog.append(info(source, LIBRARY / "covers" / source.name, "existing product cover", False))
        info(source, ARTICLE / "covers/originals" / source.name, "existing product cover", False)
    for relative in ["assets/brand-logo.png", "assets/onboarding/frog-feature-actions.png"]:
        source = ROOT / relative
        catalog.append(info(source, LIBRARY / "brand" / source.name, "brand reference", False))
    for source in sorted((ROOT / "ads/v2").iterdir()):
        if source.is_file() and source.suffix.lower() in {".png", ".jpg", ".gif"} and source.resolve() not in selected:
            name = source.name
            if "10_40_18" in name:
                name = "bilingual-teacher-reference.png"
            elif "13_" in name:
                name = "bilingual-variant-" + source.stem.split()[-1] + ".png"
            catalog.append(info(source, LIBRARY / "extras" / name, "unused project alternative", False))
    inventory = []
    candidates = list((ROOT / "ads").rglob("*")) + list(ROOT.glob("*preview*.png"))
    for source in sorted(candidates):
        if source.is_file() and source.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}:
            inventory.append({"source": source.relative_to(ROOT).as_posix(), "bytes": source.stat().st_size})
    LIBRARY.mkdir(parents=True, exist_ok=True)
    (ARTICLE / "source").mkdir(parents=True, exist_ok=True)
    for destination, data in [(LIBRARY / "catalog.json", catalog), (LIBRARY / "project-image-inventory.json", inventory), (ARTICLE / "source/asset-map.json", mapping)]:
        destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"archived": len(catalog), "article_images": len(mapping), "project_images_indexed": len(inventory), "sha256_match": True}))


if __name__ == "__main__":
    main()
