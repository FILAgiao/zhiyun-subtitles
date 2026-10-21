"""Run the upstream suite against backed-up renderer code, without changing installed files."""
import importlib.machinery
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path

TOOLING = Path(__file__).resolve().parent
PACKAGE = Path(os.environ.get("WECHAT_SKILL_ROOT", Path.home() / ".codex/skills/wechat-skill"))
TARGET = (PACKAGE / ".agents/skills/wechat-content-pipeline/scripts/render_article.py").resolve()
BACKUP = TOOLING / "upstream/render_article.py"
original_spec = importlib.util.spec_from_file_location
class BaselineRendererLoader(importlib.machinery.SourceFileLoader):
    def get_code(self, fullname):
        return compile(BACKUP.read_text(encoding="utf-8"), str(TARGET), "exec")
def baseline_spec(name, location, *args, **kwargs):
    if Path(location).resolve() == TARGET:
        kwargs["loader"] = BaselineRendererLoader(name, str(TARGET))
    return original_spec(name, location, *args, **kwargs)
importlib.util.spec_from_file_location = baseline_spec
os.chdir(PACKAGE)
sys.path.insert(0, str(PACKAGE))
suite = unittest.defaultTestLoader.discover(str(PACKAGE / "tests"))
result = unittest.TextTestRunner(verbosity=1).run(suite)
summary = {"renderer_source": str(BACKUP), "installed_renderer_unchanged_during_test": True,
           "tests_run": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
           "skipped": len(result.skipped),
           "failure_ids": [test.id() for test, _ in result.failures],
           "error_ids": [test.id() for test, _ in result.errors]}
(TOOLING / "verification/upstream-baseline.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k:v for k,v in summary.items() if not k.endswith("_ids")}, ensure_ascii=False))
sys.exit(0 if result.wasSuccessful() else 1)

