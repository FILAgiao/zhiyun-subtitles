# 0.20.76 流式字幕同步：统一部署说明

状态：2026-10-22 仅准备代码与本地安装包，由用户统一部署；未更新公网、未提交商店。供应商 Key 不在代码、测试夹具、浏览器扩展或部署包内。

## 行为与接口

过去先录制 12 秒 WAV，提交文件后再查询结果。现在已认证账号的 `/v1/me` 或登录响应明确返回 `capabilities.speech_stream=true` 时，优先使用连续流式识别。浏览器采集课程现有视频音轨，转成 16 kHz、单声道、PCM16；首个 200ms 音频包立即发送；网络积压时将连续样本合并为最多 1 秒包以减少 RTT，再经固定 HTTPS 网关发送到后端，后端保持官方 WSS。只采课程音轨，不采麦克风。

上游地址固定为 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`，默认流式 2.0 资源 `volc.seedasr.sauc.duration`。后端使用 Python 标准库 TLS / RFC 6455，无新 pip 运行依赖。协议参考[官方双向流式识别文档](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。

客户端每次最多采集 20 秒，同一会话逐句积累证据；可靠结果一到就写入同步锚点并停止。未稳定的文字只更新单行日志，只有供应商明确的稳定句参与匹配。分句、局部检索、拼音容错和相邻真实边界共同定位；不要求整段百分百相同。仅定位到长字幕中段却没有真实时间边界时，继续听同一音轨下一句，不按字数猜时间。

旧后端没有能力标记时保留一次 20 秒录音文件兼容；不会自动再提交第二、第三段。服务端已确认创建会话或已提交音频后遇到错误，不自动追加另一笔文件识别。暂停、拖动、换课、改速、手动调偏移、账号变化会停止旧会话，迟到结果不能覆盖。加减号仍可收起当前单行日志与微调，回调不会强行展开。

网关新增五个登录接口：`POST /v1/speech/stream/create`、`push`、`poll`、`finish`、`cancel`。套餐到期阻止 create / push；本人原有会话仍可 poll / finish / cancel，身份与归属检查不变。UUID、用户和 APP 绑定；创建回执及取消 tombstone 持久化。同一序号相同 PCM 重试幂等；不重复创建付费上游。每用户一条流，全局最多 16 条；连接与网络发送不持全局注册锁，慢用户不会挡住其他用户的上传、查询和取消；真实 PCM 字节按 32000 字节/秒记额度。创建扣一次请求，poll / finish / cancel 不另扣请求；异常与取消保留已接受时长、标记 unknown，不自动退款。

## 一起部署的文件

- 后端：`server.py` 和新增 `speech_stream.py` 必须同批更新。该候选 server 同时依赖当前仓库 `admin_api.py`、`prompt_api.py`、`study_api.py`、`operations_api.py`、`public_page.py`、`official-prompts.json`；跨多个尚未上线版本统一部署时使用完整 backend 清单，不单独复制最新版 server 覆盖旧目录。
- 安装与元数据：完整 `install.user.js`、`install.meta.js`、完整 `extension.zip`。扩展后台已加入五个固定网关路径，内容脚本已内联流式模块和离线拼音字典。
- 配置：在服务器原有受限 env 文件增加 `SPEECH_STREAM_API_KEY`；保留旧 `SPEECH_API_KEY` 供文件兼容使用。空流式 Key 会回退旧 Key，但旧 Key 必须有流式资源权限才可调用。`SPEECH_STREAM_RESOURCE_ID=volc.seedasr.sauc.duration`，`SPEECH_STREAM_ENABLED=1`。真实值由你在服务器填写，不贴进仓库或浏览器。

`deploy_release.py` 的完整发布白名单及 Python 编译检查已包含新模块。本轮未执行它。Docker 改 env 后需要重新创建容器以加载新环境；仅 restart 不会重新读取 env 文件。Caddy 的 `/gateway` HTTPS 路由沿用原有配置；浏览器无需新增供应商网络权限或直接连接 WSS。

部署前备份旧代码、完整安装文件、env 和 SQLite（使用 backup API，含 WAL 一致性），保留可回滚容器。启动会创建 `speech_stream_receipts` 表，现有账号和额度表保留。发布后核对公网脚本、meta、ZIP SHA256 与构建一致，再让用户重载扩展并刷新课程页；无需点击服务器页面上的更新按钮。

## 验收与90%目标

本地测试不上传真实课堂音频。固定生成的 7.79 秒测试音频真实调用供应商一次：17 个返回事件，首文字约 1.17 秒、首稳定句约 2.34 秒，收到最终结果，已识别已知短语。此记录验证协议可用，不能推导课堂成功率。净化的真实返回在 `fixtures/speech-stream-provider.json`，测试会离线回放，不额外调用接口；真实供应商可能只给词时间而不给 utterance.start_time，已回归覆盖。

合成留出集固定 180 例：有可观测真实边界的正例 99/100 首会话成功；包括无边界中段的全部正例 99/120（82.5%）；负例误跳 0/60。无边界中段正确拒绝伪造时间。合成音频时间中位 4.82 秒、P90 9.32 秒，不含网络或 ASR 等待。**真实课堂首次成功率尚未测量，90%目标尚不能宣布达成。**

统一部署后建议固定至少 100 个此前未调参的真实课堂片段，覆盖中文、英文、术语、长句中段、背景噪声及重复句。一次会话内正确定位且偏移误差≤1.5秒计成功；所有适用样本都计入分母，超时、误跳、缺边界分别记录。达不到 90% 时用匿名失败分类复核，不把第二次/第三次任务算首次成功。

从仓库根目录复验：

```text
npm run build
npm run build:extension
npm run test:speech
npm run test:speech:benchmark
node --test extension.test.cjs extension-bridge.test.cjs
node release.test.cjs
npm run test:speech:source
npm run build:speech:release
python -m unittest backend.test_speech_stream backend.test_server backend.test_compatibility
```

健康接口的 `speech_stream=true` 代表当前配置可用，不代表已通过本次生产上游调用。发布后先核对登录、套餐、固定路径、create / push / cancel、实际秒数、取消后无新任务，再在授权测试片段上核对首稳定结果实际同步。
