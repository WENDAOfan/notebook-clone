# Day 18：接入 AI 大模型 — 注册 API 并引入 Spring AI 依赖

> **核心目标**：选择一个可用的大模型 API（推荐 DeepSeek），注册账号并获取 API Key，在项目中引入 Spring AI 依赖，为 Day 19 打通模型调用做好准备。

---

## 背景知识

### 为什么需要 Spring AI？

直接调用大模型 API 很简单——就是一个 HTTP POST 请求。但如果你有多个模型（DeepSeek、OpenAI、智谱等），每个模型的请求格式、响应格式、错误处理都不一样，代码会变得很乱。

**Spring AI 的作用**：提供统一的抽象层，让你用同一套代码调用不同厂商的模型。

```
你的代码
   │
   │ 调用 ChatClient.chat()
   ↓
┌─────────────┐
│  Spring AI  │  ← 统一接口
│  ChatClient │
└─────────────┘
   │
   ├─→ DeepSeek 适配器 ──→ DeepSeek API
   ├─→ OpenAI 适配器   ──→ OpenAI API
   └─→ 智谱适配器      ──→ 智谱 API
```

### 大模型选择建议

| 模型 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **DeepSeek** | 中文强、便宜、国内访问稳定 | 需要注册 | ⭐⭐⭐⭐⭐ |
| 智谱 GLM | 国内大厂、文档全 | 价格稍高 | ⭐⭐⭐⭐ |
| OpenAI | 能力最强、生态最成熟 | 需要翻墙、贵 | ⭐⭐⭐ |

**本教程以 DeepSeek 为例**，因为它的性价比最高，国内开发者最容易上手。

### API Key 保密原则

**API Key = 你的银行卡密码**，一旦泄露，别人可以花你的钱调用模型。

```
❌ 错误：把 Key 直接写在代码里
   String apiKey = "sk-abc123...";  // 提交到 Git 就泄露了！

✅ 正确：把 Key 写在 application.properties 里，且该文件加入 .gitignore
   spring.ai.openai.api-key=${DEEPSEEK_API_KEY}
   
✅ 更好：使用环境变量
   export DEEPSEEK_API_KEY=sk-abc123...
```

---

## 任务规划（共 4 步）

---

### 第 1 步：注册 DeepSeek 账号并获取 API Key

#### 1.1 注册账号

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 用手机号注册并登录
3. 进入「API Keys」页面，点击「创建 API Key」
4. 给 Key 起个名字（比如 `notebook-clone`），然后**复制生成的 Key**

> ⚠️ **重要**：Key 只会显示一次，关闭页面后就看不到了！立刻保存到安全的地方。

#### 1.2 充值（可选但建议）

DeepSeek 新账号有少量免费额度，但很快就会用完。建议充值 10~20 元，足够开发测试用。

进入「充值」页面，按提示操作即可。

#### 1.3 验证 Key 是否有效

用 curl 或 Postman 测试一下：

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的api-key" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

如果能收到类似下面的响应，说明 Key 有效：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Hello! How can I assist you today?"
      }
    }
  ]
}
```

---

### 第 2 步：引入 Spring AI 依赖

#### 2.1 添加 Maven 依赖

**文件：** `notebook-clone/pom.xml`

在 `<dependencies>` 标签内，添加 Spring AI 和 DeepSeek 适配器依赖：

```xml
<!-- Spring AI 核心依赖 -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-openai-spring-boot-starter</artifactId>
</dependency>
```

> 💡 **为什么是 `openai-starter`？** DeepSeek 的 API 格式兼容 OpenAI，所以可以直接用 OpenAI 的适配器，只需要把 base-url 改成 DeepSeek 的地址即可。

#### 2.2 添加 Spring AI 的 Maven 仓库

Spring AI 目前不在 Maven 中央仓库，需要额外配置仓库地址。

在 `pom.xml` 的 `<project>` 根标签内，`<dependencies>` 的上方或下方，添加 `<repositories>` 和 `<dependencyManagement>`：

```xml
<repositories>
    <repository>
        <id>spring-milestones</id>
        <name>Spring Milestones</name>
        <url>https://repo.spring.io/milestone</url>
        <snapshots>
            <enabled>false</enabled>
        </snapshots>
    </repository>
