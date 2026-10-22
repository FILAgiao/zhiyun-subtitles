> 0.20.79 新增独立 [随意摘图片接口](CLIPS-API.md)，不放宽下述文字接口。图片、批注、缩略图和删除策略已有本地实现，尚未部署；下文图片“留待后续”属于 2026-10-20 的历史范围。

# 邮箱注册与个人问答网页接口

2026-10-20：本地实现，未部署。模块为 `study_api.py`，现有登录、套餐和模型调用继续使用原接口；注册不自动开通体验，也不发放模型额度。

## 接线

- 导入 `StudyMixin, migrate_study`，将 `StudyMixin` 加入 `Gateway` 继承列表；现有迁移之后调用 `migrate_study(db)`。迁移只新增验证码和个人问答表，不改变旧账号、额度和调用记录。
- 在 Bearer 鉴权之前调用 `study_public(method,path,headers,body,ip)`，返回值非 `None` 时直接返回该响应。
- 在现有 `auth` 和用户节流之后调用 `study_private(method,path,headers,body,user,app)`，返回值非 `None` 时直接返回。调用方负责认证；模块只使用认证结果中的 `user.id`，拒绝客户端额外提供用户归属字段。
- HTTP Handler 增加 `do_DELETE=dispatch`、CORS 允许 `DELETE`；写请求仍接受 JSON。无需增加第三方 Python 依赖。
- API 路径使用 `/v1/...`，公网原有反向代理可保留 `/gateway` 前缀。网页同源部署最简单；若放在另一个站点，需要显式配置已有 `ALLOWED_ORIGINS`，不能用通配符。

## 能力检测

匿名 `GET /v1/study/capabilities` 返回 `{enabled:true,registration:true,mail_configured:boolean}`。现有健康检查、登录与 `/v1/me` 的 `capabilities` 同时增加 `study_sync:true`、`email_registration:true`、`mail_configured`。布尔值只表明配置格式就绪，不代表已经发送成功，不包含 SMTP 主机、账号或凭据。未部署这些接口的旧后端返回 404，客户端应显示未开放并停止同步重试。

## 部署前：Sites 代理与 IP 限流

当前 Sites 网站通过 Worker 代理访问既有 Gateway，Gateway 看到的是 Worker 出口 IP，因此网页登录和注册的 IP 限流会由经过同一出口的访客共享。现有代理不转发未经验证的 `X-Forwarded-For`，后端也未新增对任意原始 IP 头的信任；不能仅为消除共享限流而直接信任这些请求头或 Cloudflare 的整个地址段。

正式开放邮件注册前，应选择以下一种部署方式：由 Worker 从平台保证可信的连接信息获取访客 IP，使用双方服务端私有密钥签名，并由 Gateway 验证签名、时效及 IP 格式后采用；或者在可信边缘实施按真实连接 IP 的限流；也可以将网页与既有后端同源部署，直接使用现有反向代理的 IP 处理。若无法证明 Sites 链路中的 IP 信息由可信入口覆写，就不能据普通请求头恢复访客 IP。邮箱与账号维度的后端节流仍应保留。

上述代理签名或边缘配置尚未实施、未经部署验证；当前不能宣称已解决 Worker 出口共享限流。旧扩展客户端和直连请求继续现有可信代理 / `X-Real-IP` 规则，不要求它们携带新代理头。此注意不改变当前 API，也不代表后端、邮件服务或网站已上线。

## 邮箱注册

请求带 `X-App-Id: zhiyun-subtitles`；省略时仍固定注册到该应用，其他应用名拒绝。

| 方法与路径 | 请求 | 返回 |
| --- | --- | --- |
| `POST /v1/auth/register-code` | `{email}` | `{ok,message,expires_in:600,retry_after:60}` |
| `POST /v1/auth/register` | `{email,code,password,username?}` | `{ok:true,next:"login",message}` |

验证码是六位数字，有效期十分钟。数据库只保存随机盐与 PBKDF2 校验值；同一邮箱六十秒内不得重发，每邮箱每小时最多三次、每 IP 每小时最多六次。校验每邮箱十五分钟最多十次、每 IP 十五分钟最多二十次；同一验证码累计五次失败后作废。成功校验、消费验证码和新建账号在同一个 SQLite 写事务中，防止并发重复使用。验证码和邮件内容不会进入日志。

