"""Run official CLI renderer + validator for all themes, without rendering HTML here."""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

TOOLING = Path(__file__).resolve().parent
PACKAGE = Path(os.environ.get("WECHAT_SKILL_ROOT", Path.home() / ".codex/skills/wechat-skill"))
RENDERER = PACKAGE / ".agents/skills/wechat-content-pipeline/scripts/render_article.py"
VALIDATOR = PACKAGE / "scripts/validate_gzh_html.py"
def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

renderer = load_module("matrix_renderer", RENDERER)
validator = load_module("matrix_validator", VALIDATOR)
output_dir = TOOLING / "verification/themes"
output_dir.mkdir(parents=True, exist_ok=True)
results = []
for name in renderer.THEMES:
    for mode in ("default", "profile"):
        output = output_dir / f"{name}-{mode}.html"
        command = [sys.executable, str(RENDERER), "--article", str(TOOLING / "test-fixtures/article.md"),
                   "--theme", name, "--output", str(output)]
        if mode == "profile":
            command += ["--profile", str(TOOLING / "test-fixtures/profile.json")]
        rendered = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
        checked = subprocess.run([sys.executable, str(VALIDATOR), str(output)],
                                 capture_output=True, text=True, encoding="utf-8") if rendered.returncode == 0 else None
        (output_dir / f"{name}-{mode}.log").write_text(
            "$ " + " ".join(command) + "\n" + rendered.stdout + rendered.stderr +
            ("\n" + checked.stdout + checked.stderr if checked else ""), encoding="utf-8")
        errors, warnings, leaves = validator.validate(output.read_text(encoding="utf-8")) if rendered.returncode == 0 else (["render failed"], [], 0)
        result = {"theme": name, "mode": mode, "render_exit": rendered.returncode,
                  "validator_exit": checked.returncode if checked else None,
                  "errors": errors, "warnings": warnings, "leaf_count": leaves,
                  "html": str(output)}
        results.append(result)
summary = {"theme_count": len(renderer.THEMES), "render_count": len(results),
           "all_passed": all(r["render_exit"] == 0 and r["validator_exit"] == 0 and not r["errors"] and not r["warnings"] for r in results),
           "results": results}
(TOOLING / "verification/theme-matrix.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k:v for k,v in summary.items() if k != "results"}, ensure_ascii=False))
sys.exit(0 if summary["all_passed"] else 1)

