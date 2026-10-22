> 当前交付（2026-10-22）：0.20.79 图片收藏/网站回看仅本地，见 [CLIPS-API](CLIPS-API.md)。公网核验安装元数据为 0.20.76，流式识别/文字保存/云提示词能力已存在，邮箱未配置。下文“尚未打包 MV3”“纯油猴”等早期段落不是当前状态，完整扩展已可构建。本轮未部署。

## 0.20.76 流式字幕同步（2026-10-22，待统一部署）

新增连续流式识别、真实逐词时间对齐和一次会话首个可靠结果立即生效。后端必须同时更新 `server.py` 与 `speech_stream.py`，设置服务器流式资源凭证；完整文件、额度、迁移和验收见 [SPEECH-STREAM.md](SPEECH-STREAM.md)。本轮只准备代码，未上线；真实课堂90%首次成功率尚未验证。

## 0.20.64 云端提示词（2026-10-20，仅本地实现）

## 原官网整合与本地预览（0.20.60-r3）

本轮仅本地验收。新问答与申请 / 充值页使用同域 /gateway/study、/gateway/account，不再依赖 Sites 代理。运行 `python -m backend.public_preview --demo --port 8765` 可在临时数据库中查看示例；预览不开放邮件、模型或管理写入。完整步骤、错误排查、验证与实际发布状态见 [WEBSITE-LOCAL.md](WEBSITE-LOCAL.md)。新前后端必须一起部署；本轮没有更新服务器或下线 Sites。


新增官方与账号个人提示词数据库、接口及官方后台编辑页。启动自动迁移，保留旧账号与表；本轮未修改线上数据库或上传服务器。接口、数据隔离、发布与备份要求见 [PROMPTS.md](PROMPTS.md)。部署文件清单已包含 `prompt_api.py` 和 `official-prompts.json`，不要只更新扩展。下文旧版本记录是历史说明。

# 最小统一 API 后端

当前本地兼容候选为 **0.20.61**，面向已发布的 **0.20.48** 扩展；协议仍为 `/v1`。旧会话与无版本请求继续接受，版本诊断、旧管理页面兼容和部署收尾见 [兼容与部署说明](COMPATIBILITY.md)。本次未发布服务器。

Python 3.11+ 标准库 + SQLite，无额外 pip 依赖。服务器统一保存豆包凭证，浏览器只拿可退出、七天过期的用户会话。一个账号可开通多个 APP，APP 权限和额度分别设置。本版包含人工创建账号、免费 / PRO / Ultra 套餐授权、登录、退出、额度查询、模型代理、语音提交和查询；不包含公众注册、找回密码、充值支付。

## 本项目代理范围

| 功能 | 后端路径 | 原因 |
| --- | --- | --- |
| 逐句翻译、术语增强翻译 | POST /v1/ark/responses | 隐藏平台 Ark Key，记录模型用量 |
| PPT、文字、中键、截图、多轮讲解 | POST /v1/ark/responses | 共用 Ark Key；图片只接受受限 data URL |
| 自动字幕校准 | POST /v1/speech/submit 与 query | 隐藏独立语音 Key；任务归属、去重和音频秒数 |
| 字幕读取、排版、时间匹配、PPT 同步、本地视频缓存、知识卡 | 保持本地 | 当前无需平台付费凭证；不上传整段视频、学校登录 Cookie |

GET /health 检查存活。POST /v1/auth/login 接受 email/password；POST /v1/auth/logout 撤销当前会话；GET /v1/me 返回账号及该 APP 本月用量。认证接口要求 X-App-Id（本项目为 zhiyun-subtitles），登录后要求 Authorization: Bearer 用户会话。X-App-Id 是应用标识，不是密钥；服务器检查账号是否有此 APP 的授权。

## 本地启动

从项目根目录运行：

```powershell
python backend/server.py add-user --email you@example.com --requests 1000 --audio-seconds 3600
# 密码通过隐藏输入读取，不放命令行参数；至少 12 字符。
# 在当前终端环境设置 ARK_API_KEY / SPEECH_API_KEY，值不要写入代码。
python backend/server.py serve
```

