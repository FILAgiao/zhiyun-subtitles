"""Regression checks for the optional article profile extension."""
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TOOLING = Path(__file__).resolve().parent
PACKAGE = Path(os.environ.get("WECHAT_SKILL_ROOT", Path.home() / ".codex/skills/wechat-skill"))
RENDERER_PATH = PACKAGE / ".agents/skills/wechat-content-pipeline/scripts/render_article.py"

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

renderer = load_module("profile_renderer", RENDERER_PATH)
upstream = load_module("upstream_profile_renderer", TOOLING / "upstream/render_article.py")
ARTICLE = (TOOLING / "test-fixtures/article.md").read_text(encoding="utf-8")

class ArticleProfileTests(unittest.TestCase):
    def profile_path(self, folder, value):
        path = Path(folder) / "profile.json"
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def test_default_output_unchanged_in_all_registered_themes(self):
        title, sections = renderer.parse_article(ARTICLE)
        self.assertEqual({}, renderer.load_article_profile(None))
        for name, theme in renderer.THEMES.items():
            with self.subTest(theme=name):
                self.assertEqual(
                    upstream.render_document(title, sections, upstream.THEMES[name]),
                    renderer.render_document(title, sections, theme),
                )

    def test_profile_labels_are_rendered_as_text(self):
        with tempfile.TemporaryDirectory() as folder:
            profile = renderer.load_article_profile(self.profile_path(folder, {
                "publication_label": "小蛙 & 伙伴",
                "publication_scope": "校园 · 学习 · 工具",
                "publication_note": "邀请同学来试试",
                "quote_label": "小蛙笔记",
            }))
        theme = dict(renderer.THEMES["moyu-green"])
        theme.update(profile)
        title, sections = renderer.parse_article(ARTICLE)
        output = renderer.render_document(title, sections, theme)
        for text in ("小蛙 &amp; 伙伴", "校园 · 学习 · 工具", "邀请同学来试试", "小蛙笔记"):
            self.assertIn(text, output)
        for text in ("TECH INSIGHT", "科技 · 产业 · 人", "深度观察", "KEY INSIGHT"):
            self.assertNotIn(text, output)
        self.assertIn("在看", output)

    def test_footer_can_be_disabled_for_every_layout(self):
        title, sections = renderer.parse_article(ARTICLE)
        for name, base in renderer.THEMES.items():
            with self.subTest(theme=name):
                theme = dict(base, show_follow_cta=False)
                self.assertEqual("", renderer.render_follow_cta(theme))
                output = renderer.render_document(title, sections, theme)
                self.assertNotIn("只取决于两件事", output)
                self.assertNotIn("信息说明", output)
                self.assertNotIn("阅读说明", output)
                self.assertNotIn("报告说明", output)
                self.assertIn("知识卡", output)

    def test_only_literal_false_disables_footer(self):
        theme = dict(renderer.THEMES["moyu-green"], show_follow_cta=True)
        self.assertIn("在看", renderer.render_follow_cta(theme))

    def test_unknown_fields_are_rejected(self):
        for key in ("layout", "accent", "font", "html", "publication"):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as folder:
                with self.assertRaisesRegex(renderer.RenderError, "未知字段"):
                    renderer.load_article_profile(self.profile_path(folder, {key: "value"}))

    def test_profile_field_types_are_strict(self):
        bad = [{"show_follow_cta": value} for value in (0, 1, None, "false", [], {})]
        bad += [{"publication_label": value} for value in (False, 1, None, [], {})]
        for profile in bad:
            with self.subTest(profile=profile), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(renderer.RenderError):
                    renderer.load_article_profile(self.profile_path(folder, profile))

    def test_markup_and_control_characters_are_rejected(self):
        for text in ("<img src=x>", "<script>alert(1)</script>", "小蛙\n工具", "小蛙\x00工具"):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as folder:
                with self.assertRaisesRegex(renderer.RenderError, "HTML 标记或控制字符"):
                    renderer.load_article_profile(self.profile_path(folder, {"publication_label": text}))

    def test_invalid_json_and_non_object_profiles_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text("{", encoding="utf-8")
            with self.assertRaises(renderer.RenderError):
                renderer.load_article_profile(path)
            for value in ([], "label", 1, None):
                with self.subTest(value=value), self.assertRaisesRegex(renderer.RenderError, "必须是对象"):
                    renderer.load_article_profile(self.profile_path(folder, value))

    def test_bom_profile_is_supported(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bom.json"
            path.write_text('{"publication_label":"小蛙"}', encoding="utf-8-sig")
            self.assertEqual({"publication_label": "小蛙"}, renderer.load_article_profile(path))

    def test_cli_profile_and_inline_degrade_keep_theme_local(self):
        before = dict(renderer.THEMES["moyu-green"])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            article = root / "article.md"
            article.write_text(ARTICLE, encoding="utf-8")
            output = root / "article.html"
            profile = self.profile_path(folder, {"publication_label": "小蛙品牌", "show_follow_cta": False})
            args = ["render_article.py", "--article", str(article), "--theme", "moyu-green",
                    "--output", str(output), "--profile", str(profile), "--inline-plan", str(root / "missing.json")]
            stdout = io.StringIO()
            with mock.patch.object(sys, "argv", args), contextlib.redirect_stdout(stdout):
                self.assertEqual(0, renderer.main())
            result = json.loads(stdout.getvalue())
            self.assertTrue(result["inline_degraded"])
            rendered = output.read_text(encoding="utf-8")
            self.assertIn("小蛙品牌", rendered)
            self.assertNotIn("TECH INSIGHT", rendered)
            self.assertNotIn("只取决于两件事", rendered)
        self.assertEqual(before, renderer.THEMES["moyu-green"])

    def test_invalid_cli_profile_does_not_write_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            article = root / "article.md"
            article.write_text(ARTICLE, encoding="utf-8")
            output = root / "article.html"
            profile = self.profile_path(folder, {"layout": "bad"})
            args = ["render_article.py", "--article", str(article), "--theme", "moyu-green",
                    "--output", str(output), "--profile", str(profile)]
            stderr = io.StringIO()
            with mock.patch.object(sys, "argv", args), contextlib.redirect_stderr(stderr):
                self.assertEqual(1, renderer.main())
            self.assertEqual("error", json.loads(stderr.getvalue())["status"])
            self.assertFalse(output.exists())

if __name__ == "__main__":
    unittest.main(verbosity=2)

