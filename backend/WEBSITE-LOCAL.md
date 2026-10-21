# 原官网整合 · 本地验收

页面独立版本：0.20.60-r3（2026-10-21），不等于扩展版本或公网版本。

保持原官网的六张图、暖纸色 / 深蓝 / 陶橙、章节与细线布局。新增同域入口：

- `/gateway/study`：我的问答；`?login=1` 自动打开登录。
- `/gateway/account?tab=register`：人工申请独立账号。
- `/gateway/account?tab=recharge`：人工充值 / 增加额度。
- `/gateway/admin`：沿用原账号与运营管理；普通账号无管理员权限。

插件申请、充值、网页回看和后台导航均已改为原官网；此前的 Sites 不再是新代码的目标入口。个人问答始终由本人账号鉴权；免费和到期账号可阅读自己的已保存文字问答，网页读取不调用 AI。截图留在原设备，只在主动保存时同步文字记录。

## 打开本地验收

需要 Python 3.11 或以上，无额外 Python 依赖。解压完整官网验收包，在包内右键以 PowerShell 运行 `start-preview.ps1`，或在包目录执行：

```powershell
python -m backend.public_preview --demo --port 8765
```

访问 `http://127.0.0.1:8765/gateway/`。这是电脑本机的临时预览，其他设备不能直接访问该 loopback 地址。

示例账号：`preview@example.test`，示例密码：`local-preview-only-2026`。均为公开的临时测试凭据，不是线上账号；请勿输入真实账号密码。预览仅访问临时 SQLite，含两条明确标注的示例问答。关闭命令行 / Ctrl+C 后数据删除；重新启动会恢复示例。模型、邮件和管理写入被预览入口禁用。未配置二维码时申请和充值均显示“暂未开放”。

静态介绍页也提供独立离线预览包，双击 `index.html` 可看原六图。账号页需要 HTTP 服务，不能用 file:// 代替接口联调。

## 验证口径

- Python HTTP 接线：明确静态白名单、资源 MIME 与 CSP、仅办理页可加载 HTTPS 二维码；实际 /gateway 前缀的登录、读取、删除、退出和不相关来源拒绝。
- Chrome 与 Edge：真实本地后端的免费账号完整流程；未调用付费模型、邮件或线上账号 API。
- 独立界面：320 / 390 / 桌面、课程 / 搜索、XSS 文字显示、迟到响应隔离、401 / HTML 错误、15 秒超时与防双提交、二维码成功 / 失败 / 危险网址、键盘、减少动态效果及无 JS 首页可读。
- 原有账号、学习记录、运营与旧版兼容套件 72 项通过；新 HTTP 接线 4 项通过；官网图片 / 安装按钮和插件保存入口回归通过。回执以打包生成的 `verification.json` 为准。

## 登录问题与实际发布状态

2026-10-21 原站健康接口及一次空凭据登录可正常返回，不能证明某个真实用户密码正确。Sites 已有登录日志为 1–8ms 的 HTTP 502，而旧中转将所有 fetch 异常都标成“超时”；日志不足以区分 DNS / TLS / 网络策略的更底层原因。

本地新版直接请求同源 /gateway/v1/...，移除 Sites Worker 中转；区分错误密码、无法连接、真正等待超时和会话过期。这验证了本地实现，不能称为线上登录已修复。生产的前端、study_api.py / operations_api.py 和数据库迁移需要一起更新，现公网旧后端尚不提供这些新接口。

用户已明确本轮只做本地验收。未更新服务器、未更改真实账号或收款配置、未部署 / 删除 Sites，未提交商店。未来发布脚本已加入新静态资源及公网字节核对；本轮没有执行该脚本。部署后再迁移 / 下线 Sites，避免先删导致旧用户失去入口。当前部署回滚需要还原文件、环境及必要的数据库备份，不能仅重新启动共用挂载目录的旧容器。

## 动效依据

以短促状态反馈为主，transform / opacity 渐进增强；内容默认可见，减少动态效果时停用位移。资料：[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、[web.dev 动效](https://web.dev/articles/animations-guide)、[MDN IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)、[MDN 减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)。
