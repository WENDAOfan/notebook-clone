# Day 19：打通模型调用——编写第一个 AI 接口 `/test/ai`

> **核心目标**：使用 Spring AI 提供的 `ChatClient`，编写一个测试接口向 DeepSeek 发送消息并获取回复。掌握 Prompt 的基本结构（System + User），并直观感受"同步阻塞"的调用特性。

---

## 背景知识

### 什么是 `ChatClient`？

在 Day 18 中，我们引入了 `spring-ai-openai-spring-boot-starter`。这个 starter 会自动帮我们创建一个**已经配置好 API Key 和 base-url 的 `ChatClient` 实例**，直接注入就能用。

```
你的 Controller
      │
      ▼ 注入 ChatClient
┌─────────────┐
│  ChatClient │  ← Spring AI 自动配置（已带好 API Key、base-url、model）
└─────────────┘
      │
      ▼ 调用 .prompt().user().call().content()
┌─────────────┐
│ Spring AI   │  ← 统一封装请求/响应格式
│ 适配层      │
└─────────────┘
      │
      ▼ HTTP POST
┌─────────────┐
│ DeepSeek API│  ← 返回 JSON
└─────────────┘
```

### Prompt 的两种角色

和大模型对话时，消息分为两种角色：

| 角色 | 作用 | 示例 |
|------|------|------|
| **System** | 设定 AI 的身份、能力边界、回答风格 | "你是一位技术文档助手，回答简洁" |
| **User** | 用户的具体问题 | "总结一下 Spring Boot 的优缺点" |

```
┌─────────────────────────────────────────┐
│ Prompt（提示词）                         │
├─────────────────────────────────────────┤
│ System: 你是一个专业的技术文档助手       │  ← 给 AI "定人设"
├─────────────────────────────────────────┤
│ User: 什么是 RESTful API？              │  ← 用户的真实问题
└─────────────────────────────────────────┘
              │
              ▼
        大模型生成回复
```

### 什么是同步阻塞？

今天我们用的是**同步调用**：
```java
String answer = chatClient.prompt()...call().content(); // 这行代码会"卡住"
```
- 代码执行到这里，线程停下来等 DeepSeek 服务器返回结果
- 网络 + 模型计算通常需要 **2~5 秒**
- 这段时间里，这个 HTTP 请求线程一直被占用

**为什么先学同步？**
- 简单直观，适合第一次打通调用
- Day 23 我们会改成 SSE 流式输出，那时候再理解"异步非阻塞"

---

## 任务规划（共 5 步）

---

### 第 1 步：创建 TestAiController，注入 ChatClient

#### 1.1 新建 Controller 文件

**文件**：`src/main/java/com/example/notebookclone/controller/TestAiController.java`

```java
package com.example.notebookclone.controller;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/test")
public class TestAiController {

    // Spring AI 自动配置好的 ChatClient，直接注入即可
    private final ChatClient chatClient;

    public TestAiController(ChatClient chatClient) {
        this.chatClient = chatClient;
    }

    // 接口先留空，下一步实现
}
```

**为什么能直接注入？**
- Day 18 配置的 `spring.ai.openai.api-key` 和 `base-url` 被 Spring AI 读取后
- 自动创建了一个 `ChatClient` Bean 并放入 Spring 容器
- 我们只需要在构造函数里声明依赖，Spring 会自动装配

---

### 第 2 步：实现最基础的 `/test/ai` 接口（硬编码提问）

#### 2.1 编写最简单版本

在 `TestAiController` 中添加第一个接口：

```java
/**
 * 最基础的 AI 测试接口：问一个固定问题
 */
@GetMapping("/ai")
public Result<String> testAi() {
    // 调用 DeepSeek，问一个固定问题
    String answer = chatClient.prompt()
            .user("你好，请用一句话介绍你自己")
            .call()
            .content();

    return Result.success(answer);
}
```

**代码拆解**：
| 方法 | 作用 |
|------|------|
| `.prompt()` | 开始构造一次对话请求 |
| `.user("...")` | 设置 User 角色的消息（用户的问题） |
| `.call()` | **同步阻塞**调用模型，等待返回 |
| `.content()` | 从响应中提取 AI 生成的文本内容 |

#### 2.2 启动项目测试

启动 `NotebookCloneApplication`，观察控制台：
- 应该能正常启动（没有 Bean 创建失败的报错）
- 日志里能看到 Spring AI 初始化相关信息

**测试**：
```bash
curl http://localhost:8080/test/ai
```

**预期响应**：
```json
{
  "code": 200,
  "message": "success",
  "data": "你好！我是 DeepSeek，一个由深度求索公司开发的 AI 助手..."
}
```

> ⚠️ **注意**：第一次调用可能需要 3~5 秒，这是正常的（网络请求 + 模型生成）。线程在这段时间里是被阻塞的。

