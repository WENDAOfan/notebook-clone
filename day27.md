# Day 27: Redis 入门 + Docker 部署 — 从零理解内存缓存

**目标**：安装 Redis（通过 Docker），Spring Boot 集成 Redis，完成第一个缓存读写。从"完全不了解"到"能用起来"。

---

## 当前状态

Day 26 完成后，AI 调用已具备重试机制和 Token 统计。但每次问答都要重新调用大模型，即使问同样的问题：

```
用户问："Spring Boot 是什么？" → 调用 DeepSeek → 花费 Token → 返回回答
用户再问："Spring Boot 是什么？" → 又调用 DeepSeek → 又花费 Token → 返回几乎一样的回答
                                       ↑
                                  浪费！完全一样的结果，为什么要再花钱？
```

**Day 27 的解决方案**：引入 Redis 做缓存，先把 Redis 跑起来。

---

## 步骤 1/6: 认知学习 — 什么是 Redis（前 10 分钟，不写代码）

### 1.1 从"数据库"说起

你已经用过 MySQL，它是一种**磁盘数据库**——数据存在硬盘上，读写要经过磁盘 I/O，速度受物理硬件限制。

```
应用 → MySQL（磁盘） → 读/写 → 硬盘旋转 → 磁头寻道 → 返回数据
                    ↑
               即使很快的 SSD，一次查询也要几毫秒~几十毫秒
```

**Redis** 是一种**内存数据库**——数据存在内存（RAM）中，读写速度是纳秒级。

```
应用 → Redis（内存） → 读/写 → 直接访问内存 → 返回数据
                    ↑
               一次读写只需 0.1 毫秒，比 MySQL 快 100~1000 倍
```

### 1.2 内存 vs 磁盘：核心区别

|| 特性 | 内存（Redis） | 磁盘（MySQL） |
|:---|:---|:---|
| **速度** | 极快（纳秒级） | 较慢（毫秒级） |
| **容量** | 贵且小（几 GB~几十 GB） | 便宜且大（几百 GB~几 TB） |
| **持久性** | 断电就丢（需额外配置持久化） | 断电不丢 |
| **数据结构** | 简单（键值对） | 复杂（表、行、列、关系） |
| **查询能力** | 几乎只能按 key 查 | 支持复杂 SQL 查询 |
| **适用场景** | 缓存、计数器、限流、会话存储 | 业务数据持久存储 |

**一句话总结**：Redis 不是要替代 MySQL，而是坐在 MySQL 前面当"缓存层"。

```
应用请求数据
   ↓
先查 Redis → 命中 → 直接返回（快！）
   ↓ 没命中
查 MySQL → 写入 Redis（下次就命中了）→ 返回
```

### 1.3 Redis 的核心数据结构

Redis 全称 **RE**mote **DI**ctionary **S**erver（远程字典服务器），本质上就是一个超大的 `HashMap`。但它支持多种值类型：

|| 类型 | 类比 | 使用场景 |
|:---|:---|:---|
| **String** | `Map<String, String>` | 缓存 JSON、计数器、限流计数 |
| **List** | `Map<String, LinkedList>` | 消息队列、最新列表 |
| **Set** | `Map<String, HashSet>` | 去重、共同好友 |
| **Hash** | `Map<String, Map<String, String>>` | 存对象属性（用户信息） |
| **ZSet**（有序集合） | `Map<String, TreeSet>` | 排行榜 |

**Day 27 只用 String 类型**，其余类型在后续场景中按需学习。

### 1.4 Redis 的"过期时间"——缓存的核心能力

Redis 可以给每个 key 设置过期时间（TTL，Time To Live），到期自动删除。这是它做缓存的杀手锏：

```redis
SET ai:answer:abc123 "Spring Boot 是..." EX 3600   # 3600 秒 = 1 小时后自动删除
```

为什么这很重要？
- 缓存不能永不过期（数据会变，缓存会"陈旧"）
- 缓存不能手动删除（管理成本太高）
- **自动过期 = 省心的缓存策略**

