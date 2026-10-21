"""Run the installed WeChat toolkit without replacing its renderer."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("article_dir", type=Path)
    parser.add_argument("--theme", default="moyu-green")
    args = parser.parse_args()
    article_dir = args.article_dir.resolve()
    skill = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "skills/wechat-skill"
    renderer = skill / ".agents/skills/wechat-content-pipeline/scripts/render_article.py"
    if not renderer.is_file():
        raise SystemExit("wechat-skill is not installed; see marketing/wechat/README.md")
    review = article_dir / "review"
    review.mkdir(parents=True, exist_ok=True)
    score_command = [skill / ".agents/skills/wechat-viral-writer/scripts/score_draft.py", "--article", article_dir / "article.md"]
    config = article_dir / "writer-config.json"
    if config.is_file():
        score_command += ["--config", config]
    render_command = [renderer, "--article", article_dir / "article.md", "--theme", args.theme, "--output", article_dir / "article.html"]
    profile = article_dir / "publication-profile.json"
    if profile.is_file():
        render_command += ["--profile", profile]
    commands = [
        ("writing-score.json", score_command),
        ("render-result.json", render_command),
        ("html-validation.txt", [skill / "scripts/validate_gzh_html.py", article_dir / "article.html"]),
        ("preview-build.txt", [skill / "scripts/wrap_preview.py", article_dir / "article.html", article_dir / "preview.html"]),
    ]
    for report, command in commands:
        result = subprocess.run([sys.executable, *map(str, command)], cwd=article_dir, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        (review / report).write_text(result.stdout, encoding="utf-8")
        print(result.stdout, end="")
        if result.returncode:
            raise SystemExit(result.returncode)
        if report == "writing-score.json":
            score = json.loads(result.stdout)
            if score.get("blocking_count", 1) or score.get("score", 0) < 75:
                raise SystemExit("Writing checks require corrections; see review/writing-score.json")
    print(f"Preview: {article_dir / 'preview.html'}")


if __name__ == "__main__":
    main()