---

### 第 3 步：升级接口——支持传入问题 + 添加 System Prompt

#### 3.1 定义请求 DTO

**文件**：`src/main/java/com/example/notebookclone/dto/ChatRequest.java`

```java
package com.example.notebookclone.dto;

import lombok.Data;

@Data
public class ChatRequest {
    /**
     * 用户的问题（必填）
     */
    private String question;

    /**
     * 系统提示词（可选，不传则使用默认）
     */
    private String systemPrompt;
}
```

#### 3.2 升级 Controller 接口

把 `TestAiController` 改造为支持传入参数：

```java
package com.example.notebookclone.controller;

import com.example.notebookclone.dto.ChatRequest;
import com.example.notebookclone.dto.Result;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/test")
public class TestAiController {

    private final ChatClient chatClient;

    public TestAiController(ChatClient chatClient) {
        this.chatClient = chatClient;
    }

    /**
     * 基础测试：固定问题（保留用于快速验证）
     */
    @GetMapping("/ai")
    public Result<String> testAi() {
        String answer = chatClient.prompt()
                .user("你好，请用一句话介绍你自己")
                .call()
                .content();
        return Result.success(answer);
    }

    /**
     * Day 19 核心接口：支持自定义问题和 System Prompt
     */
    @PostMapping("/ai")
    public Result<String> chat(@RequestBody ChatRequest request) {
        // 参数校验
        if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
            return Result.error(400, "问题不能为空");
        }

        // 构建 Prompt
        ChatClient.ChatClientRequestSpec prompt = chatClient.prompt();

        // 如果传了 systemPrompt，就设置 System 角色
        if (request.getSystemPrompt() != null && !request.getSystemPrompt().trim().isEmpty()) {
            prompt.system(request.getSystemPrompt());
        }

        // 设置 User 问题，发起调用
        String answer = prompt
                .user(request.getQuestion())
                .call()
                .content();

        return Result.success(answer);
    }
}
```

**Prompt 构建逻辑**：
```
用户传了 systemPrompt？
    ├─ 是 → prompt.system("用户自定义的系统提示")
    └─ 否 → 不设置 System（模型用默认身份）

prompt.user("用户的具体问题")  ← 必须有
.call().content()              ← 同步阻塞调用
```

---

### 第 4 步：在 api.http 中添加测试用例

#### 4.1 追加到 api.http

**文件**：`notebook-clone/api.http`

在文件末尾追加 Day 19 的测试用例：

```http
### ========== Day 19 AI 调用测试 ==========

### 1. 基础测试：固定问题（GET 请求）
GET http://localhost:8080/test/ai

### 2. 自定义问题（不带 System Prompt）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "Java 和 Python 有什么区别？用一句话概括"
}

### 3. 自定义问题 + System Prompt（给 AI 定人设）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "什么是 RESTful API？",
  "systemPrompt": "你是一位资深后端工程师，回答要简洁专业，控制在 100 字以内"
}

### 4. 测试空问题（应该返回 400）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": ""
}

### 5. 测试中文能力：让 AI 写一首诗
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "写一首关于编程的短诗，4句话",
  "systemPrompt": "你是一位幽默的程序员诗人"
}
```

#### 4.2 执行测试，观察不同 System Prompt 的效果

同样的 `"question": "什么是 Spring Boot？"`，对比两种 System Prompt 的回答风格：

**System Prompt A**：`"你是一位大学教授，回答要严谨详尽"`
→ 回答很长，有定义、历史背景、核心特性...

**System Prompt B**：`"你是一位短视频博主，回答要口语化、简短"`
→ 回答很短，"兄弟们，Spring Boot 就是个脚手架，开箱即用..."

**这就是 Prompt 工程的基础：通过 System Prompt 控制输出风格。**

---

### 第 5 步：观察并理解"同步阻塞"特性

#### 5.1 用 Postman/VS Code REST Client 观察耗时

在 VS Code REST Client 里执行：
```http
### 测试响应时间
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "请详细解释什么是微服务架构，包括优缺点"
}
```

注意看状态栏或返回时间：
- 简单问题：约 **1~2 秒**
- 复杂问题（要求详细）：约 **3~8 秒**

#### 5.2 同步阻塞的本质

```java
String answer = chatClient.prompt()
        .user("复杂问题...")
        .call()      // ← 线程在这里停住，等服务器返回
        .content();  // ← 返回后才执行到这里

// 这行代码在 .call() 返回前不会执行
System.out.println("这行会等 AI 回复后才打印");
```

**线程状态变化**：
```
用户请求 ──→ Tomcat 线程池分配线程 T1
                │
                ▼
            执行 Controller
                │
                ▼
            执行到 .call()
                │
                ▼
            线程 T1 阻塞（BLOCKED/WAITING）
                │ 等待 DeepSeek 服务器响应
                │ 通常 2~5 秒
                ▼
            收到响应，继续执行
                │
                ▼
            返回 JSON 给前端
```