### 1.5 本项目中的 Redis 用途预览

|| 阶段 | 用途 | 对应 Day |
|:---|:---|:---|
| Day 27 | 安装 Redis，完成基本读写 | 今天 |
| Day 28 | 缓存 AI 回答——相同问题直接返回缓存 | 下一次 |
| Day 29 | 限流——Redis 计数器控制用户 AI 调用频率 | 后续 |

---

## 步骤 2/6: 认知学习 — 什么是 Docker（继续，不写代码）

### 2.1 为什么要学 Docker

安装 Redis 有两种方式：
1. **直接安装**：下载 Redis Windows 版 → 解压 → 配置 → 启动（Windows 上 Redis 官方不支持，只能用非官方移植版，坑多）
2. **Docker 安装**：一条命令搞定，环境隔离，和 Linux 生产环境一致

**Docker 是今天必经的桥梁**——不会 Docker，你在 Windows 上装 Redis 会踩很多坑。

### 2.2 Docker 是什么——用"集装箱"比喻

想象你是一个货主，要把货物运到世界各地：

```
没有 Docker 的世界：
  货物 → 在码头拆开 → 重新打包 → 换船 → 再拆开 → 再打包 → ...
  ↑ 每换一次环境就要重新适配，经常出问题

有 Docker 的世界：
  货物 → 装进标准集装箱 → 不管到哪个码头，起重机直接吊走 → 完好到达
  ↑ 集装箱屏蔽了环境差异
```

**Docker 就是软件世界的"集装箱"**：把软件和它的运行环境打包在一起，不管在谁的电脑上都能一样运行。

### 2.3 Docker 的三个核心概念

|| 概念 | 类比 | 说明 |
|:---|:---|:---|
| **Image（镜像）** | 安装光盘 | 一个只读的模板，包含软件+运行环境。如 `redis:7` 就是一个 Redis 镜像 |
| **Container（容器）** | 运行中的程序 | 从镜像启动的一个运行实例。一个镜像可以启动多个容器 |
| **Registry（仓库）** | App Store | 存放镜像的地方，最大的公共仓库是 Docker Hub（hub.docker.com） |

```
从 Docker Hub 拉取镜像       从镜像启动容器
     ↓                           ↓
docker pull redis:7    →    docker run redis:7
     ↓                           ↓
  本地有了 Image             本地有了运行中的 Redis
```

### 2.4 Docker vs 虚拟机

| | Docker 容器 | 虚拟机（VMware） |
|:---|:---|:---|
| 启动速度 | 秒级 | 分钟级 |
| 资源占用 | MB 级 | GB 级 |
| 原理 | 共享宿主机内核 | 模拟完整操作系统 |
| 隔离性 | 进程级隔离 | 系统级隔离 |

**对我们来说**：Docker 足够隔离，又轻量快速，是开发环境的最佳选择。

### 2.5 Docker 安装验证

> 以下命令均在 **PowerShell** 或 **CMD** 中执行

```powershell
# 1. 检查 Docker 是否已安装
docker --version

# 2. 检查 Docker 是否正在运行
docker info

# 3. 如果没安装，去官网下载 Docker Desktop for Windows
#    https://www.docker.com/products/docker-desktop/
#    安装后重启电脑，Docker Desktop 会自动启动
```

**如果 `docker --version` 能输出版本号，说明已安装**。如果没安装，先去安装 Docker Desktop。

---

## 步骤 3/6: 用 Docker 安装并运行 Redis（动手操作）

### 3.1 一条命令启动 Redis

```powershell
docker run -d --name my-redis -p 6379:6379 redis:7
```

**逐字解释**：

|| 部分 | 含义 |
|:---|:---|
| `docker run` | 从镜像创建并启动一个容器 |
| `-d` | 后台运行（detached 模式），不占用当前终端 |
| `--name my-redis` | 给容器起个名字叫 `my-redis`（方便后续管理） |
| `-p 6379:6379` | 端口映射：宿主机 6379 → 容器 6379（Redis 默认端口） |
| `redis:7` | 使用 Redis 7.x 版本的镜像（首次会自动从 Docker Hub 下载） |

