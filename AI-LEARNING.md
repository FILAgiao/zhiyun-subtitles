# 浙大上课爽 · AI 讲解模块

代码在 ai-learning.js，由 build-userscript.cjs 内联进用户脚本；不使用远程加载的 AI 代码。CommonJS 导出用于独立测试，浏览器导出 globalThis.ZhiyunLearning。

## 集成

在设置 UI 创建完后调用：

~~~js
let learning = null;
// 定义及创建 shadow / 课堂 UI 后：
learning = globalThis.ZhiyunLearning.mountLearningAssistant({
  shadow,
  request: GM_xmlhttpRequest,
  getValue: GM_getValue,
  setValue: GM_setValue,
  getApiKey: () => GM_getValue('ark-api-key', ''),
  prepareSlide: async () => { /* 可选：点击讲解时展开并等待当前课件图片 */ },
  getSlide: () => slideEntries[slideIndex] ? {
    ...slideEntries[slideIndex],
    index: slideIndex,
    imageElement: $('slide-image'),
  } : null,
  getContext: () => '课程名称、播放时间及附近字幕（不要放带 token 的图片 URL）',
  getCaptureTarget: () => mainVideo,
  onOpenSettings: () => studyUI.open('ai'),
});
~~~

- 已存在的入口会自动绑定：ai-open 与 slide-explain 直接讲解当前页，ai-capture 开始框选；open() 仍可只打开对话。
- 自动向 settings-ai 容器填充模型、中键、翻页上下文、联网搜索和自定义提示词设置。
- renderSlide 完成后调用 learning?.notifySlide()。
- 切课时调用 learning?.resetCourse()，防止旧对话或在途响应混入新课。
- 必须返回 null 表示没有当前课件。getSlide 的 index 是从 0 开始的页码。
- 同一个 shadow host 跟随课堂全屏根容器，AI 面板及截图框选自然跟随；不另建 body portal。
- 全局播放快捷键应忽略 ai-learning、ai-crop 及可编辑元素。
- 如后创建入口，应显式绑定 learning.open / explainSlide / startCapture，或重建实例。

## 行为

当前 PPT 讲解、中键词语解释、选区截图、粘贴截图均复用翻译 API Key。设置提供费曼、专业、复习、自定义四种模式。图片截图在用户选择后等待发送；“讲解本页”和中键则直接发起讲解。默认使用费曼大白话，打开即可直接问，不要求先配置模式。模式可以在面板切换。知识卡仅在有回答后出现，避免空对话先展示无效按钮；翻页上下文状态仅在开启后显示。

字幕层保持 pointer-events:none。中键使用字幕文本 Range 做坐标命中，左键继续穿透至播放器。取词范围限定为课件、平台字幕、右侧字幕列表和带 data-zy-ai-text 标记的课程区域，不会在普通设置文案上触发付费请求。图片里的文字应使用框选解释。

自动翻页上下文默认关闭。打开后只在本页内记住最近两页，在下次用户提问时附上；不会因翻页发起后台模型请求。连续追问保留最近四轮文字和最近两张问题附图，切课或“新对话”会清空。

截图优先框选当前 PPT；没有 PPT 时尝试从当前视频帧取图。跨域图片先尝试 canvas，再通过 GM 请求受支持的浙大课堂图片域名读取。无权限或浏览器拒绝读图时明确提示截图后粘贴。不启用麦克风，不调用桌面共享，不后台截屏。浏览器 GET 图片读取受 userscript 的 @connect 权限约束。

## 请求与预算

- 固定官方 endpoint：https://ark.cn-beijing.volces.com/api/v3/responses
- 默认模型采用用户指定的 doubao-seed-2-1-lite-260915，可在设置修改。
- stream:false；store:false；max_output_tokens:2200。
- 输入图片为 input_image / image_url data URL；不把课件原地址及其签名参数发送给模型。
- 图像最长边 1600 px，单张编码不超过约 2.2 MB 字符。原始图片大小上限 15 MB。
- 每次最多三张图片，模块正常流程最多最近两张；历史文字最多 14000 字符，课程上下文 9000 字符，提问 4000 字符。
- Key 只进入 Authorization header；错误提示不回显服务端原始错误正文。回复使用纯文本渲染，不执行 HTML。
- 停止、切课和销毁均中断在途 GM 请求；响应序号可阻止迟到回复进入新会话。
- 联网搜索默认关闭，可在设置启用，使用 web_search / max_keyword:3。

## 验证

~~~text
node --test ai-learning.test.cjs
node ai-learning-ui.test.cjs
~~~

10 项 Node 测试已通过：请求字段、预算、模式、历史截断、响应解析、Key 隔离、错误不泄露、取消及词语提取。

Chrome 交互回归已通过：文字对话、切模式、PPT 图片、多轮图片、框选与发送、翻页无后台请求、中键课程词语、字幕中键且左键穿透、非课程文案不请求、取消、切课、无 Key、全屏和纯文本安全渲染。全部网络为 mock，未使用真实 Key，未验证账户额度和指定模型的实际开通状态。

## 核对的官方资料

- [Responses API 输入项与图像格式](https://docs.volcengine.com/docs/ark/get-response-context-api?lang=zh)：input_image、image_url 字符串及 Base64 data URL，system/user/assistant 消息角色。
- [流式输出及响应样例](https://docs.volcengine.com/docs/ark/streaming-output?lang=zh)：output 数组里的 message / output_text。当前实现选择非流式以避免半截 SSE 文本污染对话。
- [Response 生命周期与 store 状态](https://docs.volcengine.com/docs/ark/response-lifecycle?lang=zh)：completed/incomplete/failed 以及 store 字段。

后续语音方案可用独立 ASR + 当前文字讲解模型 + TTS。实时打断、边听边答则需额外接入实时语音对话服务；本次实现聚焦文字链路，不默认开通语音产品。

## 本地知识卡

AI 回复后可点击“保存知识卡”，生成 1080 × 1350 的 PNG，使用求是蓝和暖黄配色，品牌为“浙大上课爽”，标语为“网课不硬扛，浙大上课爽！”。内容为最后一条成功回答、当时的讲解模式与课程标题，自动折行并将长文截为摘要。导出前去除已知 Key、Bearer 凭证和 URL，不自动上传或发布平台。空对话及切课后禁用；欢迎词不能导出。可选 getCourseTitle 回调提供干净课程标题，未提供则取 getContext 首行。返回实例提供 saveKnowledgeCard()。知识卡的文字净化与截断有 Node 测试，Chrome download 测试验证实际 PNG 文件签名与 1080 × 1350 尺寸，且不新增网络请求。
