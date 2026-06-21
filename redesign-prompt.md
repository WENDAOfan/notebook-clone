## 任务：重构前端 CSS 样式，模仿 Google NotebookLM 的视觉风格

你是一个前端 UI 设计师。我需要一个你帮我把现有的"AI 经典蓝紫渐变"风格改造成 Google NotebookLM 的极简扁平风格。

### 项目技术栈

纯 HTML + CSS + Vanilla JavaScript，没有 React/Vue/Tailwind 等任何框架和构建工具。所有样式写在一个 `style.css` 文件里。所以你的所有修改都只能是 CSS 层面的，不要引入任何新的依赖。

### 当前问题（必须全部消除）

1. **大面积蓝紫渐变**：header 背景、登录页背景、笔记本问答面板头部、发送按钮、进度条全部用了 `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`，这是典型的 AI 模板配色，非常廉价
2. **选中状态是紫色实色块**：`.notebook-item.active` 直接用了 `background-color: #667eea; color: white`，像 2015 年的管理后台
3. **Emoji 当图标**：Logo、文档图标、笔记本图标全部用 emoji（📓、📄 等），看起来像原型而不是成品
4. **过度的阴影和动画**：`box-shadow: 0 8px 32px`、`0 10px 40px`，以及大量 `@keyframes` 动画，NotebookLM 几乎不用这些
5. **QA 面板是渐变卡片**：笔记本级问答面板整个是一个渐变色的"卡片"，像仪表盘 widget 而不是笔记工具的 UI

### NotebookLM 的设计特征（你要模仿的目标）

NotebookLM 是 Google 的产品，遵循 Google Material Design 的设计语言，但比标准 Material 更克制、更素雅。核心特征：

**配色方案：**
- 主背景色：纯白 `#ffffff`
- 侧边栏背景：极浅灰 `#f8f9fa` 或 `#f1f3f4`
- 分割线/边框：`#dadce0`（Google 标准灰）
- 主色调（accent）：Google Blue `#1a73e8`，仅用于按钮、链接、选中指示器等交互元素
- 文字主色：`#202124`（Google 标准正文色）
- 文字次色：`#5f6368`
- 警告/删除：`#d93025`
- 成功/正面：`#188038`
- **绝对不要任何渐变色**。所有背景都是纯色（solid color）
- **绝对不要紫色**。NotebookLM 的色系是蓝 + 灰 + 白，紫色完全不存在

**布局结构（三栏）：**
- 左侧栏（Sources 面板）：约 260-280px，浅灰背景 `#f8f9fa`，用于显示笔记本列表和文档源列表
- 中间主区域：白色背景，flex: 1，是聊天/问答的主要交互区
- 右侧栏（可选）：约 280-300px，浅灰背景，用于笔记/设置等辅助信息
- 三栏之间用 1px `#dadce0` 的边框分隔，不要任何阴影分隔

**顶部栏（Header）：**
- **不是渐变色**，是纯白或极浅灰背景 `#ffffff` 或 `#f8f9fa`
- 底部 1px `#dadce0` 边框
- 文字颜色是深色 `#202124`，不是白色
- Logo 区域用文字（"Notebook" 或项目名称），不要 emoji
- 整体高度约 56-64px，内容垂直居中
- 按钮是 outlined 风格（白底 + 蓝色边框 + 蓝色文字）或 flat 风格（无背景无 border，仅蓝色文字）

**左侧边栏：**
- 背景 `#f8f9fa`，不要任何装饰
- 笔记本列表项：无背景色，hover 时变为 `#e8eaed`，选中时左侧出现一条 3px 宽的蓝色竖线（`#1a73e8`），背景变为 `#e8f0fe`（极浅蓝），文字变为深色而非白色
- 列表项的圆角改为 0 或仅右侧圆角（`border-radius: 0 24px 24px 0`），这是 Google 产品的典型做法
- 列表项 padding 适当，间距舒适
- 侧边栏顶部有一个小按钮或区域用于"新建笔记本"，用 outlined 按钮风格

**中间主区域：**
- 文档列表：每个文档是一个扁平的列表项（不是卡片），左侧有小图标，右侧有操作按钮，hover 时背景变灰 `#f1f3f4`，不要任何 `box-shadow` 和 `transform: translateY`
- 问答输入框：一个圆角矩形（`border-radius: 24px`），1px `#dadce0` 边框，内部左侧是输入区域，右侧是发送按钮（蓝色圆形按钮内含箭头图标）。聚焦时边框变为 `#1a73e8`，不要 box-shadow 发光效果
- AI 回答区域：纯白或 `#f8f9fa` 背景，1px `#dadce0` 边框，`border-radius: 12px`，无阴影
- 回答区域顶部左侧有小的 AI 图标（可以用一个浅蓝色圆形内放一个 ✦ 符号或简单的字母 A 来代替，不用 emoji）