> ⚠️ 首次执行 `docker run` 时，Docker 需要下载 Redis 镜像（约 130MB），可能需要几分钟，取决于网速。如果下载慢，可以配置国内镜像源（见踩坑记录）。

### 3.2 验证 Redis 是否运行

```powershell
# 查看运行中的容器
docker ps

# 应该看到类似输出：
# CONTAINER ID   IMAGE     ...   STATUS          PORTS                    NAMES
# a1b2c3d4e5f6   redis:7   ...   Up 30 seconds   0.0.0.0:6379->6379/tcp   my-redis
```

### 3.3 进入 Redis 命令行测试

```powershell
# 进入 Redis 容器内部的命令行
docker exec -it my-redis redis-cli
```

进入后你会看到 `127.0.0.1:6379>` 提示符，试着执行：

```redis
127.0.0.1:6379> SET name "notebook-clone"
OK

127.0.0.1:6379> GET name
"notebook-clone"

127.0.0.1:6379> SET temp "hello" EX 60
OK

127.0.0.1:6379> TTL temp
(integer) 58

127.0.0.1:6379> EXIT
```

**恭喜！Redis 已经跑起来了。** 上面演示了：
- `SET key value` — 存数据
- `GET key` — 取数据
- `SET key value EX 秒数` — 存数据并设置过期时间
- `TTL key` — 查看剩余生存时间（秒）

### 3.4 Docker 常用管理命令

```powershell
docker ps                  # 查看运行中的容器
docker ps -a               # 查看所有容器（含已停止的）
docker stop my-redis       # 停止容器
docker start my-redis      # 启动已停止的容器
docker restart my-redis    # 重启容器
docker rm my-redis         # 删除容器（需先停止）
docker logs my-redis       # 查看容器日志
```

> 💡 **重要**：每次电脑重启后，Docker Desktop 需要手动启动。Redis 容器不会自动启动，需要 `docker start my-redis`。如果想设置自动启动，创建容器时加 `--restart=always` 参数。

---

## 步骤 4/6: Spring Boot 集成 Redis（开始写代码）

### 4.1 添加 Maven 依赖

在 `pom.xml` 的 `<dependencies>` 中新增：

```xml
<!-- ===== Day 27 新增：Spring Data Redis ===== -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
<!-- ========================================== -->
```

**这个依赖包含了什么**：
- `spring-data-redis`：Spring 对 Redis 的抽象层
- `lettuce-core`：Redis 的 Java 客户端（Spring Boot 默认使用 Lettuce，另一个选择是 Jedis）
- 连接池管理、序列化、自动配置

### 4.2 配置 Redis 连接

在 `application.properties` 中添加：

```properties
# ===== Day 27 新增：Redis 配置 =====
spring.data.redis.host=localhost
spring.data.redis.port=6379
# spring.data.redis.password=        # 本地开发无密码，生产环境要设
# spring.data.redis.database=0       # 默认用 0 号数据库，Redis 有 0-15 共 16 个库
# ====================================
```

### 4.3 创建 Redis 配置类

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/config/RedisConfig.java`

```java
package com.example.notebook_clone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * Redis 配置类
 * 
 * 为什么需要配置？Spring Boot 默认的 RedisTemplate 使用 JDK 序列化，
 * 存到 Redis 里的值是一串乱码（类似 \xAC\xED\x00\x05...），不方便查看和调试。
 * 我们改成 String 序列化 key + JSON 序列化 value，可读性好。
 */
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        // Key 使用 String 序列化
        StringRedisSerializer stringSerializer = new StringRedisSerializer();
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);

        // Value 使用 JSON 序列化
        GenericJackson2JsonRedisSerializer jsonSerializer = new GenericJackson2JsonRedisSerializer();
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);

        template.afterPropertiesSet();
        return template;
    }
}
```

**为什么要自定义序列化**：

```
默认 JDK 序列化存入 Redis：
  key: \xAC\xED\x00\x05t\x00\x0Amykey
  val: \xAC\xED\x00\x05sr\x00\x12java.lang.String...

