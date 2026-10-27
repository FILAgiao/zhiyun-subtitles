# 本轮 12 项问题验收（0.20.88 完整本地测试包）

2026-10-25。功能修复原版本 0.20.87；交付时保留同期首页入口改动，最终完整包为 0.20.88。未上传服务器、未提交商店。

| 问题 | 最终行为与边界 | 验证 |
| --- | --- | --- |
| 1 配置和登录 | 扩展 storage.local；账号在后端；同 ID 更新保留；登录目前 7 天到期。详情见 DATA-AND-UPDATES.md | adapter/服务端代码核对、Chrome 官方文档 |
| 2 自动更新与卸载 | ZIP 测试版手动覆盖原目录+重载；无自动卸载代码；卸载会清本机扩展数据 | manifest、构建、后台代码核对 |
| 3 提示词 | 继续/新对话及首次截图/PPT提问从最新设置应用；隔离云提示词列表迟到结果 | ai-conversation-regressions-ui、cloud-prompts-ui |
| 4 滚动 | 从旧消息发问会滚到新问题，之后流式和最终回答均保持阅读位置；查看下方为一次定位 | ai-stream-scroll-ui、ai-conversation-regressions-ui |
| 5 PPT/视频 | 并排近各半幅并保原比例；放大/手动缩放后退出全屏重新适配原课堂边界 | classroom-layout-update-ui Chrome+Edge MV3、ui.test、playback-ui |
| 6 同步 | 每课程记住开关；右上显示等待、倒计时、旋转时钟、暂停/权限状态；手动关闭保持停止；无权限不计时 | sync-persistence-ui Chrome+Edge，每端8轮立即刷新；speech-sync-ui18场景 |
| 7 关闭漂移 | 不用隐藏元素零尺寸覆盖位置，关闭对话/列表回到右上入口 | sync-persistence-ui、classroom-layout-update-ui |
| 8 缩略入口 | 上课爽 / ✦讲解这页 / ☰问题列表；课堂无独立继续问答浮钮 | classroom-layout-update-ui、conversation回归 |
| 9 图片 | 原生静态PNG保留预览细节，AI输入单独压缩；收藏按后台能力保3840/4MB或回退1600/1.5MB；网页大图完整适配视窗，原图按需单张加载 | clip-capture-resolution-ui、clips-ui真实API/Chrome网页/Edge原生截图 |
| 10 对话同步 | 已登录且归属确认的新对话自动保存文字，旧会话主动续聊/保存后绑定；待同步/失败状态持久化，支持重试；账号切换忽略迟到结果 | conversation回归、gateway单元、backend.test_study |
| 11 资料状态 | 🌐译开/关、💬字幕条数、🖼PPT条数同一行；移除重读按钮，失败从看PPT入口重试 | layout、live-resource-retry |
| 12 PPT工具条 | 去可见收起和底部讲解；校准加减为最右控件，手动时间校准保留 | layout、ppt-sync、ppt-thumbnails |

180 核心、71 AI/网关/扩展单元、39 账号/提示词/问答/收藏后端项目通过；另有课堂、云同步、截图与网页专项。测试使用合成媒体、本地API及模拟模型；没有采集用户课堂，没有付费模型调用。

网页 CSS 和高清新上限需要部署新版后端后才会在公网生效；扩展兼容旧后端限额。图片不会因文字自动保存而自动上传；仍由主动收藏保存。旧低清截图已丢失的像素无法恢复。关闭/刷新页面可能中断正在生成的回答，已归档本机和云端记录保留。

交付：`dist/zhiyun-subtitles-0.20.88-workspace-tested.zip`；冻结目录：`dist/workspace-fixes-0.20.88-tested`；完整备用脚本与元数据同名前缀。更新请覆盖之前加载的原扩展目录，重新加载扩展并刷新课堂，保留原扩展ID，不要先卸载；停用重复扩展/油猴。