</repositories>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version>1.0.0-M6</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

**完整位置示意**：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project ...>
    ...
    <properties>
        <java.version>21</java.version>
    </properties>
    
    <!-- ===== Day 18 新增：Spring AI 仓库配置 ===== -->
    <repositories>
        <repository>
            <id>spring-milestones</id>
            <name>Spring Milestones</name>
            <url>https://repo.spring.io/milestone</url>
            <snapshots>
                <enabled>false</enabled>
            </snapshots>
        </repository>
    </repositories>
    
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.ai</groupId>
                <artifactId>spring-ai-bom</artifactId>
                <version>1.0.0-M6</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <!-- ============================================= -->
    
    <dependencies>
        <!-- 原有依赖不变... -->
        
        <!-- ===== Day 18 新增：Spring AI 依赖 ===== -->
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-openai-spring-boot-starter</artifactId>
        </dependency>
        <!-- ======================================= -->
    </dependencies>
    ...
</project>
```

#### 2.3 刷新 Maven 依赖

在 IDE 里右键 `pom.xml` → `Maven` → `Reload Project`，或者点击 Maven 面板的刷新按钮。

等待依赖下载完成（可能需要几分钟，因为要从 Spring 的仓库下载）。

---

### 第 3 步：配置 AI 客户端

#### 3.1 在 application.properties 中添加配置

**文件：** `src/main/resources/application.properties`

在文件末尾追加：

```properties
# ===== Day 18: Spring AI + DeepSeek 配置 =====
# DeepSeek 的 API 地址（兼容 OpenAI 格式）
spring.ai.openai.base-url=https://api.deepseek.com
# 你的 API Key（从 DeepSeek 平台获取）
spring.ai.openai.api-key=sk-你的api-key
# 默认使用的模型
spring.ai.openai.chat.options.model=deepseek-chat
# =============================================
```

> ⚠️ **重要**：`application.properties` 已经在 `.gitignore` 里了吗？检查一下，确保 API Key 不会被提交到 Git！

#### 3.2 使用环境变量（更安全的方式）

如果你不想把 Key 写在文件里，可以用环境变量：

```properties
spring.ai.openai.api-key=${DEEPSEEK_API_KEY:}
```

然后在启动应用前设置环境变量：

**Windows PowerShell：**
```powershell
$env:DEEPSEEK_API_KEY="sk-你的api-key"
```

**Windows CMD：**
```cmd
set DEEPSEEK_API_KEY=sk-你的api-key
```

**Linux/Mac：**
```bash
export DEEPSEEK_API_KEY=sk-你的api-key
```

> 开发阶段直接用第一种方式（写在 properties 里）更方便，但要确保 `.gitignore` 已经排除了该文件。

---

### 第 4 步：验证依赖引入成功

#### 4.1 启动项目测试

直接启动 `NotebookCloneApplication`，看控制台有没有报错。

**预期**：项目正常启动，没有 `ClassNotFoundException` 或依赖相关的错误。

#### 4.2 检查 Spring AI 是否初始化成功

在控制台日志里搜索 `ChatClient` 或 `OpenAi`，应该能看到类似这样的日志：

```
o.s.a.a.o.OpenAiChatClient        : OpenAI Chat Client initialized
```

如果没有报错，说明 Spring AI 依赖引入成功，配置也正确。

#### 4.3 如果启动报错

| 错误现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| `Could not find artifact org.springframework.ai:...` | Maven 仓库配置不对 | 检查 `repositories` 和 `dependencyManagement` 是否正确添加 |
| `Connection refused` 或超时 | 网络问题，无法访问 Spring 仓库 | 检查网络，或尝试使用代理 |
| `api-key must not be empty` | API Key 没配置 | 检查 `application.properties` 里的 Key 是否正确 |

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `pom.xml` | **修改** | 添加 Spring AI 仓库、BOM、openai-starter 依赖 |
| `application.properties` | **修改** | 添加 DeepSeek API 地址、Key、模型配置 |
| `.gitignore` | **确认** | 确保 `application.properties` 已被排除（如未排除则添加） |

---

## Day 18 完成标志

- [ ] 在 DeepSeek 平台注册账号并获取 API Key
- [ ] 用 curl 测试 API Key 是否有效（能收到模型回复）
- [ ] `pom.xml` 已添加 Spring AI 仓库和依赖
- [ ] Maven 依赖刷新成功，没有下载错误
- [ ] `application.properties` 已配置 DeepSeek 的 base-url、api-key、model
- [ ] 项目能正常启动，没有 Spring AI 相关的报错
- [ ] Git 提交：`git commit -m "feat: Day18 引入 Spring AI 依赖，配置 DeepSeek API"`

---

## 核心知识点总结

### 1. Spring AI 的定位

Spring AI 不是一个大模型，而是一个**调用大模型的统一框架**。类比：
- JDBC 让你用统一方式连接 MySQL、PostgreSQL、Oracle
- Spring AI 让你用统一方式调用 DeepSeek、OpenAI、智谱

### 2. DeepSeek 为什么能用 OpenAI 的适配器？

因为 DeepSeek 的 API 设计**完全兼容 OpenAI 的格式**：
- 请求路径一样：`/v1/chat/completions`
- 请求参数一样：`model`、`messages`、`temperature` 等
- 响应格式一样：`choices[].message.content`

所以只需要改 `base-url` 和 `api-key`，其他代码完全不用动。

### 3. API Key 安全三原则

```
┌─────────────────────────────────────────┐
│  1. 绝不硬编码在 Java 代码中             │
├─────────────────────────────────────────┤
│  2. 写在 properties 中，且文件加入       │
│     .gitignore，不提交到版本控制          │
├─────────────────────────────────────────┤
│  3. 生产环境用环境变量或密钥管理服务       │
│     （如 AWS Secrets Manager、阿里云     │
│      KMS 等）                            │
└─────────────────────────────────────────┘
```

### 4. 第三阶段路线图

| Day | 内容 | 目标 |
|:---:|------|------|
| **18** | 注册 API + 引入依赖 | 准备工作 |
| **19** | 写 `/test/ai` 接口打通调用 | 能调通模型 |
| **20** | 文档摘要自动生成 | 第一个 AI 功能 |
| **21** | 基于单个文档的智能问答 | 核心功能 |
| **22** | 基于笔记本（多文档）的智能问答 | 进阶功能 |
| **23** | SSE 流式输出 | 体验优化 |
| **24** | 引用溯源 | 专业功能 |
| **25** | 异步生成摘要 | 性能优化 |
| **26** | 超时重试、用量统计 | 稳定性 |

---

## 下节预告（Day 19）

> **打通模型调用**：编写第一个 AI 接口 `/test/ai`，用 `ChatClient` 向 DeepSeek 发送消息并获取回复。掌握 Prompt 的基本结构（System + User 消息）。

---

## 💡 常见问题

**Q: 我不想用 DeepSeek，想用其他模型怎么办？**

A: 只需要改 `application.properties` 里的配置：

| 模型 | base-url | model |
|------|----------|-------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com` | `gpt-4o` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |

代码完全不用改，这就是 Spring AI 的价值。

**Q: 依赖下载很慢或失败怎么办？**

A: 尝试以下方法：
1. 检查网络是否能访问 `repo.spring.io`
2. 在 IDE 的 Maven 设置里配置国内镜像（如阿里云）
3. 多试几次 `Reload Project`，有时只是网络波动

**Q: API Key 泄露了怎么办？**

A: 立刻到 DeepSeek 平台删除该 Key，重新创建一个新的，然后更新 `application.properties`。