自定义 String + JSON 序列化存入 Redis：
  key: mykey
  val: "hello world"  或  {"name":"notebook","count":42}
```

用 `redis-cli` 查看 data 时，自定义序列化的可读性好得多。

### 4.4 创建 Redis 服务类

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/service/RedisService.java`

```java
package com.example.notebook_clone.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * Redis 服务类
 * 
 * 封装 RedisTemplate 的常用操作，让业务代码更简洁。
 * 所有 Redis 操作都通过这个类统一管理。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedisService {

    private final RedisTemplate<String, Object> redisTemplate;

    // ========== 基本读写 ==========

    /**
     * 存入缓存（永不过期）
     */
    public void set(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
        log.debug("[Redis] SET {} = {}", key, value);
    }

    /**
     * 存入缓存（带过期时间）
     * @param key     缓存键
     * @param value   缓存值
     * @param timeout 过期时间
     * @param unit    时间单位
     */
    public void set(String key, Object value, long timeout, TimeUnit unit) {
        redisTemplate.opsForValue().set(key, value, timeout, unit);
        log.debug("[Redis] SET {} = {} (TTL: {} {})", key, value, timeout, unit);
    }

    /**
     * 读取缓存
     */
    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    /**
     * 读取缓存（带类型转换）
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> clazz) {
        Object value = redisTemplate.opsForValue().get(key);
        if (value == null) {
            return null;
        }
        return (T) value;
    }

    /**
     * 删除缓存
     */
    public Boolean delete(String key) {
        Boolean result = redisTemplate.delete(key);
        log.debug("[Redis] DEL {} → {}", key, result);
        return result;
    }

    // ========== 缓存判断 ==========

    /**
     * 判断缓存是否存在
     */
    public Boolean hasKey(String key) {
        return redisTemplate.hasKey(key);
    }

    /**
     * 设置过期时间
     */
    public Boolean expire(String key, long timeout, TimeUnit unit) {
        return redisTemplate.expire(key, timeout, unit);
    }

    /**
     * 获取剩余过期时间（秒）
     */
    public Long getExpire(String key) {
        return redisTemplate.getExpire(key);
    }
}
```

### 4.5 理解 RedisTemplate 的核心 API

`RedisTemplate` 是 Spring Data Redis 提供的核心操作类，它的 API 按数据类型分组：

|| 方法 | 操作的 Redis 类型 | 常用操作 |
|:---|:---|:---|
| `opsForValue()` | String | `set()`, `get()`, `setIfAbsent()` |
| `opsForHash()` | Hash | `put()`, `get()`, `entries()` |
| `opsForList()` | List | `leftPush()`, `rightPop()` |
| `opsForSet()` | Set | `add()`, `members()` |
| `opsForZSet()` | ZSet | `add()`, `range()` |

**Day 27 只用 `opsForValue()`**，对应 Redis 的 String 类型操作。

---

## 步骤 5/6: 编写测试接口验证 Redis 连通（动手验证）

### 5.1 创建 Redis 测试接口

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/controller/RedisTestController.java`

```java
package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.service.RedisService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Redis 测试接口
 * 
 * 仅用于开发阶段验证 Redis 是否连通，生产环境应删除或加权限控制。
 */
@RestController
@RequestMapping("/test/redis")
@RequiredArgsConstructor
public class RedisTestController {

    private final RedisService redisService;

    /**
     * 测试写入
     * POST /test/redis/set?key=hello&value=world
     */
    @PostMapping("/set")
    public Result<String> set(@RequestParam String key, @RequestParam String value) {
        redisService.set(key, value, 60, TimeUnit.MINUTES);  // 60 分钟过期
        return Result.success("写入成功: " + key + " = " + value);
    }

