---
name: zhiyun-open-account
description: 用户明确要求为浙大上课爽创建普通账号或延长已有账号的会员有效期时，通过网关管理 API 单个或批量办理，并核对套餐和额度。
---

# 浙大上课爽开户与续期

网关固定为 `https://47.77.182.216.sslip.io/gateway`。所有请求都带 `X-App-Id: zhiyun-subtitles`，POST 使用 `Content-Type: application/json`。仅向该 HTTPS 网关提交凭据，遇到重定向停止。管理员账号和密码由运行环境的密钥配置注入为 `ZHIYUN_ADMIN_LOGIN`、`ZHIYUN_ADMIN_PASSWORD`。运行时读取，避免在工具命令、日志和回复中展开密码或会话令牌。缺少配置时让操作者在运行环境中配置。

用管理员凭据调用 `POST /v1/auth/login`，JSON 为 `{"email":"<管理员用户名或邮箱>","password":"<管理员密码>"}`。从响应读取 `token`，后续请求带 `Authorization: Bearer <token>`。调用 `GET /v1/me`，确认 `is_admin` 为 true 或 1，并读取 `server_time` 作为当前 Unix 秒。结束时调用 `POST /v1/auth/logout`，请求体为 `{}`，注销本次管理员会话。

## 新账号开户

从用户指令读取用户名、邮箱、套餐、约定额度和有效期。每个账号使用独立的用户名和邮箱。缺少用户名或邮箱时先补齐。未指定套餐时使用 `free`，月调用和语音秒数均为 0。若明确要求 `trial`、`pro` 或 `ultra`，按约定填写额度。未另行指定额度时，接口默认每月 1000 次调用、3600 秒语音。指定了有效期时，将北京时间换算成 Unix 秒填入 `expires`，长期有效时传 `null`。

1. 对每个明确授权的账号调用一次 `POST /v1/admin/users`。默认初始密码为 `abc12345`，用户明确给出密码时用指定值。基础免费请求示例

   ```json
   {
     "username": "student01",
     "email": "student01@example.test",
     "password": "abc12345",
     "app": "zhiyun-subtitles",
     "plan": "free",
     "request_limit": 0,
     "audio_limit": 0,
     "expires": null
   }
   ```

2. 成功回执为 HTTP 200、`ok: true` 和 `user_id`。用 `GET /v1/admin/overview` 按 ID 核对 `users[].grants` 中的套餐、月调用次数、月语音秒数、到期时间，以及账号为普通用户。遇到 409，报告账号冲突并保留原账号。遇到超时或 5xx，先用管理概览按用户名及邮箱核对，无法确认时标记结果待核对并停止重试。若 400 提示密码仍至少需要 12 位，报告短密码规则尚未生效，保留原请求等待部署。
3. 按账号报告结果、套餐、额度及到期时间。初始密码只在授权操作者的私密对话交付。实际发送给第三方须有操作者的明确指令。

## 已有账号会员续期

1. 用 `GET /v1/admin/overview` 的 `users[]` 按用户名、邮箱或用户 ID 唯一匹配，读取 `grants[]` 中 `app=zhiyun-subtitles` 的套餐、状态、基础额度及当前 `expires`。概览只返回最近 200 个账号，未找到时可用 `GET /v1/admin/operations` 的 `users[]` 继续查找，并用 `base_request_limit`、`base_audio_limit` 读取基础额度。身份有歧义时先核实。免费、长期有效、已停用、应用授权暂停或无有效会员配置的账号，报告现状并跳过。旧版 `legacy` 账号只有在概览可确认原有会员权限时续期。
2. 用户指定续期时长时，未到期从原到期时间起算，已到期从服务器当前时间起算。「续一个月」按北京时间加一个自然月，目标月没有同一日时取当月最后一天，保留时分秒。用户指定新的到期日期时按其要求计算，有日期但无时刻时采用北京时间当天 23:59:59。新到期时间必须晚于当前时间和原到期时间。缺少续期时长和新到期时间时先补齐。
3. 调用 `POST /v1/admin/grants`，传入 `user_id`、`app: "zhiyun-subtitles"`、原 `plan`、原基础 `request_limit` 和 `audio_limit`，以及新的 `expires`（Unix 秒）。从概览读取额度时使用 grant 顶层字段。运营页使用 `base_*` 字段，避免把临时增额写入基础额度。保持原有启用状态和权限。此接口会沿用省略的状态和权限字段，但会为省略的基础额度写入套餐默认值。
4. 用原查询接口再次核对新到期时间及原套餐、基础额度和状态，逐个报告用户名及续期前后的北京时间。遇到超时或 5xx，先查实际到期时间，结果未核实前停止重试。若需重试且原配置仍一致，使用首次计算好的同一个绝对到期时间，避免重复累加。
