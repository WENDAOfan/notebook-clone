# Day 17：阶段联调 — 完整认证流程测试与第二阶段收官

> **核心目标**：从零开始走完整个认证授权链路：注册 → 登录 → 获取 Token → 携带 Token 操作资源。掌握 `Authorization: Bearer <token>` 的标准用法，验证第二阶段所有功能（认证、授权、数据隔离）是否协同工作。

---

## 背景知识

### 为什么需要阶段联调？

Day 11 到 Day 16，我们逐步搭建了用户系统：
- Day 11：用户实体与三级关系
- Day 12：Spring Security + BCrypt 密码加密
- Day 13：JWT Token 生成与校验
- Day 14：JWT 过滤器 + Security 放行规则
- Day 15：写入时自动关联当前用户
- Day 16：数据隔离，只能操作自己的资源

**但这些都只是"零件"，Day 17 要验证它们组装在一起能不能跑通。**

就像你装好了自行车的轮子、链条、刹车，必须骑一圈才知道有没有问题。

### `Authorization: Bearer <token>` 是什么？

这是 **HTTP 标准认证格式**，属于 [RFC 6750](https://tools.ietf.org/html/rfc6750) 规范的 Bearer Token 用法：

```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
│               │
│               └── Token 类型（Bearer 表示"持有者令牌"）
└── HTTP 标准请求头名称
```

**为什么要用 Bearer？**
- `Basic` → 用户名:密码 的 Base64，每次请求都传密码，不安全
- `Bearer` → 只传 Token，密码只用在登录那一次

**完整请求示例**：
```http
GET /api/notebooks HTTP/1.1
Host: localhost:8080
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

---

## 任务规划（共 5 步）

---

### 第 1 步：清理测试环境 — 确保数据库状态干净

联调前先把之前的"实验数据"清理干净，避免 ID 混乱导致测试失败。

#### 1.1 方式一：重置数据库（推荐）

停止应用，修改 `application.properties`，让 Hibernate 重建表：

```properties
# 临时改成 create，启动后改回 update
spring.jpa.hibernate.ddl-auto=create
```

启动应用，表就会被重建。然后**立刻改回 `update`**：

```properties
spring.jpa.hibernate.ddl-auto=update
```

#### 1.2 方式二：手动清理（如果不想丢数据）

```sql
-- 谨慎执行！只删除测试数据
DELETE FROM documents WHERE id > 0;
DELETE FROM notebooks WHERE id > 0;
DELETE FROM users WHERE id > 0;
```

> ⚠️ **注意**：清理后所有之前的测试账号（zhangsan、lisi 等）都需要重新注册。

---

### 第 2 步：补全 api.http — 编写"一键联调"测试脚本

把完整流程写进 `api.http`，以后每次联调只需要从上到下点一遍。

**文件：** `notebook-clone/api.http`

在 Day 16 测试用例之后，新增 **Day 17 完整联调测试**：

```http
### ========== Day 17 阶段联调：完整认证流程测试 ==========

### Step 1: 注册用户A（zhangsan）
POST http://localhost:8080/api/auth/register
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}

### Step 2: 注册用户B（lisi）
POST http://localhost:8080/api/auth/register
Content-Type: application/json

{
  "username": "lisi",
  "password": "123456"
}

### Step 3: zhangsan 登录获取 Token
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}

# > {%
# client.global.set("zhangsan_token", response.body.data.token);
# %}

### Step 4: lisi 登录获取 Token
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "lisi",
  "password": "123456"
}

# > {%
# client.global.set("lisi_token", response.body.data.token);
# %}

### Step 5: zhangsan 携带 Token 创建笔记本
POST http://localhost:8080/api/notebooks
Content-Type: application/json
Authorization: Bearer {{zhangsan_token}}

{
  "name": "zhangsan的AI学习笔记",
  "description": "第二阶段联调测试"
}

### Step 6: zhangsan 查询自己的笔记本列表
GET http://localhost:8080/api/notebooks
Authorization: Bearer {{zhangsan_token}}

### Step 7: zhangsan 上传文档到笔记本（把 notebookId 改成实际返回的ID）
POST http://localhost:8080/api/documents/upload
Content-Type: multipart/form-data; boundary=WebAppBoundary
Authorization: Bearer {{zhangsan_token}}

--WebAppBoundary
Content-Disposition: form-data; name="notebookId"

1
--WebAppBoundary
Content-Disposition: form-data; name="file"; filename="测试文档.txt"
Content-Type: text/plain

这是Day17联调测试上传的文档内容。
Spring Boot + JWT + 数据隔离，全部打通！
--WebAppBoundary--

### Step 8: zhangsan 查询笔记本下的文档
GET http://localhost:8080/api/documents/notebook/1
Authorization: Bearer {{zhangsan_token}}

### Step 9: lisi 查询笔记本 — 应该看不到 zhangsan 的（数据隔离 ✅）
GET http://localhost:8080/api/notebooks
Authorization: Bearer {{lisi_token}}

