# Day 25: 异步生成摘要 — @Async 让上传接口不再卡顿

**目标**：引入 `@Async` 异步注解，改造文档上传接口——上传完成后立即返回，后台异步调用 AI 生成摘要，不阻塞用户等待。

---

## 当前状态

Day 24 完成后，文档上传和 AI 摘要生成的流程是这样的：

```
用户上传文件 → 后端保存文件 → 调用 AI 生成摘要 → 摘要存入数据库 → 返回响应
                                        ↑
                                   这里会阻塞 3-10 秒！
```

**问题**：AI 生成摘要需要等待大模型返回，上传接口会被阻塞，用户体验很差。

**Day 25 的解决方案**：上传后立即返回，摘要后台慢慢生成。

```
用户上传文件 → 后端保存文件 → 立即返回"上传成功，摘要生成中..."
                                        ↓
                              后台异步线程：调用 AI 生成摘要 → 存入数据库
```

---

## 步骤 1/5: 认知学习 — 同步 vs 异步（前 10 分钟，不写代码）

### 1.1 什么是同步（Synchronous）

代码一行一行执行，后面的任务必须等前面的任务完成后才能开始。

```java
// 同步模式：用户要一直等
public Document upload(MultipartFile file) {
    // 1. 保存文件（很快，100ms）
    Document doc = saveFile(file);
    
    // 2. 调用 AI 生成摘要（很慢，3-10 秒）← 用户在这里干等！
    String summary = aiChatService.generateSummary(doc.getContent());
    doc.setSummary(summary);
    
    // 3. 返回结果
    return documentRepository.save(doc);
}
```

**问题**：线程被占用，用户看着页面转圈，服务器并发能力也下降。

### 1.2 什么是异步（Asynchronous）

发起一个任务后**不等它完成**，立刻去做别的事。任务在后台自己跑，跑完了通知你（或者你自己来查）。

```java
// 异步模式：用户立刻收到响应
public Document upload(MultipartFile file) {
    // 1. 保存文件（很快）
    Document doc = saveFile(file);
    
    // 2. 提交异步任务：生成摘要（不等待，立刻返回）
    asyncSummaryService.generateSummaryAsync(doc.getId());
    
    // 3. 立刻返回：摘要还在生成中
    doc.setSummary("摘要生成中...");
    return doc;
}
```

### 1.3 Spring 的 `@Async` 是什么

Spring 提供的**声明式异步注解**，底层用线程池实现。

| 特性 | 说明 |
|:---|:---|
| 使用方式 | 在方法上加 `@Async`，在启动类/配置类上加 `@EnableAsync` |
| 返回值 | 可以返回 `void`（不关心结果）或 `Future<T>` / `CompletableFuture<T>`（关心结果）|
| 线程池 | 默认用 `SimpleAsyncTaskExecutor`（不推荐），建议自定义线程池 |
| 注意点 | `@Async` 方法必须在**另一个类中**被调用才生效（Spring AOP 代理机制）|

### 1.4 为什么默认线程池不好

Spring 默认的 `SimpleAsyncTaskExecutor` 每次创建新线程，高并发时会耗尽资源。

**自定义线程池**：
```java
@Bean(name = "taskExecutor")
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(5);      // 核心线程数
    executor.setMaxPoolSize(10);      // 最大线程数
    executor.setQueueCapacity(100);   // 队列容量
    executor.setThreadNamePrefix("async-");
    executor.initialize();
    return executor;
}
```

| 参数 | 含义 |
|:---|:---|
| `corePoolSize` | 常驻线程数，即使空闲也保留 |
| `maxPoolSize` | 最大线程数，队列满了才创建新线程 |
| `queueCapacity` | 等待队列大小，满了才创建超过 core 的线程 |

---

## 步骤 2/5: 开启异步支持 + 配置线程池

### 2.1 启动类添加 @EnableAsync

在 `NotebookCloneApplication.java` 上添加注解：

```java
package com.example.notebook_clone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;  // Day 25 新增

@SpringBootApplication
@EnableAsync  // Day 25 新增：开启异步支持
public class NotebookCloneApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotebookCloneApplication.class, args);
    }

}
```

