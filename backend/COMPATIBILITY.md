# 0.20.61 后端兼容交付（2026-10-20）

用户确认当前商店发布基准为 **0.20.48**。本次仅完成本地修复、测试和打包，未部署服务器或提交商店。公网油猴版本与商店版本是不同渠道，不用油猴元数据推断商店版本。

## 保留的接口和权限

Chrome、Edge 共用一个后端与 `/v1`，不按商店分叉。0.20.48 的无版本请求继续接受；登录、me 的旧字段、JSON 翻译、AI create/poll/cancel、语音 submit/query 和旧会话、账号权限、额度均保留。协议版本与扩展版本分别管理，不按“最新扩展版本”强制拒绝旧用户。

新登录和 me 的 capabilities 保留 web_search，并增加 api_versions、learning_jobs、speech_requires_login、guest_speech、membership、graceful_shutdown 以及 compatibility 基准。新增字段允许旧客户端忽略。新增客户端版本 / 渠道仅用于诊断，不参与授权判断。

**权限边界**：免费 / 到期 / 未登录不能访问付费接口。游客语音属于已确定的产品规则变化，仍拒绝并返回明确登录说明；不能伪造 0.20.48 或渠道头绕过。无法远程修改已安装的 0.20.48 界面，旧版提示样式与本机记录 / 知识卡门禁仍由其原代码决定。

旧管理页不发送 plan、但明确授予正数 request_limit 时，按 legacy 保留其原有功能开关、额度与有效期；新版页面明确传 free 时，即使有正额度也不开通高级权限。修改已有 free 账号时，旧页面仅增加额度不会隐式升级套餐。无显式正额度的新建请求默认 free。旧管理员本来就有开通权限，此转换仅发生在鉴权后的管理员接口。

## 客户端诊断

新客户端发送 X-Client-Version 和 X-Client-Channel。扩展后台覆盖页面提供的身份，版本来自安装包 manifest。构建时设置 EXTENSION_CHANNEL=chrome-store 或 edge-store；默认 unpacked。未配置时不猜测用户来自哪家商店。油猴上报 userscript。活动会话表展示版本和渠道，旧版缺失时显示未知。

版本元数据使用独立 activity_client_metadata 表，保留原 activity_sessions 的 8 列，旧后端回滚时原有登录 SQL 仍可执行。旧会话首次使用新客户端时也能补充版本，不要求重新登录。身份头不可信，绝不用于授予权限。

## 部署与任务

新服务接到 SIGTERM / SIGINT 后，拒绝新模型、AI create 和语音 submit（503 + Retry-After，未预占费用），继续服务登录、账号读取、语音 query、AI poll/cancel。等待进行中的工作结束，且 AI 终态被客户端读取后再退出；最长 120 秒，随后给最后响应 1 秒发送时间。部署脚本和 Compose 使用 130 秒停止宽限期。

仅持久保存约 5 分钟任务回执（ID、账号、APP、创建时间），不保存问题、截图或回答。若崩溃或强制退出，重启后旧任务会收到旧客户端可理解的 error 终态与明确说明，不会自动重放付费请求。跨账号不可读取。回答正文仍在内存中，**这不等于持久恢复完整回答**；中断调用保留现有保守计量规则，不自动退款或重新扣费。

**首次升级限制**：旧服务没有本次信号收尾代码；第一次从旧后端切换时仍应选低峰并预告短暂维护，不能声称所有旧进行中任务无损迁移。本次功能部署之后的更新才可使用新收尾机制。初次升级前创建的内存任务也没有新回执。

完整发布使用现有 deploy_release.py（先备份代码 / 环境 / SQLite，再核验构建与公网文件）。只更新介绍页的 publish_public_page.py 继续只补静态路由，不带入待发布套餐规则，但仍会重启；已升级服务可享用上述收尾流程。所有文件编译、备份和上传校验完成后才替换；本轮没有运行任何远程发布脚本。

## 验证

- `npm run test:compatibility`：原始 0.20.48 网关及后台白名单通过回环 HTTP 连接新后端；基准来源与 SHA-256 见 fixtures/compat/provenance.json。未改写旧网关，未调用线上付费服务。
- `npm run test:gateway`：后端、账号、兼容与网关回归。
- `node --test extension.test.cjs extension-bridge.test.cjs`：扩展身份、固定网络范围与原生桥接。
- `node release.test.cjs`：完整脚本、元数据及版本一致性。

本地完整扩展为 dist/zhiyun-subtitles-0.20.61.zip，备用完整脚本为根目录 zhiyun-subtitles.user.js。后端候选文件另打包为 dist/backend-compatibility-0.20.61.zip，不包含 .env、账号、数据库或 SSH 凭证。