### Step 10: lisi 尝试删除 zhangsan 的笔记本 — 应该失败（权限拦截 ✅）
DELETE http://localhost:8080/api/notebooks/1
Authorization: Bearer {{lisi_token}}

### Step 11: 不带 Token 访问接口 — 应该 401（认证拦截 ✅）
GET http://localhost:8080/api/notebooks

### Step 12: 错误格式 Authorization — 应该 401
GET http://localhost:8080/api/notebooks
Authorization: Basic zhangsan:123456
```

> 💡 **关于 `{{zhangsan_token}}`**：这是 VS Code REST Client 的变量语法。如果你的插件不支持，直接把 `{{zhangsan_token}}` 替换成真实的 token 字符串即可。

---

### 第 3 步：执行单用户完整链路测试

用 **zhangsan** 一个账号，验证"注册 → 登录 → 操作资源"整条链路是否通畅。

#### 3.1 注册账号

```http
POST http://localhost:8080/api/auth/register
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

**预期响应**：
```json
{
  "code": 200,
  "message": "注册成功",
  "data": {
    "id": 1,
    "username": "zhangsan"
  }
}
```

#### 3.2 登录获取 Token

```http
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

**预期响应**：
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9..."
  }
}
```

**记录这个 `token`，后续每一步都要用到。**

#### 3.3 携带 Token 创建笔记本

```http
POST http://localhost:8080/api/notebooks
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...（上一步的token）

{
  "name": "联调测试笔记本",
  "description": "测试"
}
```

**关键检查点**：
- ✅ 返回 200，不是 401（说明 Token 被正确识别）
- ✅ 返回的数据里 `user.username` 是 `zhangsan`（说明 Day 15 自动关联生效）

#### 3.4 携带 Token 上传文档

```http
POST http://localhost:8080/api/documents/upload
Content-Type: multipart/form-data; boundary=WebAppBoundary
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

--WebAppBoundary
Content-Disposition: form-data; name="notebookId"

1
--WebAppBoundary
Content-Disposition: form-data; name="file"; filename="test.txt"
Content-Type: text/plain

测试内容
--WebAppBoundary--
```

**关键检查点**：
- ✅ 返回 200
- ✅ 文档正确关联到笔记本和用户

---

### 第 4 步：执行多用户交叉验证（数据隔离终极测试）

注册第二个账号 **lisi**，验证 Day 16 的数据隔离是否真的生效。

#### 4.1 注册并登录 lisi

```http
POST http://localhost:8080/api/auth/register
Content-Type: application/json

{
  "username": "lisi",
  "password": "123456"
}
```

```http
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "lisi",
  "password": "123456"
}
```

#### 4.2 交叉验证清单

| 步骤 | 操作者 | 操作 | 预期结果 | 实际结果 |
|------|--------|------|---------|---------|
| 1 | zhangsan | 创建笔记本 A | 成功 | |
| 2 | zhangsan | `GET /api/notebooks` | 只能看到 A | |
| 3 | lisi | `GET /api/notebooks` | 空列表 `[]`（看不到 A） | |
| 4 | lisi | `DELETE /api/notebooks/A的id` | 失败（无权删除） | |
| 5 | lisi | `PUT /api/notebooks/A的id` | 失败（无权修改） | |
| 6 | lisi | 创建笔记本 B | 成功 | |
| 7 | lisi | `GET /api/notebooks` | 只能看到 B | |
| 8 | zhangsan | `GET /api/notebooks` | 只能看到 A | |

**全部通过 = 第二阶段所有功能协同正常。**

---

### 第 5 步：异常场景测试 — 验证安全防护

测试"坏请求"会不会被正确拦截。

#### 5.1 不带 Token 访问受保护接口

```http
GET http://localhost:8080/api/notebooks
# 没有 Authorization 头
```

**预期**：返回 401 Unauthorized

#### 5.2 携带过期/伪造 Token

```http
GET http://localhost:8080/api/notebooks
Authorization: Bearer this.is.a.fake.token
```

**预期**：返回 401，提示 Token 无效

#### 5.3 错误的 Authorization 格式

```http
GET http://localhost:8080/api/notebooks
Authorization: Basic zhangsan:123456
```

**预期**：返回 401，因为我们只支持 Bearer

#### 5.4 访问不存在的资源

```http
GET http://localhost:8080/api/notebooks/99999
Authorization: Bearer {{zhangsan_token}}
```

**预期**：返回 404 或业务错误码，不要返回 500

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `api.http` | **修改** | 新增 Day 17 完整联调测试脚本 |

> Day 17 主要是测试日，代码改动很少（甚至可以为零），重点是验证之前写的代码。

---

## Day 17 完成标志