新账号固定 `is_admin=0`、`plan=free`，请求和音频额度均为零，高级 AI / 翻译 / 语音权限关闭。密码沿用现有 PBKDF2 方案，长度为 12–256 字符。邮箱统一小写。昵称可选；同名昵称自动加后缀，登录使用邮箱始终有效。相同邮箱已存在时，接口保持相同通用响应，不改密码、不改套餐、不发放额度，随后进入现有邮箱密码登录流程。

### 稍后配置发信服务

| 环境变量 | 用途 |
| --- | --- |
| `SMTP_HOST` | 服务商的 SMTP 主机 |
| `SMTP_PORT` | SMTP 端口；SSL 默认 465，STARTTLS 默认 587 |
| `SMTP_FROM` | 已验证的发件邮箱，填写纯邮箱地址 |
| `SMTP_USERNAME` | SMTP 登录用户名；可与发件邮箱不同 |
| `SMTP_PASSWORD` | 服务商发放的 SMTP 授权码或凭据 |
| `SMTP_TLS` | `starttls`（默认）或 `ssl`，不支持明文传输 |

只在服务端环境配置凭据，前端与扩展均不接触这些变量。服务商可能还要求在域名 DNS 设置 SPF / DKIM 等发信验证，按选定服务商控制台操作。当前没有发信账号与域名配置，不声称已能收到真实邮件。

发信未配置时返回 `503 email_not_configured`，且不创建验证码；实际发送失败返回 `503 email_unavailable`，删除相应验证码。测试通过注入 `gateway.study_mailer(recipient, code)` 内存函数验证流程，不会发送邮件，也不提供“测试验证码”公网接口。

## 私有文字问答

所有请求使用现有 `Authorization: Bearer ...` 和应用标识。免费、体验到期与付费用户都可读取、更新或删除自己的记录；停用账号仍由现有 `auth` 拒绝。读取保存记录不扣 AI 额度，也不调用模型。此模块不修改旧插件的付费门禁，插件接入需要单独处理保存入口。

| 方法与路径 | 行为与返回 |
| --- | --- |
| `GET /v1/study/conversations?limit=50&offset=0` | 返回 `{items,next_offset}`；摘要不包含历史全文 |
| `GET /v1/study/conversations?id=记录ID` | 返回 `{conversation}`，包含 `history` |
| `POST /v1/study/conversations` | 新建或更新同一用户记录，返回 `{ok,conversation}` |
| `DELETE /v1/study/conversations?id=记录ID` | 仅删除当前用户记录，返回 `{ok:true}` |

POST 采用扁平字段：`{id,title,course,source,origin,history:[{role:"user",text:"问题"},{role:"assistant",text:"回答"}]}`。`id` 为客户端稳定生成的 1–100 位字母、数字、下划线或短横线；允许同一用户更新原对话。不同用户可以拥有相同的记录 ID，详情、列表、删除都以服务端认证用户和应用共同限定。客户端不能指定另一个 `user`、管理员字段或其他归属。

每人最多 500 条；分页最多 50 条；每条最多 100 条消息、单消息最多 50000 字符、整条 JSON 最多 200000 字节。标题最多 200 字符、课程 200、类型 40、来源 2000。`created` / `updated` 为服务端毫秒时间；摘要还有 `questionCount`。创建时间在更新后保留，排序按更新时间降序。

仅接受 `user` / `assistant` 的 `role,text` 字段；明确拒绝图片字段、Base64 data URL、Cookie / Authorization 等凭据头以及额外结构字段。来源若为 HTTP(S) 地址则去掉查询参数和片段，不保存 URL 内用户名密码。普通课程编号也可以作为来源。前端必须以文字节点或安全渲染器显示内容，不能把问答直接写入 `innerHTML`。此版本不上传截图、学校登录态、完整浏览上下文、API Key，不做公开分享或公开问答列表。

记录保存在当前后端 SQLite 数据库，随现有数据库备份一起备份。只应在用户主动选择“保存到学习空间”后同步已有本地问答，不能把浏览器的历史记录静默全部上传。删除记录不影响本地副本；用户页面要说明同步范围。图片存储、PPT 卡片、收藏标签、搜索全文和导出留待后续。

## 验证

运行 `python -m unittest backend.test_study -v`。测试使用临时 SQLite、动态生成密码和内存邮件函数，覆盖：未配置发信、发送失败、哈希/到期/五次失败/重发节流、注册免费零额度、已有邮箱不变更、并发单次消费，以及按用户/应用隔离、文本限制、分页、上限、更新和删除。测试不读取真实账号配置、不发送邮件、不调用模型。