### 2.2 创建异步配置类

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/config/AsyncConfig.java`

```java
package com.example.notebook_clone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "aiTaskExecutor")
    public Executor aiTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);          // 核心线程数：同时跑 2 个 AI 任务
        executor.setMaxPoolSize(5);           // 最大线程数：最多 5 个
        executor.setQueueCapacity(50);        // 队列：排队等执行的最多 50 个
        executor.setThreadNamePrefix("ai-async-");  // 线程名前缀，方便日志排查
        executor.setRejectedExecutionHandler(new ThreadPoolTaskExecutor.CallerRunsPolicy()); // 队列满时，让调用者线程自己执行
        executor.initialize();
        return executor;
    }
}
```

**参数选择思路**：
- `corePoolSize=2`：AI 调用依赖外部 API，并发太高容易触发限流
- `maxPoolSize=5`：峰值时最多 5 个线程同时调用 AI
- `queueCapacity=50`：允许短暂堆积，用户连续上传多个文档时不会丢任务

---

## 步骤 3/5: 创建异步摘要服务

### 3.1 新建 AsyncSummaryService

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/service/AsyncSummaryService.java`

```java
package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class AsyncSummaryService {

    private final AiChatService aiChatService;
    private final DocumentRepository documentRepository;

    /**
     * 异步生成文档摘要
     * @param documentId 文档 ID
     */
    @Async("aiTaskExecutor")  // 使用自定义线程池
    public void generateSummaryAsync(Long documentId) {
        log.info("[异步摘要] 开始生成文档 {} 的摘要", documentId);

        try {
            // 1. 查询文档
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null || document.getContent() == null || document.getContent().isEmpty()) {
                log.warn("[异步摘要] 文档 {} 不存在或内容为空，跳过", documentId);
                return;
            }

            // 2. 调用 AI 生成摘要
            String summary = aiChatService.generateSummary(document.getContent());

            // 3. 保存摘要
            document.setSummary(summary);
            documentRepository.save(document);

            log.info("[异步摘要] 文档 {} 摘要生成成功", documentId);

        } catch (Exception e) {
            log.error("[异步摘要] 文档 {} 摘要生成失败: {}", documentId, e.getMessage());
            // 可以在这里记录失败状态，后续重试
        }
    }
}
```

### 3.2 关于 @Async 的重要注意点

⚠️ **`@Async` 方法不能在本类中被调用**！

```java
// ❌ 错误：同类中调用，@Async 不生效
@Service
public class DocumentService {
    public void upload() {
        generateSummaryAsync();  // 直接调用，不走代理，还是同步！
    }
    
    @Async
    public void generateSummaryAsync() { ... }
}

// ✅ 正确：注入另一个 Service 来调用
@Service
public class DocumentService {
    @Autowired
    private AsyncSummaryService asyncSummaryService;  // 注入另一个类
    
    public void upload() {
        asyncSummaryService.generateSummaryAsync();  // 走代理，真正异步
    }
}
```

---

## 步骤 4/5: 改造文档上传接口

### 4.1 修改 DocumentService 的上传方法

找到文档上传的核心方法（通常在 `DocumentService` 或 `DocumentController` 中），改造如下：

```java
@Service
@RequiredArgsConstructor
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final AsyncSummaryService asyncSummaryService;  // Day 25 新增：注入异步服务
    private final AiChatService aiChatService;              // 保留，用于同步生成的场景

    /**
     * 上传文档（异步生成摘要版本）
     */
    public Document uploadDocument(MultipartFile file, Notebook notebook, User user) {
        // 1. 解析文件内容（原有逻辑不变）
        String content = extractText(file);

        // 2. 创建文档实体，先不生成摘要
        Document document = new Document();
        document.setTitle(file.getOriginalFilename());
        document.setContent(content);
        document.setNotebook(notebook);
        document.setUser(user);
        document.setSummary("摘要生成中...");  // Day 25：先给个占位符
        document.setSize(file.getSize());

        // 3. 保存文档
        Document saved = documentRepository.save(document);

        // 4. 提交异步任务生成摘要（不阻塞返回）
        asyncSummaryService.generateSummaryAsync(saved.getId());

        // 5. 立刻返回，用户不用等 AI
        return saved;
    }

    // 保留原有同步方法（供需要同步场景调用）
    public Document uploadDocumentSync(MultipartFile file, Notebook notebook, User user) {
        // ... 原有同步逻辑
    }
}
```

### 4.2 Controller 层无需大改

Controller 保持原有逻辑即可，因为异步是在 Service 层处理的：

```java
@PostMapping("/upload")
public Result<Document> upload(
        @RequestParam("file") MultipartFile file,
        @RequestParam("notebookId") Long notebookId) {
    
    // 获取当前用户和笔记本（原有逻辑）
    User user = getCurrentUser();
    Notebook notebook = notebookRepository.findById(notebookId).orElseThrow();
    
    // 上传文档（现在内部是异步生成摘要）
    Document doc = documentService.uploadDocument(file, notebook, user);
    
    return Result.success(doc);  // 立刻返回，summary 字段可能是"摘要生成中..."
}
```

