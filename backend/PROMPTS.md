# 云端讲解提示词（0.20.64）

本地已实现，未部署线上。适用于完整 Chrome / Edge 扩展及共用油猴测试界面。所有请求使用现有 `X-App-Id` 与 `Authorization: Bearer <会话>`；HTTP 前缀沿用 `/gateway`，接口协议仍为 `/v1`。免费登录账号也可管理提示词，模型调用仍受原套餐与额度限制。接口使用 JSON、`Cache-Control: no-store`，不调用模型、不扣模型额度。

| 请求 | 用途 |
| --- | --- |
| GET /v1/prompts | 已启用官方 + 当前账号的个人提示词 |
| POST /v1/prompts/save | 新增 / 编辑当前账号的个人提示词 |
| POST /v1/prompts/delete | 删除当前账号的个人提示词 |
| GET /v1/admin/prompts | 管理员列出官方提示词（含停用项） |
| POST /v1/admin/prompts/save | 管理员新增 / 编辑 / 启停官方提示词 |
| POST /v1/admin/prompts/delete | 管理员删除官方提示词 |

新增示例：

```json
{"label":"我的讲解方式","prompt":"先讲一个笑话，再把每个角色还原为真实概念。","revision":0}
```

返回 `{ "ok": true, "id": "user-...", "revision": 1 }`。列表中的每条记录含 `id`、`label`、`prompt`、`scope`（official / personal）、`revision`、`enabled`、`updated`（Unix 秒）。编辑请求包含现有 `id` 与读取时的 `revision`；删除仅需这两项。官方保存额外接受布尔 `enabled`。新建可省略 ID 由服务端生成；个人预设仅接受 `user-` 前缀，官方禁止该前缀，客户端不能指定其他账号归属。APP 取自已鉴权请求，账号由会话确定。

名称 1–50 字，正文 1–1800 字，个人每账号 / APP 最多 30 条，官方每 APP 最多 100 条。超过限制返回 400；未登录 401；无 APP 或管理员权限 403；修订冲突 409，用户需刷新并保留待保存内容后再编辑。返回新 revision，防止设备间静默覆盖。停用官方项在下次拉取时从用户列表消失，选择无效时回到费曼或剩余首项；列表为空时使用简明默认讲解。

## 数据与界面

SQLite `prompt_templates` 的主键为 `(app, owner, id)`，owner=0 表示官方，其他值取当前用户 ID。查询 / 写入均同时约束 APP 和归属。管理员的官方页面与审计不展示个人正文；官方审计只保存 ID 和操作。新表不修改旧账号、用量或会话结构，旧客户端可继续使用 `/v1`。health/login/me 能力增加 `prompt_catalog: true`。

登录与已登录打开页面会拉取列表，回到页面、每五分钟（页面可见时）及“刷新云端提示词”再次获取。个人正文只在运行时内存保存，不新写浏览器持久存储；默认项与顺序仍是本机偏好。退出 / 切号即清空列表及编辑框，旧请求不能恢复上一账号数据。网络失败显示错误与刷新入口，不伪报保存成功；读取失败时不会用旧本地个人内容冒充云端数据。首次无法读取提示词时，问答提示重试，不发出模型请求；新扩展需配套后端。

旧本地提示词保留至用户点击“将旧本地提示词导入当前账号云端”，不自动上传。采用原 ID 防止部分成功重试时重复创建；若同 ID 已有不同云端内容则停止并提示，不覆盖。全部成功后清除旧副本，期间失败保留本地内容用于重试。导入前可在账号入口确认当前登录账号。

## 官方内容维护与部署

初始库来自 `official-prompts.json`：费曼、专业、复习、女生八卦。`prompt_catalog_seeds` 记录已应用版本，初始化仅写入一次。重启不覆盖管理员修改、不复活已删除项。**首次初始化后编辑 JSON 不会更新现有库**：打开后台“官方提示词”页发布修改，或使用管理员接口。

部署需完整上传 `server.py`、`admin_api.py`、`prompt_api.py`、`official-prompts.json`、后台 HTML / JS / CSS、隐私页，以及完整客户端 / 元数据；现有 `deploy_release.py` 清单已维护。部署前备份旧代码、环境与数据库，SQLite 使用 backup API；启动后检查 `prompt_catalog` 能力、登录列表、官方管理和私有隔离，并核对公网客户端文件与本地字节一致。本次没有执行部署或修改线上数据库。

```text
npm run test:prompts
npm run test:gateway
node extension-ui.test.cjs
```
