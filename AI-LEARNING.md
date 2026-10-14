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
- 自动向 settings-ai 容器填充模型、中键、翻页上下文和自定义提示词设置。
- renderSlide 完成后调用 learning?.notifySlide()。
- 切课时调用 learning?.resetCourse()，防止旧对话或在途响应混入新课。
- 必须返回 null 表示没有当前课件。getSlide 的 index 是从 0 开始的页码。
- 同一个 shadow host 跟随课堂全屏根容器，AI 面板及截图框选自然跟随；不另建 body portal。
- 全局播放快捷键应忽略 ai-learning、ai-crop 及可编辑元素。
- 如后创建入口，应显式绑定 learning.open / explainSlide / startCapture，或重建实例。

## 行为

当前 PPT 讲解、框选/粘贴截图和多轮对话使用已登录账号。设置提供费曼、专业、复习、自定义四种模式。中键只启动页面截图；框选预览后点击发送才上传。“讲解本页”会直接发起讲解。知识卡在回答后出现，翻页上下文状态仅在开启后显示。

字幕层保持 pointer-events:none，左键继续穿透至播放器。中键在页面空白、课程内容及插件界面中直接启动截图；链接、输入框和带修饰键的中键保留浏览器操作。图片中文字由视觉模型理解，选中文字仍可右键“问插件”。

翻页记忆默认关闭。打开后只在本页内记住最近两页，仅点击“讲解本页”时附上；不会因翻页或纯文字提问发送图片。本机问题列表保存完整对话与附图；连续追问发送最近四轮文字，不自动重传旧截图。需要重新查看图片时请截图、粘贴或点击“讲解本页”。本标签页按课程保存当前对话与草稿，GM 存储按独立会话保存历史问题、回答和附图；“新对话”归档旧会话后清空当前窗口。新框选或粘贴截图自动新开会话，且不附带旧字幕资料。普通网页通过 web-assistant.js 的轻量面板接入，只发送用户明确选择的文字与图片。

0.20.44：最终产品为完整 Chrome / Edge Manifest V3 扩展；安装并允许网站访问后，页面首次中键与截图按钮直接通过后台 captureVisibleTab 获取实际画面，优先于本地 PPT 取图。只接受可信的真实截图操作，使用一次性短时授权；校验来源、活动标签页及页面来源。原生失败明确提示重试，不再调用 getDisplayMedia 或自动后备共享，也不重绘整页 DOM。中键仍在原位置拖框、松开取图，透明选区预览可批注，重新全屏或 resize 等比重排而不丢批注；助手控件暂时隐藏但保留 PPT / 字幕。油猴仅供过渡测试，需另加载临时截图桥接扩展才能测同一原生流程，正式扩展不需要桥接或油猴；桥接 DOM 通道仅供可信测试页面。不装桥接时油猴保留可读 PPT 原图和系统截图粘贴，并给出普通页面截图的安装提示。讲解本页读取课件仍用限定学校域名的图片请求，旧 HTTP 地址以 HTTPS 读取。截图不自动发送，无后台截图或麦克风采集。

## 请求与预算

- 固定官方 endpoint：https://ark.cn-beijing.volces.com/api/v3/responses
- 默认模型采用用户指定的 doubao-seed-2-1-lite-260915，可在设置修改。
- stream:true；store:false；max_output_tokens:2200；Seed 2 使用 reasoning.effort=minimal。
- 输入图片为 input_image / image_url data URL；不把课件原地址及其签名参数发送给模型。
- 图像最长边 1600 px，单张编码不超过约 2.2 MB 字符。原始图片大小上限 15 MB。
- 每次最多三张图片，模块正常流程最多两张显式讲解的课件；历史文字最多 14000 字符，课程上下文 9000 字符，提问 4000 字符。
- Key 只进入 Authorization header；错误提示不回显服务端原始错误正文。回复使用纯文本渲染，不执行 HTML。
- 停止、切课和销毁均中断在途 GM 请求；响应序号可阻止迟到回复进入新会话。
- 联网搜索入口隐藏，旧保存开关强制关闭，作为后续开发内容保留；当前用户脚本不发送搜索工具。