**带来的问题**：
- 并发高时，Tomcat 线程会被大量占用
- 用户看着浏览器"转圈"，体验不好
- 如果模型卡死或网络超时，接口也会挂掉

**解决方案（预告）**：
- Day 23 会用 SSE 流式输出，让 AI 像打字机一样逐字返回，用户不用干等
- Day 25 会用 `@Async` 异步处理不紧急的任务（如生成摘要）

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `TestAiController.java` | **新增** | AI 测试接口，注入 ChatClient，实现 GET/POST `/test/ai` |
| `ChatRequest.java` | **新增** | AI 对话请求 DTO，包含 question 和 systemPrompt |
| `api.http` | **修改** | 追加 Day 19 AI 调用测试用例 |

---

## Day 19 完成标志

- [ ] `TestAiController` 已创建，`ChatClient` 成功注入
- [ ] `GET /test/ai` 能返回固定问题的 AI 回复（验证基本连通性）
- [ ] `ChatRequest` DTO 已创建
- [ ] `POST /test/ai` 支持传入 `question` 和 `systemPrompt`
- [ ] 测试了"带 System Prompt"和"不带 System Prompt"的效果差异
- [ ] 测试了空问题返回 400 错误
- [ ] 观察到接口有明显的等待时间（2~5 秒），理解这是同步阻塞的特性
- [ ] Git 提交：`git commit -m "feat: Day19 打通 AI 模型调用，实现 /test/ai 接口"`

---

## 核心知识点总结

### 1. ChatClient 调用链

```java
chatClient
    .prompt()              // 1. 开始构造请求
    .system("...")         // 2. (可选) 设置系统提示
    .user("...")           // 3. (必填) 设置用户问题
    .call()                // 4. 同步阻塞调用模型
    .content();            // 5. 提取文本回复
```

### 2. System Prompt vs User Prompt

| | System Prompt | User Prompt |
|--|---------------|-------------|
| **次数** | 通常一次 | 可以多次（对话历史）|
| **作用** | 给 AI "定规矩"、设定身份 | 用户的具体问题 |
| **类比** | 入职培训手册 | 日常具体工作任务 |
| **是否必填** | 否 | 是 |

### 3. 同步阻塞的优缺点

| 优点 | 缺点 |
|------|------|
| 代码简单直观 | 线程被占用，并发能力受限 |
| 适合快速验证 | 用户等待时间长，体验差 |
| 容易调试 | 网络波动会导致接口整体超时 |

### 4. 第三阶段进度

| Day | 内容 | 状态 |
|:---:|------|:----:|
| **18** | 注册 API + 引入依赖 | ✅ 完成 |
| **19** | 打通模型调用（同步） | 🔄 今天 |
| **20** | 文档摘要自动生成 | ⏳ 待开始 |
| **21** | 基于单个文档的智能问答 | ⏳ 待开始 |
| **22** | 笔记本级（多文档）问答 | ⏳ 待开始 |
| **23** | SSE 流式输出 | ⏳ 待开始 |
| **24** | 引用溯源 | ⏳ 待开始 |
| **25** | 异步生成摘要 | ⏳ 待开始 |
| **26** | 超时重试、用量统计 | ⏳ 待开始 |

---

## 下节预告（Day 20）

> **文档摘要**：上传文档后，自动调用 AI 生成文档摘要并存入数据库。我们将把 Day 19 的 "测试接口" 变成真正的业务功能——让 AI 帮用户自动总结上传的文本内容。掌握 Prompt 工程：如何用 System Prompt 要求 AI 生成结构化输出。

---

## 💡 常见问题

**Q: 调用时报 `401 Unauthorized`？**

A: 检查 `application.properties` 里的 `spring.ai.openai.api-key` 是否正确：
1. Key 是否被误删或换行
2. Key 是否已过期/被删除（去 DeepSeek 平台确认）
3. 是否用了环境变量但环境变量没设置

**Q: 调用时报 `I/O error on POST request` 或超时？**

A: 网络问题：
1. 检查能否访问 `https://api.deepseek.com`（浏览器里打开看看）
2. 检查是否开了代理/VPN，导致请求被拦截
3. 在 `application.properties` 增加超时配置：
   ```properties
   spring.ai.openai.chat.options.timeout=60000
   ```

**Q: 返回的内容是英文的，怎么让它说中文？**

A: 在 `systemPrompt` 里明确要求：
```json
{
  "question": "...",
  "systemPrompt": "请用中文回答所有问题"
}
```

**Q: 回答太长了，怎么让它简短点？**

A: 在 System Prompt 里限制长度：
```json
{
  "systemPrompt": "回答请控制在 100 字以内，只讲重点"
}
```