- [ ] 数据库已清理，测试环境干净
- [ ] `api.http` 新增完整联调测试脚本（注册→登录→Token→创建→上传）
- [ ] zhangsan 能正常注册、登录、获取 Token
- [ ] 携带 Token 能成功创建笔记本和文档
- [ ] 创建的资源自动关联到当前用户（验证 Day 15）
- [ ] lisi 看不到 zhangsan 的笔记本（验证 Day 16 查询隔离）
- [ ] lisi 无法修改/删除 zhangsan 的笔记本（验证 Day 16 操作隔离）
- [ ] 不带 Token 访问返回 401（验证 Day 14 过滤器）
- [ ] 伪造 Token 返回 401（验证 Day 13 JWT 校验）
- [ ] Git 提交：`git commit -m "test: Day17 第二阶段联调，完整认证授权链路验证通过"`
- [ ] （可选）打阶段标签：`git tag v0.2.0`

---

## 核心知识点总结

### 1. 完整认证授权链路图

```
┌─────────┐    注册     ┌─────────┐
│  用户   │ ──────────→ │ 后端    │ ──→ 用户表存入 BCrypt 密码
└─────────┘             └─────────┘
     │
     │ 登录（用户名+密码）
     ↓
┌─────────┐   校验密码   ┌─────────┐
│  后端   │ ──────────→ │ 校验    │ ──→ 生成 JWT Token
└─────────┘             └─────────┘
     │
     │ 返回 Token
     ↓
┌─────────┐             ┌─────────┐
│  用户   │ ←────────── │ 后端    │
│ (前端)  │             └─────────┘
└─────────┘
     │
     │ 后续所有请求 Header 携带 Token
     │ Authorization: Bearer <token>
     ↓
┌─────────┐   JWT Filter   ┌─────────┐
│  后端   │ ─────────────→ │ 校验    │
│ (Filter)│                │ Token   │
└─────────┘                └─────────┘
     │                           │
     │ Token 有效                 │ Token 无效
     ↓                           ↓
┌─────────┐                ┌─────────┐
│ 存入    │                │ 返回 401│
│Security │                │ Unauthorized
│Context  │                └─────────┘
└─────────┘
     │
     ↓
┌─────────┐   查询/操作    ┌─────────┐
│Controller│ ──────────→ │ 数据库  │
│从Context │   只查自己的   │  WHERE  │
│取用户名  │              │ user_id=?
└─────────┘              └─────────┘
```

### 2. `Authorization` 头的三种常见类型

| 类型 | 格式 | 使用场景 | 安全性 |
|------|------|---------|--------|
| `Basic` | `Basic base64(用户:密码)` | 内部系统、开发测试 | ⚠️ 每次都传密码 |
| `Bearer` | `Bearer <JWT Token>` | 现代前后端分离项目 | ✅ 只传临时 Token |
| `Digest` | 挑战-应答机制 | 老旧系统兼容 | 中等 |

**我们的项目只用 `Bearer`**。

### 3. 第二阶段功能矩阵

| Day | 功能 | 验证方式（Day 17 测试点）|
|-----|------|------------------------|
| Day 11 | 用户实体与三级关系 | 创建用户后查询详情能看到结构 |
| Day 12 | BCrypt 密码加密 | 数据库里的密码是加密后的 |
| Day 13 | JWT Token 生成 | 登录返回 token 字符串 |
| Day 14 | JWT 过滤器 + 放行规则 | 不带 Token 返回 401 |
| Day 15 | 自动关联当前用户 | 创建资源后 user_id 正确 |
| Day 16 | 数据隔离 | 用户A看不到用户B的数据 |

### 4. 联调常见错误排查

| 现象 | 可能原因 | 排查方法 |
|------|---------|---------|
| 返回 401，提示未登录 | Token 没传或格式错误 | 检查 Header 是否是 `Authorization: Bearer xxx` |
| 返回 403 Forbidden | 有权限但无权访问该资源 | 检查是不是在操作别人的资源 |
| 登录成功但后续请求 401 | Token 过期 | 默认 24 小时过期，重新登录 |
| 创建资源后 user_id 为 null | Day 15 逻辑没生效 | 检查 Controller 是否从 SecurityContext 取用户 |
| 能看到别人的数据 | Day 16 隔离没生效 | 检查 Repository 是否用了 `findByUserId` |

---

## 下节预告（Day 18）

> **AI 灵魂注入**：注册大模型 API（推荐 DeepSeek 或智谱），引入 Spring AI 依赖。我们将正式进入第三阶段，给项目加上"智能问答"的核心能力！

---

## 🎉 第二阶段收官

恭喜你！从 Day 11 到 Day 17，你已经搭建了一套完整的**用户认证授权系统**：

- ✅ 用户注册登录（密码加密）
- ✅ JWT 无状态认证
- ✅ 自动关联当前用户
- ✅ 数据隔离（只能操作自己的资源）

这意味着你的项目已经从一个"开放式 demo"进化成了"多用户安全产品"。**这是进入 AI 功能前的最后一道门槛。**