脚本默认只监听 127.0.0.1:8080。配置文件示例不自动加载；本地环境通过终端设置，Linux 服务通过 systemd EnvironmentFile 加载。不用 Key 也能启动并验证登录与健康接口，但调用对应供应商接口会返回 503。

设置 → 我的账号，填写用户名或邮箱和密码。发布构建固定服务地址，不在账号页显示地址或后台入口。登录后点击查看额度。退出后保留服务地址，付费调用停止，不回退直连豆包。

gateway.config.json 保存非敏感服务地址；普通构建会自动读取它并固定后端，未登录时不会使用旧的本地豆包 Key。GATEWAY_ORIGIN 可覆盖此地址，例如迁移至自己的域名：

```powershell
$env:GATEWAY_ORIGIN='https://api.YOUR_DOMAIN'
node build-userscript.cjs
```

构建自动增加该主机的 userscript @connect 权限，无通配符。设置 gateway.config.json 或 GATEWAY_ORIGIN 后，构建自动添加对应主机权限。仅在显式关闭配置的开发构建中保留原有用户自带 Key 模式。当前交付构建已指向实际服务器地址，见文末部署记录。

## Linux 部署模板

下面是通用 systemd / Nginx 部署模板；本次实际服务器已采用 Docker / Caddy，具体信息见文末部署记录。

1. 代码放 /opt/zhiyun-gateway，创建专用无登录用户 zhiyun-gateway。
2. backend/.env.example 复制到 /etc/zhiyun-gateway.env，在服务器填写真实 Key、已开通的模型、实际插件 Origin。文件设为 root:root 0600。
3. backend/zhiyun-gateway.service 放到 systemd，StateDirectory 自动创建数据库目录。以服务用户运行 add-user 并显式指定 --db /var/lib/zhiyun-gateway/gateway.sqlite3。示例：`sudo -u zhiyun-gateway python3 /opt/zhiyun-gateway/backend/server.py add-user --db /var/lib/zhiyun-gateway/gateway.sqlite3 --email you@example.com`。
4. 在已有 HTTPS 域名的 Nginx server 中加入 nginx-location.conf，核验 nginx -t 后加载配置。公网只开放 HTTPS；8080 只监听回环。
5. 检查 health、登录、真实翻译、真实语音任务和用量增长。备份数据库应使用 SQLite backup API，或先停止服务再复制，避免只复制 WAL 数据库主文件。

Nginx 必须覆盖 X-Real-IP，后端只信任回环代理传来的地址，用于登录限流；别把任意客户端传入的 IP 直接当作可信来源。服务最多 32 个处理线程，账号限流 90 次/分钟，最多两个进行中的付费调用；登录按 IP 和邮箱分别限流 10 次/15 分钟。允许的 Origin 在服务端配置，无 Origin 的油猴/移动端 AI 请求仍必须认证；所有模型和语音调用都必须登录并通过有效套餐授权；0.20.56 已移除游客语音例外。

## 额度口径与限制

- 月份采用 UTC，每个用户 + APP 分别统计。限制是月付费请求次数及月提交的有效音频秒数；Token 目前用于计量展示，不是硬 Token 上限，也没有金额预算。
- 模型保存官方 usage 的 input_tokens/output_tokens/total_tokens 和 web_search 次数；不靠字符长度猜 Token，不把这些数直接等同于账单金额。
- 每个模型调用扣一次请求；语音仅 submit 扣一次，query 不重复扣；语音时长由服务器解析 PCM WAV，客户端不能自行报时长。
- 请求预占在 SQLite 事务内，防止并发超额度。上游超时/异常及没有 usage 的模型响应保留占用并标记待核对，不自动重试，也不假装零消耗。待核对 Token 可能低于供应商实际账单，应在控制台核对；后续可加管理员对账功能。
- 语音 UUID 不得重复提交，任务只能由原用户及 APP 查询。服务器持久保存语音结果以便重复 query 返回缓存，24 小时后在下一次语音请求时清理；截图、模型问题和模型回答不落库。调用账本长期保留以计量；数据库应限制访问并按需求制定保留期。
- 后端固定两个官方主机，禁重定向，模型白名单、AI 可用 SSE 流式而翻译保留 JSON、普通模型 store:false（专用翻译模型不接受该字段，因此省略）、输出最多 4096 Token、文字最多 32000 字符、最多三张大小受限的内嵌图片。拒绝远程图片 URL、音频 URL、任意工具与超长音频。联网搜索默认关闭，服务端 ALLOW_WEB_SEARCH=1 才开放。
- 服务器不保存用户密码明文；PBKDF2-HMAC-SHA256（600000 次随机盐）保存密码，数据库只保存会话 SHA256。日志不记录请求正文或认证头。