    /**
     * 测试读取
     * GET /test/redis/get?key=hello
     */
    @GetMapping("/get")
    public Result<Object> get(@RequestParam String key) {
        Object value = redisService.get(key);
        if (value == null) {
            return Result.success("缓存不存在或已过期: " + key);
        }
        return Result.success(value);
    }

    /**
     * 测试删除
     * DELETE /test/redis/delete?key=hello
     */
    @DeleteMapping("/delete")
    public Result<String> delete(@RequestParam String key) {
        Boolean deleted = redisService.delete(key);
        return Result.success(deleted ? "删除成功: " + key : "键不存在: " + key);
    }

    /**
     * 综合连通测试
     * GET /test/redis/ping
     */
    @GetMapping("/ping")
    public Result<Map<String, Object>> ping() {
        Map<String, Object> result = new HashMap<>();
        
        // 写入测试
        String testKey = "redis:ping:" + System.currentTimeMillis();
        redisService.set(testKey, "pong", 10, TimeUnit.SECONDS);
        
        // 读取测试
        Object value = redisService.get(testKey);
        
        // 过期时间测试
        Long ttl = redisService.getExpire(testKey);
        
        result.put("write", "OK");
        result.put("read", value);
        result.put("ttl", ttl + " 秒");
        result.put("status", "Redis 连接正常！");
        
        // 清理
        redisService.delete(testKey);
        
        return Result.success(result);
    }
}
```

### 5.2 启动项目验证

1. 确保 Redis 容器正在运行：`docker ps` 看到 `my-redis`
2. 启动 Spring Boot 项目
3. 观察启动日志，不应有 Redis 连接错误

### 5.3 用 Apifox / 浏览器测试

```
测试 1：综合连通测试
GET http://localhost:8080/test/redis/ping
预期返回：
{
  "code": 200,
  "data": {
    "write": "OK",
    "read": "pong",
    "ttl": "9 秒",
    "status": "Redis 连接正常！"
  }
}

测试 2：手动写入/读取
POST http://localhost:8080/test/redis/set?key=myname&value=notebook
GET  http://localhost:8080/test/redis/get?key=myname
预期：返回 "notebook"

测试 3：用 redis-cli 验证
docker exec -it my-redis redis-cli
127.0.0.1:6379> GET myname
127.0.0.1:6379> KEYS *
```

---

## 步骤 6/6: 理解缓存 Key 的命名规范（认知收尾）

### 6.1 为什么 Key 命名要规范

Redis 是一个"大字典"，所有数据都平铺在一起。如果 Key 随意命名，会混乱：

```
❌ 不规范：user:1, doc:summary:5, ai_answer_abc, temp123
✅ 规范：  app:module:entity:id
```

### 6.2 本项目的 Key 命名约定

```
ai:answer:{questionHash}         — AI 回答缓存（Day 28 使用）
ai:ratelimit:{userId}            — 用户 AI 调用限流计数（Day 29 使用）
doc:summary:{documentId}         — 文档摘要缓存
```

**规则**：
- 用冒号 `:` 分隔层级（Redis 社区惯例）
- 第一段是业务域（`ai`、`doc`、`user`）
- 越具体的标识越往后放

### 6.3 缓存 Key 的过期时间策略

|| 场景 | 建议过期时间 | 原因 |
|:---|:---|:---|
| AI 问答缓存 | 1~24 小时 | 用户可能隔天再问同样问题，但回答不应太陈旧 |
| 限流计数器 | 和限流窗口一致（如 1 小时） | 窗口结束自动清零 |
| 会话数据 | 30 分钟~2 小时 | 用户不活跃后自动清理 |

---

## 改动文件总览

|| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `pom.xml` | 加依赖 | `spring-boot-starter-data-redis` |
| `application.properties` | 加配置 | Redis 连接信息 |
| `RedisConfig.java` | 新建 | Redis 序列化配置 |
| `RedisService.java` | 新建 | Redis 操作封装类 |
| `RedisTestController.java` | 新建 | 测试接口（开发阶段用） |

---

## 今日知识图谱

```
Docker（容器化工具）
  ├── Image（镜像）—— 软件的安装包
  ├── Container（容器）—— 运行中的实例
  └── Registry（仓库）—— 存放镜像的地方
       │
       ↓ 用 Docker 安装
