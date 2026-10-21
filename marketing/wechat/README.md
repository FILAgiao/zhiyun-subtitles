# 公众号文章与素材档案

本目录保存可复用的品牌素材、每篇原稿与成稿、公众号排版、封面、发布备注和验证结果。

## 当前文章

- [2026-10-20 小奶蛙发布介绍](2026-10-20-launch/preview.html)：完整排版预览，含「复制到公众号」按钮。
- [Markdown 编辑稿](2026-10-20-launch/article.md) · [发布使用说明](2026-10-20-launch/publishing-notes.md)。

文章交付版本独立于浏览器扩展版本，不为排版文章重建或发布扩展。所有状态以单篇说明和验证回执为准。

## 目录约定

```text
marketing/wechat/
  library/                       共用品牌与功能图副本、素材索引
  templates/                     下次文章的 brief 和检查表
  scripts/                       可复用的本地素材整理与技能排版入口
  2026-10-20-launch/
    source/                      原稿、图片对应关系
    article.md                   完整可编辑成稿
    article.html                 可粘贴的内联样式正文
    preview.html                 含复制按钮的本地预览
    images/                      按正文顺序命名的配图
    covers/originals/            项目已有各比例封面
    covers/generated/            本篇原创封面及提示词
    review/                      联系表、检查回执与预览截图
    publishing-notes.md          摘要、使用步骤、来源与发布状态
```

后续按 `YYYY-MM-DD-主题` 新建文章目录，先复制 `templates/brief.md`，保留每篇原稿，不覆盖历史成稿或图片。

## 已安装的技能

来源：<https://github.com/843645440/wechat-skill>，安装分支 `release`，完整工具包安装于 `C:/Users/hufei/.codex/skills/wechat-skill`。同时注册其六个子技能：`wechat-viral-writer`、`humanizer-zh`、`wechat-tech-insight-writer`、`wechat-content-pipeline`、`wechat-public-event-archive`、`xiaohu-gen`。后续对话可直接调用；不为本次本地交付配置公众号凭证或创建定时任务。

本篇使用写作检查、润色及固定渲染器，不启动向公众号草稿箱上传的流水线。

## 重建排版

```powershell
python marketing/wechat/scripts/render.py marketing/wechat/2026-10-20-launch
```

入口调用已安装技能的官方脚本，不自行实现文章 HTML。默认主题为 `moyu-green`（松烟）；需要其他主题时加 `--theme`。先修改 `article.md`，再重建；不要直接修改 HTML 产物。

图片库是项目原件的归档副本，来源／哈希见 `library/catalog.json`，使用范围见 `library/README.md`。原件仍在原目录；不会删除或替换产品图片。

完整材料包：../../dist/wechat-launch-v1.0-materials.zip。运行 python marketing/wechat/scripts/package.py 重建并逐文件核对 ZIP；回执位于同名 .manifest.json。

本篇按已有短稿改写使用 writer-config.json（1000—2200 字），其它评分阈值沿用技能默认值。品牌刊头与关闭通用文末 CTA 通过 publication-profile.json 配置；安装后的可复用渲染器补丁及原件见 tooling/，升级上游技能后按说明重新应用。