---

## 步骤 5/5: 前端适配 — 显示"摘要生成中"状态

### 5.1 后端增加摘要状态字段（可选优化）

如果想让前端更精确地知道摘要状态，可以给 Document 实体加一个状态字段：

```java
// Document.java 新增字段
@Column
private String summaryStatus = "pending";  // pending / generating / completed / failed
```

异步服务中更新状态：
```java
@Async("aiTaskExecutor")
public void generateSummaryAsync(Long documentId) {
    // 开始生成
    updateStatus(documentId, "generating");
    
    try {
        // ... 生成摘要
        updateStatus(documentId, "completed");
    } catch (Exception e) {
        updateStatus(documentId, "failed");
    }
}
```

### 5.2 前端显示逻辑

在 `app.js` 的文档列表渲染中，根据 summary 内容判断状态：

```javascript
function renderDocumentList() {
    // ... 原有逻辑
    
    const summaryHtml = doc.summary 
        ? (doc.summary === '摘要生成中...' 
            ? `<span class="summary-label">🤖 摘要：</span><span class="summary-text summary-loading">正在生成摘要...</span>`
            : `<span class="summary-label">🤖 摘要：</span><span class="summary-text">${escapeHtml(doc.summary)}</span>`
          )
        : '';
    
    // ... 渲染
}
```

### 5.3 添加 CSS 动画（可选）

```css
.summary-loading {
    color: #999;
    font-style: italic;
    animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
}
```

---

## 测试验证

### 测试 1：上传大文件，观察响应速度
- 上传一个 500KB 的 txt 文件
- 预期：上传接口在 200ms 内返回（之前要等 3-10 秒）
- 观察返回的 JSON 中 `summary` 字段为 `"摘要生成中..."`

### 测试 2：查看日志确认异步执行
- 观察后端日志，应该看到类似：
  ```
  [异步摘要] 开始生成文档 42 的摘要
  [异步摘要] 文档 42 摘要生成成功
  ```
- 注意线程名应该是 `ai-async-1`、`ai-async-2` 等

### 测试 3：并发上传多个文件
- 快速上传 5 个文件
- 预期：5 个文件都很快返回，摘要依次在后台生成
- 观察线程池是否正常工作（最多同时跑 2 个 AI 任务，其余排队）

---

## 今日复盘 Checklist

- [ ] 理解同步 vs 异步的核心区别（等 vs 不等）
- [ ] 理解 `@Async` 的使用方式（注解 + 线程池 + 跨类调用）
- [ ] 理解线程池三个核心参数：`corePoolSize`、`maxPoolSize`、`queueCapacity`
- [ ] `@EnableAsync` 已添加到启动类
- [ ] `AsyncConfig` 配置类已创建，自定义了 `aiTaskExecutor` 线程池
- [ ] `AsyncSummaryService` 已创建，使用 `@Async("aiTaskExecutor")`
- [ ] `DocumentService.uploadDocument()` 已改造为异步生成摘要
- [ ] 上传接口响应明显变快（从几秒降到几百毫秒）
- [ ] 日志中看到 `ai-async-` 前缀的线程名
- [ ] 前端能看到"摘要生成中..."的提示

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `@Async` 没生效，还是同步执行 | 同类中直接调用，没走 Spring 代理 | 注入另一个 Service 类来调用 |
| 线程池不生效，用的是默认线程 | `@Async` 没指定线程池名称 | 写 `@Async("aiTaskExecutor")`，不是 `@Async` |
| 异常吞掉了，看不到错误日志 | 异步线程的异常不会抛给调用方 | 在 `@Async` 方法内部 try-catch 并记录日志 |
| 并发太高，AI API 被限流 | 线程池设置太大 | 降低 `corePoolSize`，增加 `queueCapacity` |

---

## 后续衔接

Day 25 完成后，文档上传体验大幅提升。Day 26 将引入**重试机制**和**内容安全拦截**，让 AI 调用更健壮：
- AI 调用失败时自动重试 3 次
- 对上传内容进行敏感词过滤
- 记录 AI Token 用量，为后续限流做准备

> 💡 **计划中的原始描述**：
> Day 25：引入 `@Async`，实现文档上传后异步生成摘要（不阻塞上传接口）。理解同步与异步；掌握 Spring 线程池配置。
