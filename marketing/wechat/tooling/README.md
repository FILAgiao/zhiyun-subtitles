# 公众号渲染工具本地扩展

版本：article-profile-v1，2026-10-20。状态：已安装到本机技能的两个注册副本；只用于本地排版，未向上游提交，未上传或公开发布公众号文章。

## 解决的问题

默认松烟主题刊头固定写着“TECH INSIGHT / 科技 · 产业 · 人 / 深度观察”，通用主题尾部还有统一的关注引导。产品介绍、校园文章和其他刊物可使用独立 profile 配置刊头，并按需关闭渲染器附加的文末引导；未传 profile 时行为不变。

本次修改官方 render_article.py，没有另造渲染器，也不手改生成后的正文 HTML。官方预览模板另修复了 320px 窄屏工具栏提示占位过宽的问题。

## 使用

在官方原命令上加 `--profile <JSON路径>`，例如：

```powershell
$skillRoot = 'C:/Users/hufei/.codex/skills/wechat-skill'
python "$skillRoot/.agents/skills/wechat-content-pipeline/scripts/render_article.py" --article article.md --theme moyu-green --output article.html --profile article-profile.json
```

配置样例：

```json
{
  "publication_label": "小奶蛙工具箱",
  "publication_scope": "校园 · 学习 · 工具",
  "publication_note": "同学来试试",
  "quote_label": "小蛙笔记",
  "show_follow_cta": false
}
```

| 字段 | 类型 | 默认行为 / 作用 |
|---|---|---|
| publication_label | 纯文本字符串 | 松烟 magazine 刊头；默认 TECH INSIGHT |
| publication_scope | 纯文本字符串 | 松烟 magazine 刊头下栏；默认 科技 · 产业 · 人 |
| publication_note | 纯文本字符串 | 松烟 magazine 刊头下栏；默认 深度观察 |
| quote_label | 纯文本字符串 | 章节英文标签的兜底值；默认 KEY INSIGHT。原来的关键词映射及 THE END 保持原样。引用块本身没有这个标签 |
| show_follow_cta | JSON 布尔值 | 默认保留渲染器文末模块；false 时整个 render_follow_cta 模块为空，包括严肃主题的编辑说明 |

所有字段均为可选。JSON 顶层必须是对象；拒绝未知字段、错误类型、HTML 标记和控制字符。文本仍经官方 leaf 转义。支持 UTF-8 及带 BOM 的 UTF-8 JSON。profile 只更新当前文章的主题副本，不修改全局 THEMES，也不支持任意 CSS、HTML、layout 或色值覆盖。

## 修改与备份

- `render-article-profile.patch`：官方渲染器补丁，相对完整技能包根目录。
- `preview-mobile-hint.patch`：完整包 assets/preview-template.html 的窄屏提示宽度补丁。
- `upstream/render_article.py`：修改前原件；SHA256 为 814F7D087ED5D5C17E168A98607CBB96499B6DE3786967F9D851FAEFDBDC28FE。
- `upstream/preview-template.html`：修改前预览模板原件。

已同步：

1. C:/Users/hufei/.codex/skills/wechat-skill/.agents/skills/wechat-content-pipeline/scripts/render_article.py
2. C:/Users/hufei/.codex/skills/wechat-content-pipeline/scripts/render_article.py

修改后两份渲染器 SHA256 均为 BDD5E65A780CF318A8B866E2DC6EE2762BBEF3D49E54D5AEE2CE7E4DCAB3A55B。

模板响应式规则将 `.gzh-hint{max-width:150px;}` 改为 `.gzh-hint{max-width:calc(100vw - 200px);}`，字体保持 13px。生成新预览时使用官方 wrap_preview.py。

后续重新安装技能可能覆盖本地修复。先对照上游版本，再在完整包根目录检查并应用补丁：

```powershell
git -C C:/Users/hufei/.codex/skills/wechat-skill apply --check --ignore-space-change --ignore-whitespace F:/all_my_code/tools/zhiyunzimu/marketing/wechat/tooling/render-article-profile.patch
git -C C:/Users/hufei/.codex/skills/wechat-skill apply --ignore-space-change --ignore-whitespace F:/all_my_code/tools/zhiyunzimu/marketing/wechat/tooling/render-article-profile.patch
```

模板补丁同理。当前安装文件已成功通过两份补丁的 `git apply --check --reverse --ignore-space-change --ignore-whitespace`，反向检查不写文件。应用渲染器补丁后需要再次同步全局注册副本；勿覆盖已经发生新改动的上游文件。

## 验证记录

使用 bundled Python 3.12.14 / Pillow 12.3.0，完整包目录为 C:/Users/hufei/.codex/skills/wechat-skill。

| 检查 | 结果 | 回执 |
|---|---|---|
| 官方 tests.test_article_renderer | 19 项全部通过 | verification/article-renderer-tests.log |
| 新增 profile 回归 | 11 项全部通过 | verification/profile-regression-result.json |
| 全部注册主题官方 CLI 渲染与 validate | 12 主题 × 默认/profile = 24 份，全部 0 ERROR、0 WARNING | verification/theme-matrix.json、verification/themes/ |
| 完整官方 unittest discover -s tests | 227 项；16 failures、45 errors、5 skipped | verification/full-suite-tests.log |
| 原件渲染器完整套件基线 | 同样 227 项；16 failures、45 errors、5 skipped | verification/verify-upstream-baseline.py.log、verification/upstream-baseline.json |
| 安装副本与补丁校验 | 两渲染器哈希一致；两补丁反向只读检查均成功 | verification/tooling-receipt.json |

完整套件没有全绿。失败来自既有 Windows 兼容与其它子系统问题，包括 fcntl 不可用、Windows 盘符被当作 URL scheme、job.json 路径生成、符号链接权限、临时文件锁及部分 inline plan 测试。原件基线使用导入加载器读取备份代码，保留原始 __file__ 路径；测试期间没有替换安装文件。基线结果与修复后计数相同，不把完整套件写成通过。

profile 回归覆盖：全部 12 主题默认输出与原件逐字相同、品牌标签安全转义、各 layout 关闭 footer、严格白名单和类型、HTML/控制字符拒绝、无效 JSON、UTF-8 BOM、CLI inline 降级保留 profile、全局主题不被污染、错误配置不写输出。

复跑入口：

```powershell
python marketing/wechat/tooling/test_article_profile.py
python marketing/wechat/tooling/verify-theme-matrix.py
```

测试样例含代码块、表格、列表、引用、子标题和图片。默认读取当前用户 .codex/skills/wechat-skill；可通过 WECHAT_SKILL_ROOT 指定完整包位置。test_article_profile.py 还使用本目录 upstream/render_article.py 作为默认输出基线。