给同一个账号开通另一个 APP：再次运行 add-user --email 同一邮箱 --app OTHER_APP --requests 额度 --audio-seconds 额度；已有账号不会修改密码，更新该 APP 的额度。客户端传对应 X-App-Id 即可接入。当前供应商配置为所有 APP 共用，按 APP 切分供应商 Key 是后续扩展。

## Chrome 插件上架前

项目当前仍是油猴脚本，尚未转换为 Manifest V3 插件。代理层已经可复用；插件版需在扩展后台请求固定 HTTPS 后端，host_permissions 只列后端和必要学校资源主机，不打包服务端目录或 .env，不写入供应商 Key。服务端 ALLOWED_ORIGINS 填实际 chrome-extension://扩展ID。还需根据最终产品准备数据用途说明和隐私政策，明确字幕/用户选中的课件截图/短音频会发送到你的后端和豆包。

## 验证

```text
npm run test:gateway
npm test
node gateway-ui.test.cjs
```

测试使用本机 HTTP 和模拟供应商，验证登录、撤销、APP 权限、并发额度、未知费用保留、音频时长、语音任务归属、重启持久化、CORS、代理凭证隔离。真实服务器部署及账号链路已验证；真实 Ark Key、语音 Key、英译中、中译英、AI 模型调用及语音识别链路均已验证。

