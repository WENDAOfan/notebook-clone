# Day 10：阶段复盘 — 代码清理与规范统一

> **核心目标**：Day 1-9 搭好了地基，但代码里遗留了不少学习痕迹（注释掉的旧代码、不统一的返回格式等）。Day 10 不写新功能，专注**清理 + 规范化**，让项目从"练手代码"变成"可维护的工程代码"。

---

## 背景问题清单（复盘时发现的问题）

| # | 问题 | 涉及文件 | 严重程度 |
|---|------|---------|---------|
| 1 | 实体类里留着大段注释掉的 getter/setter，又臭又长 | `Notebook.java`、`Document.java` | 🟡 中 |
| 2 | Controller 返回值不统一：有的返回 `Notebook`，有的返回 `String`，没用到 `Result<T>` | `NotebookController.java`、`DocumentController.java` | 🔴 高 |
| 3 | `Result.java` 手写了 getter/setter，既然已经引入 Lombok，应该用 `@Data` | `Result.java` | 🟡 中 |
| 4 | `HelloController` 的内容是"DevMind"项目的残留，和 notebook-clone 项目名不符 | `HelloController.java` | 🟢 低 |
| 5 | `NotebookRepository.java` 的 `package` 语句前面有一行注释，不规范 | `NotebookRepository.java` | 🟢 低 |
| 6 | `DocumentController.java` 里有注释掉的旧代码（第 33-36 行） | `DocumentController.java` | 🟢 低 |
| 7 | Controller 里直接返回实体类，会导致 JPA 的 `documents` 关联字段触发无限递归序列化（JSON 死循环） | `NotebookController.java` | 🔴 高 |

---

## 任务规划（共 6 步）

### 第 1 步：清理实体类 — 删除注释掉的废代码

**文件：** `Notebook.java`、`Document.java`

- 删除所有注释掉的 getter/setter（`Notebook.java` 第 38-53 行，`Document.java` 第 33-49 行）
- 保留有价值的注释（比如 `@OneToMany` 上面的说明）
- 目标：让实体类从 54 行 / 50 行 → 各瘦到约 30 行

**要学到的：** 代码里注释掉的代码就是"技术债务"，该删就删。Git 历史记录了一切，不需要靠注释保留旧代码。

---

### 第 2 步：Result.java 加 `@Data`，删掉手写的 getter/setter

**文件：** `Result.java`

- 加 `@Data` 注解和 `import lombok.Data`
- 删除手写的 6 个 getter/setter（第 32-37 行）
- 目标：保持风格统一，既然用了 Lombok 就全面用起来

---

### 第 3 步：解决 JSON 无限递归问题（关键！）

**文件：** `Notebook.java` 或 `Document.java`

**问题：** `Notebook` 有 `List<Document>`，`Document` 又有 `Notebook` 对象。当 Controller 返回 `Notebook` 时，Jackson 会尝试序列化：

```
Notebook → documents → Document → notebook → Notebook → documents → Document → ...
（无限循环，最终 StackOverflowError）
```

**解决方案：** 在 `Document.java` 的 `notebook` 字段上加 `@JsonIgnore`，打断循环：

```java
@ManyToOne
@JoinColumn(name = "notebook_id")
@JsonIgnore  // 序列化时不输出这个字段，避免死循环
private Notebook notebook;
```

**要学到的：** JPA 双向关联 + JSON 序列化的经典冲突，`@JsonIgnore` 是最简单的解决方案。

---

### 第 4 步：Controller 返回值统一为 `Result<T>`（核心改造）

**文件：** `NotebookController.java`、`DocumentController.java`

把所有接口的返回值从"裸返回实体/字符串"改成 `Result<T>` 包装。

#### NotebookController 改造示例：

```java
// 原来：
@GetMapping
public List<Notebook> getAllNotebooks() {
    return notebookRepository.findAll();
}

// 改成：
@GetMapping
public Result<List<Notebook>> getAllNotebooks() {
    return Result.success(notebookRepository.findAll());
}
```

需要改造的接口（共 8 个）：

| 文件 | 方法 | 原返回值 | 改为 |
|------|------|---------|------|
| NotebookController | `getAllNotebooks` | `List<Notebook>` | `Result<List<Notebook>>` |
| NotebookController | `createNotebook` | `Notebook` | `Result<Notebook>` |
| NotebookController | `updateNotebook` | `Notebook` | `Result<Notebook>` |
| NotebookController | `deleteNotebook` | `String` | `Result<Void>` |
| DocumentController | `createDocument` | `Document` | `Result<Document>` |
| DocumentController | `getDocumentsByNotebook` | `List<Document>` | `Result<List<Document>>` |
| DocumentController | `uploadDocumentFile` | `Document` | `Result<Document>` |
| DocumentController | `deleteDocument` | `String` | `Result<Void>` |

**要学到的：**
- `Result.success(data)` 包装成功响应
- `Result.fail(message)` 包装失败响应
- `Result<Void>` 用于没有返回数据的操作（如删除）
- 统一返回格式是前后端协作的基石

---

### 第 5 步：清理其他杂项

- `HelloController.java`：把 `"你好，DevMind！..."` 改成 `"你好，NotebookLM Clone！"`
- `NotebookRepository.java`：把 `package` 前面那行注释移到 `package` 后面
- `DocumentController.java`：删除第 33-36 行注释掉的旧代码

---

### 第 6 步：Git 提交 + 第一阶段完结

提交一次 Git，给第一阶段画上句号：

```bash
git add .
git commit -m "refactor: Day10 代码清理 — 统一 Result 返回格式、清理废代码、修复 JSON 循环引用"
git tag v0.1.0
```

`v0.1.0` 代表"第一阶段完成：核心数据模型 + CRUD + 参数校验"。

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `Notebook.java` | 删注释代码 | 删除 38-53 行注释掉的 getter/setter |
| `Document.java` | 删注释代码 + 加 `@JsonIgnore` | 删除废代码，解决 JSON 循环引用 |
| `Result.java` | 加 `@Data`，删手写 getter/setter | 保持 Lombok 风格统一 |
| `NotebookController.java` | 返回值改为 `Result<T>` | 4 个接口统一包装 |
| `DocumentController.java` | 返回值改为 `Result<T>` + 删旧注释 | 4 个接口统一包装 |
| `HelloController.java` | 改文案 | DevMind → NotebookLM Clone |
| `NotebookRepository.java` | 移动注释位置 | 代码规范 |

---

## 预期效果

```
改动前（混乱）：
  GET /api/notebooks → 直接返回 Notebook JSON 数组
  DELETE /api/notebooks/1 → 返回纯字符串 "成功！..."
  校验失败 → 被 GlobalExceptionHandler 拦截返回 Result 格式
  （三种不同的返回格式，前端根本没法统一处理）

改动后（统一）：
  GET /api/notebooks → { "code": 200, "message": "操作成功", "data": [...] }
  POST /api/notebooks → { "code": 200, "message": "操作成功", "data": {...} }
  DELETE /api/notebooks/1 → { "code": 200, "message": "删除成功", "data": null }
  校验失败 → { "code": 400, "message": "name: 笔记本名称不能为空", "data": null }
  （所有接口都是同一个格式，前端只需要一套解析逻辑）
```

---

## Day 10 完成标志

- [ ] 实体类里没有一行注释掉的废代码
- [ ] 所有 8 个业务接口返回 `Result<T>` 格式
- [ ] 用 Postman / api.http 测试所有接口，确认返回格式统一
- [ ] 没有 JSON 无限递归报错
- [ ] Git 提交 + v0.1.0 Tag