Redis（内存数据库）
  ├── String 类型 —— 缓存 AI 回答
  ├── 过期时间 TTL —— 自动失效
  └── Key 命名规范 —— ai:answer:{hash}
       │
       ↓ Spring Boot 集成
Spring Data Redis
  ├── RedisTemplate —— 核心操作类
  ├── opsForValue() —— String 操作
  └── 序列化配置 —— String + JSON
```

---

## 测试验证清单

### 环境验证
- [ ] Docker Desktop 已安装并运行
- [ ] `docker --version` 输出版本号
- [ ] Redis 容器已启动（`docker ps` 可见 `my-redis`）
- [ ] `redis-cli` 能正常 SET/GET

### 代码验证
- [ ] `spring-boot-starter-data-redis` 依赖已添加
- [ ] `application.properties` 已配置 Redis 连接
- [ ] `RedisConfig.java` 已创建，自定义了序列化
- [ ] `RedisService.java` 已创建，封装了常用操作
- [ ] 项目启动无报错（Redis 连接成功）
- [ ] `/test/redis/ping` 接口返回"Redis 连接正常"
- [ ] `/test/redis/set` 和 `/test/redis/get` 能正常读写
- [ ] `redis-cli` 中能看到 Spring Boot 写入的数据

---

## 今日复盘 Checklist

- [ ] 理解内存数据库 vs 磁盘数据库的核心区别
- [ ] 理解 Redis 的 5 种数据类型，知道 String 最常用
- [ ] 理解 TTL（过期时间）是缓存的核心能力
- [ ] 理解 Docker 的三个核心概念：镜像、容器、仓库
- [ ] 能用 Docker 启动/停止/管理 Redis 容器
- [ ] 理解 `RedisTemplate` 的 `opsForValue()` 基本用法
- [ ] 理解为什么需要自定义 Redis 序列化（可读性）
- [ ] 理解缓存 Key 的命名规范（冒号分隔、业务域前缀）

---

## 踩坑记录

|| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `docker run` 报错 "docker: not found" | Docker 未安装或未启动 | 安装 Docker Desktop 并确保后台运行 |
| `docker run` 下载镜像很慢 | Docker Hub 服务器在国外 | 配置国内镜像源：Docker Desktop → Settings → Docker Engine，添加 `"registry-mirrors": ["https://mirror.ccs.tencentyun.com"]` |
| Spring Boot 启动报 "Unable to connect to Redis" | Redis 容器没启动 | `docker start my-redis` |
| `redis-cli` 中看到 `\xac\xed` 乱码 | 用了默认的 JDK 序列化 | 使用自定义的 `RedisConfig`，换成 String + JSON 序列化 |
| `RedisTemplate` 写入后 `redis-cli` 看不到 | Key 前面可能有不可见字符 | 检查 Key 的序列化器是否用了 `StringRedisSerializer` |
| Windows 重启后 Redis 连不上 | Docker Desktop 没自动启动 | 手动启动 Docker Desktop + `docker start my-redis` |
| 端口 6379 被占用 | 本机已装了 Redis 或其他程序占用了端口 | 换端口：`-p 6380:6379`，同时修改 `application.properties` |

---

## 后续衔接

Day 27 完成后，Redis 已跑起来，Spring Boot 已能读写。Day 28 将进入实战——**缓存 AI 回答**：

- 对相同的问答计算 hash 作为缓存 Key
- 命中缓存直接返回，不调用大模型
- 省钱 + 省时间

> 📚 **扩展阅读**：
> - Redis 官方教程：[redis.io/docs](https://redis.io/docs)
> - Docker 入门教程：[docs.docker.com/get-started](https://docs.docker.com/get-started/)
> - Spring Data Redis 文档：[spring.io/projects/spring-data-redis](https://spring.io/projects/spring-data-redis)
