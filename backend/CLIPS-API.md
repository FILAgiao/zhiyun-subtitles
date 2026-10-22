# 随意摘图片收藏接口（0.20.79，本地实现）

独立于现有文字 `/v1/study/conversations`，不改变文字接口的严格白名单，不自动上传 AI 附图或历史。使用当前 Bearer 账号与 X-App-Id: zhiyun-subtitles；客户端不得提交 user / owner 字段。免费和到期账号也能操作自己的收藏；停用用户仍由既有认证拒绝。

| 请求 | 行为 |
| --- | --- |
| POST /v1/study/clips | 主动新建/覆盖稳定 id 的截图收藏，返回 ok/id；不会调用模型 |
| GET /v1/study/clips?limit=50&offset=0 | 当前用户缩略图与元数据，next_offset、usedBytes、maxBytes，不读取原图字段 |
| GET /v1/study/clip-image?id=ID | 鉴权读取单张 PNG data URL；无公开图片 URL |
| DELETE /v1/study/clips?id=ID | 只删除当前用户记录及图片、缩略图；不改本机历史 |

POST 字段：id（1–100 位字母数字/下划线/短横线）、title（200）、course（200）、courseKey（200）、origin（2000）、note（4000）、position（100）、image、thumbnail。课程身份由客户端课程标识摘要分组（安全上下文用 SHA256，普通 HTTP 用本地确定性摘要），不把该标识用于账号鉴权。origin 仅 HTTP(S)，删除查询、片段及带用户名密码的地址。

当前只接受完整的非交错 8bit RGBA canvas PNG：校验签名、块边界、CRC、IHDR、IDAT 解压大小/结束和行过滤类型，不接受 SVG、外部图片地址或不完整图片。原图最长边1600，编码后≤1,500,000字节；缩略图最长边320，≤80,000字节。客户端先缩小/再检查大小，不保证原文件分辨率。每用户/APP最多500张、图片和缩略图合计64MiB；事务中核算，覆盖时扣除旧图，重试同ID不新增一条。

migrate_study 自动调用 migrate_clips，新表 study_clips 存储元数据与 BLOB，按用户/APP/ID主键隔离。数据随数据库备份。在线删除后已有备份按实际备份策略保留；不能声称删除了历史备份。

网页 `/gateway/study#clips` 复用 portal.js 会话。列表有搜索/课程/日期筛选；点图进入阅读器，左右换课程、上下换图片，仅图片区处理滚轮/触控；可关闭双向切换，保留按钮/键盘。长笔记单独滚动，图片可放大。阅读位置存在当前设备 sessionStorage；不承诺账号跨设备同步阅读位置。退出立即清空图像和列表，迟到响应按账号与请求代数丢弃。

截图预览四入口：圈画（展开画笔/圈选/撤销/清除）、继续上次对话、圈画新对话、收藏。对话入口只附图，点击发送才请求模型。收藏可添加标题/笔记；失败保留预览，支持同ID手动重试与下载；关闭或刷新后不保证恢复失败图片。批注为合成像素，不是可跨设备继续编辑的矢量笔画。

本地验收：python -m unittest backend.test_clips -q；node clips-ui.test.cjs。完整同源预览：python -m backend.public_preview --demo --port 8765；示例账号 preview@example.test / local-preview-only-2026（仅本机临时数据）。测试不连接模型、邮件或支付服务。

部署必须同批包含 clips_api.py、study_api.py、server.py、public_page.py、study.html、clips.js、clips.css，以及完整新扩展。deploy_release.py 已补充编译检查、备份与公网文件校验；不要只发布前端。当前尚未部署，旧服务器会返回未开放提示，可先下载截图。
