# 知识卡名言库

直接编辑同目录的 `quotes.json`，不需要在 `ai-learning.js` 中找文案。当前有 9 条，涉及竺可桢、《中庸》、孔子、诸葛亮、王阳明、马斯克、特朗普、牛顿。

## 添加方法

在 `quotes` 数组里复制一个对象，修改下面这些字段（不要忘记对象之间的英文逗号）：

```json
{
  "id": "my-quote-unique-id",
  "text": "名言正文，不必手动换行。",
  "author": "作者或准确的引用关系",
  "category": "学习与思考",
  "sourceTitle": "原始书名、演讲或可靠出处",
  "source": "https://可靠来源的具体页面"
}
```

外文译句再加 `"original": "外文原句"` 与 `"isTranslation": true`；卡片署名会显示“译”，以免将中文译文误认为原作者的中文原话。不要填写 AI 解读，本版只展示名言及署名。

`id` 必须唯一；`text`、`author`、`sourceTitle`、`source` 不能为空。请为新增引文核对实际出处。推荐正文不超过 24 个汉字，以便横向一行展示；较长文字会先适当缩小字号，再自动换行，不裁切。避免手动加入换行，布局会统一处理。

在项目根目录运行：

```powershell
npm run build:quotes
```

命令会校验 JSON、重建共用脚本及完整扩展包。将浏览器扩展管理页中加载的 `dist/extension` 重新加载，再刷新网页；若使用 ZIP，则解压新生成的包后重新加载。**编辑 JSON 不会自动改变已经编译并加载的旧扩展，也不会上传服务器。** 不需要为本机修改提升版本号；对外发新版时再更新项目版本并记录 README / CHANGELOG。

## 当前内容

- 竺可桢：只问是非，不计利害。 [出处](https://www.zju.edu.cn/2021/0416/c57381a2296082/pagem.htm)
- 竺可桢：排万难冒百死以求真理。 [出处](https://www.zju.edu.cn/2022/0325/c66007a2510816/pagem.htm)
- 《中庸》 · 竺可桢引述：博学之、审问之、慎思之、明辨之、笃行之。 [出处](https://www.zju.edu.cn/xx1/listm.htm)
- 孔子：学而不思则罔，思而不学则殆。 [出处](https://m.ccdi.gov.cn/content/56/7a/3777.html)
- 诸葛亮：非学无以广才，非志无以成学。 [出处](https://jcj.moa.gov.cn/lzwh/lzjy/201006/t20100629_1829343.htm)
- 王阳明：知是行之始，行是知之成。 [出处](https://sn.mof.gov.cn/gzdt/caizhengjiancha/201607/t20160701_2343733.htm)
- 埃隆·马斯克：格外努力地工作！ [出处](https://customsitesmedia.usc.edu/wp-content/uploads/sites/326/2014/09/17160607/Commencement-2014.pdf)
- 唐纳德·特朗普：不要让任何人告诉你，这件事办不到。 [出处](https://trumpwhitehouse.archives.gov/briefings-statements/the-inaugural-address/)
- 艾萨克·牛顿：如果我看得更远，那是因为我站在巨人的肩上。 [出处](https://www.newtonproject.ox.ac.uk/view/texts/normalized/OTHE00018)