官方协议参考：[Responses API](https://docs.volcengine.com/docs/ark/create-model-responses-api?lang=zh)、[语音结果查询](https://docs.volcengine.com/docs/DoubaoVoice/result-query-http-1?lang=zh)。
## 已部署服务器（2026-10-08）

本次已以 root 成功连接 47.77.182.216。服务器是 Alibaba Cloud Linux 3，系统 Python 3.6.8；80/443 由现有 Caddy Docker 容器占用，8080 是现有搜索服务。因此实际采用独立 Python 3.12 容器部署，不安装或替换系统 Python。

- 实际服务地址：https://47.77.182.216.sslip.io/gateway
- 新容器：zhiyun-gateway；只加入已有 deploy_internal 内网，未映射公网端口；内部监听 8081。
- 代码：/opt/zhiyun-gateway/backend/server.py
- 供应商凭证环境文件：/opt/zhiyun-gateway/gateway.env（root 0600）
- 持久化数据库：/opt/zhiyun-gateway/data/gateway.sqlite3
- 初始账号：本机 backend/.bootstrap-account.json（Git 忽略）；服务器 /opt/zhiyun-gateway/data/bootstrap-account.json（0600）。此文件是账号凭证，不要提交或公开。
- 原 Caddy 配置已备份：/opt/sleepypaw/deploy/Caddyfile.before-zhiyun-gateway-20261008。
- 新增 handle_path /gateway/* 转发到 zhiyun-gateway:8081，其余路由仍转发到原 api:9000。已通过 Caddy validate 后执行平滑 reload。
- 容器采用非 root 用户 10001、只读系统、独立可写数据卷、160MB 内存及 0.5 CPU 限制，自动重启。
- Caddy 的当前内网地址 10.255.1.4 配置为 TRUSTED_PROXY_IPS。若现有 Caddy 容器重建后 IP 变化，需同步该值并重建 gateway 容器。

compose.server.yml 可放在 /opt/zhiyun-gateway/compose.yml；文件中的网络名、挂载路径已对应实际环境。当前初次部署通过等价 docker run 完成，切换为 Compose 管理时先确认并停止旧容器，避免同名冲突。

已验证公网 HTTPS /gateway/health、真实账号登录、额度查询、退出，以及容器重启后的账号持久化。服务器 Python 3.12 容器上的 9 项初始后端测试全部通过；本次翻译兼容修复后的 10 项本地后端测试全部通过。初始额度为每月 1000 次请求、3600 秒语音。供应商 Key 已从本机 backend/.env 上传至 root 0600 的服务器环境文件，并重建容器生效。已完成真实翻译、AI 模型、语音识别及用量验证。后续更换 Key 仍需重建此独立容器；不能只 docker restart，因为环境变量在创建容器时读取。

客户端当前已固定此实际服务地址，并添加对应 @connect。gateway.config.json 保证后续普通构建继续使用此地址。支持 HTTPS 根地址或固定 /gateway 前缀；路径代理只去掉该前缀，接口自身仍是 /v1/...。

当前已完成真实供应商调用验证，尚未完成 Chrome Manifest V3 打包。API 域名沿用服务器现有 sslip.io 站点；后续有自己的 API 域名后可通过 GATEWAY_ORIGIN 重新构建。

## 真实供应商验证（2026-10-08）

- Ark 与语音凭证已安全部署，凭证值未进入日志或 Git。
- 英译中：The computer stores data in memory. → 计算机将数据存储在内存中。
- 中译英：你好，世界。 → Hello, world.
- AI 讲解模型：成功返回“连接成功”。
- 语音：本机合成的 1.79 秒英文 WAV 成功识别为 Hello World.，分句时间为 200–840ms。
- 已验证官方 usage Token 及音频秒数进入账号账本。测试使用初始账号，正常计入其额度；最初一次被官方拒绝的翻译参数请求仍按保守规则记录为待核对，不将其假设为已确认零费用。
- 修复专用翻译模型不接受 store:false 的兼容问题；普通 AI 模型继续显式关闭 store。新增回归测试，10 项后端测试通过。


## 0.19.1 已部署改动（2026-10-09）

`POST /v1/ark/responses` 接受 `stream:true`，通过 SSE 返回 `response.output_text.delta` 和 `response.completed`；完成事件携带实际 usage。断线或失败保留预占并标记待核对。反向代理应关闭缓冲并允许 120 秒读超时；Nginx 示例已更新，Caddy 会识别 `text/event-stream`。

仅 `zhiyun-subtitles` 的 speech submit/query 允许游客请求。游客通过服务端 IP 摘要隔离任务，不创建可登录账号；每 IP 默认每 UTC 月 120 次提交／1440 秒音频，15 分钟最多 6 次提交，查询另按分钟限流。`GUEST_SPEECH_REQUESTS` 与 `GUEST_SPEECH_SECONDS` 可调整月上限。游客不能调用模型、账号或管理员接口，供应商凭证仍只在服务器。

已沿用此前授权的密码连接方式，将候选版本上传至隔离目录；Python 3.12 容器中的 16 项回归测试通过后，备份旧代码并通过 SQLite backup 保存一致的数据库副本，再原子替换代码并重启独立 zhiyun-gateway 容器。数据卷与供应商环境配置保留。公网健康检查、游客语音、真实截图 SSE 和公开安装包核对均已通过。代码回滚副本位于 backend/.rollback-0191-20261009-*，数据库备份为 data/backups/gateway-before-0191-20261009.sqlite3。

安装脚本与更新元数据分别位于 `/gateway/install.user.js` 和 `/gateway/install.meta.js`。`node build-userscript.cjs` 自动生成 backend 下的两个安装文件；这些生成文件不进入 Git，主仓库发布脚本仍保留原 GitHub 更新地址。

## 0.19.2 已部署修复（2026-10-10）

旧客户端的 Seed 2 请求也补充 minimal 思考等级。安装版本已提升到 0.19.2；安装元数据与脚本一致。中键在原位置拖框，直接发送选区；连续截图须显式开启，首次浏览器授权仍必需，本页复用共享流并可停止。流式完成即返回，首段正文 45 秒无响应时停止并提示。部署保留独立 .rollback-0192-* 副本，没有迁移或重置数据库。

## 0.19.3 增量回复（2026-10-10）

新增 POST `/v1/learning/jobs/create`、`poll`、`cancel`。create 立即返回 202 和不可预测的任务 ID，后台仅调用一次模型 SSE；poll 返回目前文字、状态及最终 response，cancel 停止后续读取并在下次上游事件中停止任务。不会自动重复付费请求；上游阻塞时取消可能等到下一事件或超时才释放。

每次请求均校验登录和 APP，任务只属于创建账号与 APP；poll 限流独立于普通接口，不计模型额度。最多 8 个后台工作线程、128 个缓存任务、每用户 2 个在途任务、文本最多 200000 字符。完成任务有效期 5 分钟，后续请求清理过期内存；服务重启清空。数据库仍仅记录调用与用量，不写入问答或截图。用户脚本采用此通道来兼容 GM 流失效，直接 SSE 端点保留给其他客户端。

## 0.19.4 搜索能力与普通对话

登录及 /v1/me 返回 capabilities.web_search。未开放搜索时，已知 web_search 工具从上游请求中移除，仍执行一次普通模型请求，并在流增量与完整结果中保留同一提示；未知工具仍拒绝。旧客户端无需更新即可使用这项后端修复。新版设置根据能力禁用未开通的搜索。安装包、元数据及运行后端已部署，保留 .rollback-0194-* 副本，没有修改数据库。


## 0.20.19 手动账号与首次引导（已随 0.20.20 上线）

后台仍为 `/gateway/admin`，沿用现有管理员账号。创建账号时填写用户名、邮箱和至少 12 字符的密码，可生成随机密码；复制后单独发给测试用户。密码只保存 PBKDF2 摘要，不出现在管理记录里。

点击用户行的“调整”即可设置每月总调用次数、每月语音秒数、AI 问答/PPT/截图、字幕翻译、语音智能校准三个功能开关、应用启用和有效期。时间输入与显示按北京时间。留空有效期表示长期。额度统计月份按 UTC；调用次数含模型和语音提交，共享总调用额度。追加次数需增加总额，不会重置历史用量；待核对的上游请求仍占用额度。字幕原文、本地手动同步和缓存不扣服务器额度。既有游客语音试用额度保留；功能权限约束已登录账号的付费调用，不代替游客试用政策。

语义问答模型本身可以回答翻译问题，因此“字幕翻译”开关控制专用字幕翻译模型，不能禁止有 AI 问答权限的用户用普通对话提问翻译。术语增强翻译调用通用问答模型，需要 AI 问答权限。服务器按模型和接口检查授权，不信任用户提交的提示词来决定权限。

“账号状态与密码”可停用、恢复或重置所选账号。停用与重置撤销已有会话，恢复不复活旧会话。管理记录显示最近 100 次操作与权限/额度修改。普通用户只能查看自己的用量和活动；不能管理其他账号。不能停用或限制自己的管理账号有效期，不能停用最后一个可用管理员。

`GET /v1/me` 增加 permissions（learning / translation / speech / expires）；`POST /v1/admin/accounts` 接受 user_id、action（enable / disable / reset_password），重置时同时提供 password。用户与额度接口新增布尔权限字段和 Unix 秒 expires；旧额度调用未传权限时保留原开关。

数据库启动时自动增加字段，保留用户、密码、会话和历史用量。部署前必须备份代码和 SQLite 数据库；旧服务源码中 `INSERT ... grants VALUES` 必须兼容新增列，不能在迁移后直接回滚到旧版本。

课堂首次展示三页口语引导：“麦太炸？听不清？字幕不匹配？”、“课程太难？外语听不懂？”、“视频很卡？先缓存一下！”。提供按钮位置示意、上一步、跳过和登录入口；仅在最后一页显示登录入口及测试账号申请方式；默认不勾选“下次不提醒”，仅在用户勾选并关闭后才停止自动展示，可在账号页“使用引导”重新打开并取消勾选恢复提醒。旧版自动记录的关闭状态不会阻止新版引导展示。不要求学校账号退出或修改设置。

验证：`npm run test:gateway`；`npm run test:gateway:ui`；`npm test`；`npm run test:release`。

## 0.20.20 原生扩展发布

已备份后端、环境配置与 SQLite 数据库，再部署全部账号后台、安装脚本及元数据。公网文件逐字节校验通过，回执为 acceptance-0.20.20.json。`ALLOW_EXTENSION_ORIGINS=1` 允许合法 Chromium 扩展来源，AI 仍校验用户及功能授权。公开隐私说明 `/gateway/privacy`，扩展 ZIP `/gateway/extension.zip`。商店尚未上传：当前浏览器工具出现 sandbox setup refresh 启动错误；本机已生成商店资料、截图及审核账号，不把服务器发布视为商店提交。


## 0.20.50 翻译限流诊断（本地准备，尚未部署）

429 响应保留 `error` 文本并增加 `error_code` 与 `request_id`：月额度为 `quota_exhausted`，在途名额为 `concurrency_limit`，频率为 `rate_limit`。后两者附带 `Retry-After` 秒数；所有响应提供 `X-Request-Id`。拒绝时向服务日志输出 JSON：接口类别、状态、错误码、耗时和请求编号；不输出账号、IP、Authorization、提示词或媒体内容。记录不会回填历史缺失的 429，也不会更改额度或供应商计费。

0.20.50 扩展兼容未升级后端，按旧的明确中文原因区分限流；只对确定未受理的繁忙请求有限重试，结果不明不自动重发。单页面翻译串行，停止后保留已提交请求的本地名额直至返回。105 秒客户端等待覆盖当前常见的 75 秒上游超时，不能保证上游永不超时。后端代码尚未发布；如另行部署，须按现有流程备份代码及数据库并核验。


## 公开产品首页与知识卡扫码入口（0.20.60，2026-10-20，仅本地交付）

- `npm run build:site` 独立生成 `backend/download.html`、`backend/landing`，以及可直接双击 `index.html` 的 `dist/public-page-0.20.60.zip`；扩展构建也会同步生成。无需为了修改介绍页重新打完整客户端。
- 编辑 `download.template.html` 改文案 / 排版，`download.css` 改样式，`public-page.json` 配置商店链接。Chrome 已填入用户链接；Edge 留空时为“即将上线 · 审核中”的禁用按钮，审核完成填入完整商店地址后重建。
- 六图源文件为仓库 `ads/v2/image-XX-1280x800.png`；使用 `assets/onboarding/image-XX.webp` 的完整等比副本，按 02 / 01 / 03 / 04 / 05 / 06 顺序展示，不裁切。客户端欢迎弹窗的青蛙图集与本页六图独立维护。
- 公开路由包含 `/`、`/index.html`、`/download`、`/download/`、`/download.html`、`/download.css` 和七个固定图片路径，查询参数也兼容。既有 Caddy 会移除 `/gateway` 前缀，因此产品首页为 `/gateway/`，知识卡二维码继续指向 `/gateway/download`；两者相同。不会更改域名根路径上其他服务。
- 只允许上述明确静态文件，浏览无需登录、不会请求模型或创建会话；`/v1/me` 等 API 继续鉴权。页面无第三方脚本，遵守既有 CSP。底部明确部分 AI 功能仍需账号权限；手机可浏览并将网址发到电脑安装。

本地服务预览：`python -m backend.public_preview --port 5367`，打开 `http://127.0.0.1:5367/gateway/`；结束时 Ctrl+C。离线 ZIP 无需此命令。

后续发布：从仓库根目录执行 `python backend/publish_public_page.py`，仅在终端通过不回显提示输入服务器 SSH 密码，不在聊天、参数或文件记录密码。发布器读取实际线上 server.py，只补公开静态路由和 MIME，不上传本地尚未发布的账号 / 套餐改动；备份旧文件、校验候选哈希、原子替换后重启并匿名核验全部路由、图片与查询地址，失败恢复旧文件。成功才生成 `public-page-acceptance-版本.json`。`--include-client` 才额外上传完整脚本、更新元数据和完整扩展 ZIP；旧 `publish_card_release.py` 兼容入口启用此选项。全后端发布器也已包含新的静态资源依赖，本轮不执行全后端部署。

**实际状态**：用户再次明确选择先交付本地页面，稍后上线。本轮未上传；2026-10-20 只读核验公网页面 `/gateway/`、`/gateway/download` 仍 HTTP 401，健康接口 HTTP 200；现有 SSH 密钥被拒绝。不将本地页面匿名测试成功称为公网问题已经解决。

验证：`node download-page-ui.test.cjs`；`python -m unittest backend.test_server backend.test_accounts -q`（34 项通过）；解压页面的 file:// 六图、CSS 与 390px 布局已实际验证。

## 0.20.56 账号套餐与开通操作（2026-10-19，仅本地完成，未部署）

公网后台仍为 `https://47.77.182.216.sslip.io/gateway/admin`。本次只读确认 HTTP 200，原有登录和创建用户功能存在；线上尚无新版套餐选择。请使用原有管理员账号登录，不要将管理员密码发给普通用户。

新版部署后的操作：

1. 管理员登录 → “用户与额度” → “创建用户账号”。填写用户名、邮箱和至少 12 字符的密码，也可生成随机密码。
2. 选择免费、PRO 或 Ultra。免费为默认值，不开放付费功能；应用启用保持勾选，以便正常登录。
3. 为 PRO / Ultra 填入约定的月调用次数、月语音秒数和有效期（北京时间，留空长期）。两档功能一致，只调整约定额度，不自动设置价格或收款。
4. 创建后将用户名 / 邮箱和密码单独交付用户。已有账号在用户行点击“调整”，更改套餐 / 额度并保存；不会清空已计费次数，追加额度须增加月总量。

数据库为 grants 新增 plan 字段。旧行默认 legacy 保留原权限和用量，不能据此宣称用户实际付款；管理员核对后改成 free / pro / ultra。新建管理 API 默认 free，PRO / Ultra 自动归一 learning / translation / speech 权限，免费即使传正额度与全开标记也无法使用付费接口。`GET /v1/me` 和登录返回 membership（plan / active / state / expires）及 permissions（learning / translation / speech / learning_records / card_export / expires）。state=paid 表示人工授予的有效套餐权限，不代表有支付订单或支付回调。

套餐到期不撤销登录资格，返回失效套餐及关闭的高级权限；模型、语音及问答创建返回 payment_required。学习记录与知识卡仍在本机，未来为所有登录账号提供记录保存未在本次实施。`GET /v1/history` 仍是接口计量 / 活动记录，不是问答内容云备份。

CLI 可显式传 `--plan free|pro|ultra`；未传保留旧的人工授权兼容行为。部署前应备份 SQLite 和服务代码，迁移后不得回滚到使用旧 INSERT 列数的源码。本轮未部署新后台、未迁移线上数据库、未更改真实账号或额度。

## 0.20.58 独立免费体验（2026-10-20，仅本地完成）

新管理端“创建用户账号”与“调整”增加 **免费体验（trial）**。按人创建独立用户名 / 邮箱和密码，选择体验套餐，填写月调用总量、月语音秒数及有效期；应用保持启用。高级权限与 PRO / Ultra 一致，差别是额度与有效期；不会根据“免费体验”自动赠送固定天数或次数，不包含公开自助注册、支付或自动充值。CLI 支持 `--plan trial`。

用户与 APP 的额度分别计量，trial 同样按现有 **UTC 月份**重置，不是一次性累计体验总额。追加额度是增加本月总量，不清空已用次数。若产品改为“整个体验期只送 N 次”，需另行实现体验总账本。每个模型调用或语音提交扣一次调用；语音查询不重复扣，音频秒数只统计实际识别音频，不是观看课程时长。

登录和 `/v1/me` 返回 `membership.state=trial`、可选 Unix 秒 `expires` 与 `server_time`；有效资格有同组高级权限，到期仍能登录、使用基础功能，但关闭高级授权。trial 不标为实际付款；旧 legacy 数据仍保留原权限。前端使用服务端时间校正，按北京时间显示准确截止日；未设置截止日显示“未设置到期时间”。AI 角落显示剩余期限与本月调用剩余次数，点击进入账号页。提交后自动刷新额度，节流至少 5 秒；卸载界面清除定时器和监听。

验证覆盖两名独立体验用户的额度隔离、用尽拒绝、到期保留登录，以及管理表单的 free → trial → PRO → Ultra → legacy。UI 使用模拟上游，未消耗真实模型额度。完整结果与固定包哈希见 `dist/account-ui-0.20.58-verification.json`。

**实际状态**：此套新管理表单、trial 识别及套餐字段仅本地完成；未部署服务端，未创建 / 调整线上真实账号。需要按照既有流程备份代码和 SQLite、部署新服务与管理静态文件后，才能在公网管理页按上述方式发放体验。既有公网管理入口不代表新版已上线。学习问答记录仍存用户本机，不是云端备份。

## 介绍页设计修订 0.20.60-r2（2026-10-20，本地）

`public-page.json` 新增独立 `pageVersion`：网页可独立修订，不改扩展版本。`build:site` 与 `publish_public_page.py` 均以此核对页面；带 `--include-client` 时仍按 package.json 校验完整客户端版本。页面首屏 / 页尾各有 Chrome 和 Edge 商店徽章，两个位置共用构建函数和配置，不维护重复链接；Edge 留空时均显示审核中。

布局改为章节式宽幅排版，六图完整保留；同步 / 同屏两张图拆开，减少卡片样式。生成 dist/public-page-0.20.60-r2.zip，解压双击 index.html。匿名路由与鉴权专项、浏览器和离线页面在手机 / 平板 / 桌面尺寸均检查通过。仍按用户选择只交付本地，本轮没有上传或再次探测公网。

## 0.20.66 网页学习空间与邮箱注册（2026-10-20，仅本地后端）

新增用户主动保存的文字问答与邮箱验证码注册，合同与部署注意见 [STUDY-API.md](STUDY-API.md)。免费及到期账号可在网页读取自己的已保存记录，不扣 AI 次数；插件生成回答、翻译、语音及原有本机 AI 功能仍按既有套餐授权。截图不随本次保存上传，旧本机记录不自动上传；不提供公开分享。

SMTP 尚未配置时，发码明确返回 503，不创建验证码或假报成功；注册成功默认为 free、零 AI 额度。仅保存用户主动提交的问答文字，隐私说明已同步。管理后台视觉已统一暖白橙红并适配手机，既有 ID、权限和管理行为保留。

本轮未替换现有服务器后端、未迁移线上数据库、未调整真实账号或额度。Sites 新前端源码在独立 sites/zhiyun-study 内，部署状态见根 README；该前端上线不等于此新后端上线。正式开放注册前还要按接口文档处理可信代理限流和发信服务配置。

## 0.20.67 人工账号运营（2026-10-21，本地后端待部署）

无需配置邮箱验证码即可由管理员手动创建账号，用户名与初始密码单独交付。运营统计、模型费用估算、当月人工增额及申请 / 充值渠道配置见 [OPERATIONS.md](OPERATIONS.md)。后台新增运营一览，保留既有用户管理和普通用户边界。未配置费率显示未知，不伪报实际账单；人工收款与供应商成本分开，追加额度防重复且不自动改变套餐。

Sites 介绍和账号办理页已公开发布；当前未配置渠道，显示暂未开放。本后端与新版管理静态文件尚未部署，公网旧管理页不会自动获得新功能。未来部署清单已补 study_api.py / operations_api.py；仍须执行既有备份、数据库验证和公网核对流程，不能只上传server.py。未读取或修改真实账号、额度、邮件或付款信息。