**按钮风格：**
- Primary：实心蓝色按钮，`background: #1a73e8; color: white; border-radius: 20px;` 不要渐变不要阴影
- Outlined：白底 + `border: 1px solid #dadce0; color: #1a73e8; border-radius: 20px;`
- Text：无边框无背景，仅 `color: #1a73e8`
- Danger：`color: #d93025`，无背景
- 所有按钮 hover 时只加深一点点背景色（如 `background: #e8f0fe`），不要 transform 位移

**弹窗（Modal）：**
- 背景遮罩：`rgba(0,0,0,0.32)`（Google 标准遮罩透明度）
- 弹窗本体：`border-radius: 28px`（Google 的大圆角），纯白背景，`box-shadow: 0 24px 48px rgba(0,0,0,0.12)`
- 弹窗标题：`font-size: 22px; font-weight: 400; color: #202124`
- 不要 `@keyframes modalSlideIn` 动画，用简单的 opacity fade-in 就够了

**登录页面：**
- 纯白背景，不要任何渐变
- 登录卡片居中，`border-radius: 28px`，极轻的阴影 `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`
- Logo 区域简洁：项目名称文字 + 可选的简单图标
- 输入框：Material 风格的 outlined text field，`border: 1px solid #dadce0; border-radius: 4px`，聚焦时 `border: 2px solid #1a73e8`
- 登录按钮：实心蓝色 `#1a73e8`，全宽，`border-radius: 20px`

**表单输入框：**
- 高度 40-48px
- `border: 1px solid #dadce0`
- `border-radius: 4px`（Material outlined 风格，不是大圆角）
- 聚焦时 `border: 2px solid #1a73e8`，不要 box-shadow 发光
- padding: `0 16px`

**字体：**
- 保持现有系统字体栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...` 即可
- 标题 `font-weight: 500`（Google 不用 600/700 做标题，偏 medium）
- 正文 `font-weight: 400`

**引用溯源卡片（citation）：**
- 保持扁平，`border: 1px solid #dadce0; border-radius: 8px`
- 左侧竖线改为 `#1a73e8`（蓝色）
- 编号圆圈：`background: #1a73e8; color: white`
- 去掉 box-shadow

**Toast 提示：**
- `border-radius: 8px`
- 背景用深色：`#323232`（Material Snackbar 风格）
- 文字白色
- 不要彩色背景（不用绿/红/蓝）

**动画原则：**
- 删除所有 `@keyframes` 中花哨的动画（`authSlideIn`、`modalSlideIn`、`qaSlideDown`、`pulse`、`streamPulse`）
- 保留 `qaAnswerFadeIn` 但改为简单的 `opacity: 0 → 1`，去掉 translateY
- 所有 hover 过渡用 `transition: background-color 0.15s` 就够了
- 流式输出时不需要 `streamPulse` 动画，用光标闪烁效果（textarea 末尾加一个 `▌` 字符闪烁）更自然

### 具体的 CSS 变量定义

在 `style.css` 的最顶部，定义一套 CSS 变量（Custom Properties），方便后续统一修改：

```css
:root {
    --color-primary: #1a73e8;
    --color-primary-hover: #1765cc;
    --color-primary-light: #e8f0fe;
    --color-danger: #d93025;
    --color-success: #188038;
    --color-text-primary: #202124;
    --color-text-secondary: #5f6368;
    --color-text-disabled: #9aa0a6;
    --color-bg-primary: #ffffff;
    --color-bg-secondary: #f8f9fa;
    --color-bg-hover: #f1f3f4;
    --color-bg-selected: #e8f0fe;
    --color-border: #dadce0;
    --color-overlay: rgba(0, 0, 0, 0.32);
    --radius-small: 4px;
    --radius-medium: 8px;
    --radius-large: 16px;
    --radius-pill: 24px;
    --radius-dialog: 28px;
    --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.08);
    --shadow-medium: 0 1px 2px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.08);
    --font-stack: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

然后整个文件里所有原来的硬编码颜色值（`#667eea`、`#764ba2`、`#333`、`#6c757d` 等）全部替换为对应的 CSS 变量。

### 不要做的事情

1. 不要改 HTML 结构（class 名可以保留，只改 CSS）
2. 不要引入任何 CSS 框架或字体库（不加载 Google Fonts，不用 Bootstrap/Tailwind）
3. 不要改 JavaScript 逻辑
4. 不要添加 SVG 图标（用 CSS 画简单图标或者暂时用 Unicode 符号 `✦`、`→`、`+` 等代替 emoji）
5. 不要做响应式的大改，保持现有的 768px 断点逻辑
6. 不要用 emoji 做图标，全部去掉

### 交付要求

直接输出完整的、替换后的 `style.css` 文件。文件开头放 CSS 变量定义，然后按原有的注释分块结构（登录页面、Header、Sidebar、Content、按钮、表单、弹窗、问答区域、右侧面板、响应式）逐一替换。保持原有的注释标记以便我对照原始文件。
