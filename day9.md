The user wants a summary of Day 9's content and knowledge points. Let me create a comprehensive summary.
## Day 9 总结

### 一、做了什么（改动清单）

| 文件 | 操作 | 内容 |
|------|------|------|
| `pom.xml` | 新增依赖 | Lombok、spring-boot-starter-validation |
| `Notebook.java` | 加注解 + 删代码 | +`@Data`、+`@NotBlank`、+`@Size`，删除手写 getter/setter |
| `Document.java` | 加注解 + 删代码 | +`@Data`、+`@NotBlank`，删除手写 getter/setter |
| `NotebookController.java` | 加注解 | +`@Valid`（create 和 update 方法） |
| `DocumentController.java` | 加注解 | +`@Valid`（create 方法） |
| `common/Result.java` | **新建** | 统一返回结果类（code + message + data） |
| `common/GlobalExceptionHandler.java` | **新建** | 全局异常处理器（拦截校验失败和 RuntimeException） |

### 二、核心知识点

**1. Lombok — 消灭样板代码**

```
原来：每个实体类手写 10+ 个 getter/setter，占一半代码
现在：一个 @Data 全搞定
```

`@Data` 是 Lombok 提供的"组合注解"，它等价于同时加了：
- `@Getter` — 自动生成所有 getter
- `@Setter` — 自动生成所有 setter
- `@ToString` — 自动生成 `toString()`
- `@EqualsAndHashCode` — 自动生成 `equals()` 和 `hashCode()`
- `@RequiredArgsConstructor` — 自动生成包含 `final` 字段的构造器

**2. Bean Validation — 参数校验三件套**

```
第 1 件：实体字段上写规则  →  @NotBlank(message = "不能为空")
第 2 件：Controller 参数上加开关  →  @Valid @RequestBody ...
第 3 件：全局异常处理器兜底  →  拦截 MethodArgumentNotValidException
```

三者缺一不可：
- 只写字段注解不加 `@Valid` → 校验不生效，形同虚设
- 加了 `@Valid` 但没有异常处理器 → 校验失败时返回 Spring 默认的丑陋错误页

**3. `@RestControllerAdvice` — 全局保镖**

```
用户请求 → Controller → @Valid 校验失败 → 抛出异常 → GlobalExceptionHandler 拦截 → 返回漂亮 JSON
                                                  ↑
                                        这一步没它就会返回 400 丑陋页面
```

**4. 统一返回格式 `Result<T>`**

为什么需要它：
- 前端不用猜"成功返回什么格式、失败又返回什么格式"
- 所有接口都返回统一的 `{ code, message, data }` 结构
- 前端只需要判断 `code === 200` 就知道成功还是失败

### 三、效果对比

```
改动前：
  发空名称 → 返回 Spring 默认一大坨英文错误堆栈

改动后：
  发空名称 → 返回 { "code": 400, "message": "name: 笔记本名称不能为空", "data": null }
```

### 四、项目当前文件结构（更新后）

```
notebook-clone/src/main/java/.../
├── NotebookCloneApplication.java    # 启动类
├── HelloController.java             # 测试 hello 接口
├── common/                          # 🆕 新增
│   ├── Result.java                  # 统一返回结果类
│   └── GlobalExceptionHandler.java  # 全局异常处理器
├── entity/
│   ├── Notebook.java                # ✅ 已加 @Data + 校验注解
│   └── Document.java                # ✅ 已加 @Data + 校验注解
├── repository/
│   ├── NotebookRepository.java
│   └── DocumentRepository.java
└── controller/
    ├── NotebookController.java      # ✅ 已加 @Valid
    └── DocumentController.java      # ✅ 已加 @Valid
```

---
## 📚 Day 10 知识要点总结

### 1. 代码清理 — 消除技术债务

**核心原则**：
- 注释掉的废代码就是"技术债务"，该删就删
- **Git 已经记录了一切**，不需要靠注释保留旧代码
- 找回历史代码：`git show 提交ID:文件路径` 或 IDE 的 Local History

---

### 2. Lombok @Data 全面使用

**@Data = @Getter + @Setter + @ToString + @EqualsAndHashCode**

| 方式 | 代码量 | 维护成本 | 推荐 |
|------|-------|---------|------|
| 手写 getter/setter | 多 | 高（每加字段要写2个方法）| ❌ |
| @Data 自动生成 | 无 | 低（编译时自动生成）| ✅ |

---

### 3. 解决 JSON 无限递归 — @JsonIgnore

**问题根源**：JPA 双向关联 + Jackson 序列化的经典冲突
```
Notebook → documents → Document → notebook → Notebook → ...（死循环）
```

**解决方案**：在"多"的一方（Document）加 `@JsonIgnore`
```java
@ManyToOne
@JoinColumn(name = "notebook_id")
@JsonIgnore  // 打断循环，序列化时忽略此字段
private Notebook notebook;
```

---

### 4. Controller 返回值统一 — Result<T>

**统一返回格式的重要性**：
- 前后端协作的基石
- 前端只需要一套解析逻辑

**Result<T> 结构**：
```json
{
  "code": 200,           // 业务状态码
  "message": "操作成功",  // 提示信息
  "data": { ... }        // 实际数据（泛型）
}
```

**使用方式**：
| 场景 | 写法 |
|------|------|
| 成功有数据 | `Result.success(data)` |
| 成功无数据 | `Result.success(null)` → `Result<Void>` |
| 失败 | `Result.fail("错误信息")` |

---

### 5. 代码规范细节

| 规范 | 说明 |
|------|------|
| package 语句位置 | 必须是文件第一个非注释行 |
| 项目名一致性 | HelloController 文案要与项目名保持一致 |
| 删除旧注释 | DocumentController 中注释掉的旧代码要清理 |

---

### 6. Git 提交规范

**提交信息格式**：
```
refactor: Day10 代码清理 — 统一 Result 返回格式、清理废代码、修复 JSON 循环引用
```

**类型说明**：
- `refactor`：重构（不改变功能，只改代码结构）
- `feat`：新功能
- `fix`：修复 bug

**版本标签**：`v0.1.0` 代表第一阶段里程碑

---

## 🎯 核心收获

| 能力 | 说明 |
|------|------|
| 代码洁癖 | 废代码及时清理，保持代码整洁 |
| 统一意识 | 项目风格要统一，不要混用不同写法 |
| 工程思维 | 从"能跑就行"进化到"可维护的代码" |
| 防御性编程 | @JsonIgnore 预防潜在问题 |

**Day 10 的本质**：不写新功能，专注让代码从"练手级别"变成"企业级别"。