## 验证

~~~text
node --test ai-learning.test.cjs
node ai-learning-ui.test.cjs
~~~

Node 回归覆盖流式兼容、首段超时、新对话隔离、请求字段、预算、模式、历史截断、响应解析、Key 隔离、错误不泄露、取消及词语提取。

Chrome 交互回归已通过：文字对话、切模式、PPT 图片、多轮图片、框选与发送、翻页无后台请求、页面与字幕中键截图且左键穿透、非课程文案不请求、取消、切课、无 Key、全屏和纯文本安全渲染。常规回归使用 mock；明确的 live-ai-ui.test.cjs 则验证线上账号、真实流式和两轮上下文。

## 核对的官方资料

- [Responses API 输入项与图像格式](https://docs.volcengine.com/docs/ark/get-response-context-api?lang=zh)：input_image、image_url 字符串及 Base64 data URL，system/user/assistant 消息角色。
- [流式输出及响应样例](https://docs.volcengine.com/docs/ark/streaming-output?lang=zh)：output 数组里的 message / output_text。AI 实现 HTTP SSE，逐步显示 output_text.delta，只有 response.completed 才把完整回答加入历史；翻译保留 JSON。
- [Response 生命周期与 store 状态](https://docs.volcengine.com/docs/ark/response-lifecycle?lang=zh)：completed/incomplete/failed 以及 store 字段。

后续语音方案可用独立 ASR + 当前文字讲解模型 + TTS。实时打断、边听边答则需额外接入实时语音对话服务；本次实现聚焦文字链路，不默认开通语音产品。

## 本地知识卡

AI 回复后可点击“保存知识卡”，将当前完整对话的每次问题、追问、回答和附图合成一张 PNG 长图，宽度通常为 1080、高度按内容自动增长，不分页、不截断、不打包 ZIP。极长对话整体缩放，以适应浏览器画布尺寸。卡片使用蓝底半透明鹰纹页眉，底部放可扫描的安装说明二维码，并说明支持 Edge。二维码指向项目的安装说明，不宣称已在 Edge 商店上架；设置和登录界面不放宣传二维码。导出前去除已知 Key、Bearer 凭证和文本中的 URL，不自动上传或发布。空对话及切课后禁用；欢迎词不能导出。返回实例提供 saveKnowledgeCard()。浏览器测试验证实际 PNG 下载、完整长文和附图、二维码扫码结果，导出不新增网络请求。

## 油猴传输兼容（0.19.3）

生产网关将学习模块的 stream 请求适配为一次创建任务与短 JSON 增量读取。上游模型仍 stream:true，浏览器不读取 GM ReadableStream；适配器将增量交给同一文本解析器，故页面持续显示。读取不会新增模型调用。每次短请求 15 秒超时，首段正文仍有 45 秒上限。默认翻译和语音传输不受影响。停止取消同一任务；服务器答案仅在短期内存缓存，账号/APP 隔离。

## 阅读与简洁讲解（0.19.6）

正文 16px、面板宽 480px（受视口上限约束）。KaTeX 0.19.0 代码、样式和 WOFF2 字体均随安装包内嵌，支持 $...$、$$...$$、\(...\)、\[...\]；流式未闭合公式先显示原文，闭合后排版，代码块保持原文。不执行模型的 HTML 或可信 TeX 外部链接。

费曼模式默认“一句核心＋一个最小例子”，目标 150 字以内、不强行类比或自动出题，明确要求详细说明才展开。这是产品提示词设计，参考 [Caltech 教学资源](https://ctlo.caltech.edu/aboutctlo/whoweserve/undergraduates/learning-resources/learning/power-of-teaching) 的简单语言、自我解释与发现理解缺口，不是宣称该字数得到实验验证。
