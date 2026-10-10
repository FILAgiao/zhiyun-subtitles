# 最小统一 API 后端

Python 3.11+ 标准库 + SQLite，无额外 pip 依赖。服务器统一保存豆包凭证，浏览器只拿可退出、七天过期的用户会话。一个账号可开通多个 APP，APP 权限和额度分别设置。本版包含人工创建账号、登录、退出、额度查询、模型代理、语音提交和查询；不包含公众注册、找回密码、充值支付。

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

Nginx 必须覆盖 X-Real-IP，后端只信任回环代理传来的地址，用于登录限流；别把任意客户端传入的 IP 直接当作可信来源。服务最多 32 个处理线程，账号限流 90 次/分钟，最多两个进行中的付费调用；登录按 IP 和邮箱分别限流 10 次/15 分钟。允许的 Origin 在服务端配置，无 Origin 的油猴/移动端 AI 请求仍必须认证；本 APP 的游客语音例外按 IP 限流及限制额度。

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
