# Copilot Router 架构设计方案

## 一、项目定位

**Copilot Router** 是一个 GitHub Copilot 多账号管理代理服务，暴露 OpenAI 兼容 API，用于给 opencode 等 AI 工具提供统一的 Copilot 接入能力。

**核心价值：**
- 聚合多个 GitHub Copilot 账号的 Premium Request 配额
- 智能轮转，自动禁用耗尽配额的账号
- 统一 API Key 管理，方便分发给多个客户端
- 全维度使用统计

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Copilot Router                           │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  API Key  │    │   Request    │    │   Account Pool &      │  │
│  │  Auth     │───▶│   Router     │───▶│   Load Balancer       │  │
│  │  Layer    │    │              │    │                       │  │
│  └──────────┘    └──────┬───────┘    │  ┌─────┐ ┌─────┐     │  │
│                         │            │  │Acct1│ │Acct2│ ... │  │
│                         │            │  └──┬──┘ └──┬──┘     │  │
│                         │            │     │       │        │  │
│                         │            └─────┼───────┼────────┘  │
│                         │                  │       │           │
│  ┌──────────────────────┴──────────────────┴───────┴────────┐  │
│  │                    Statistics Engine                       │  │
│  │  (模型/次数/API Key/时间/账号 多维度统计)                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    SQLite (via Drizzle)                    │  │
│  │  accounts | api_keys | requests | quota_snapshots         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Admin Web UI                            │  │
│  │  账号管理 | 配额监控 | 统计面板 | API Key 管理              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                                        ▲
         │ 转发请求                                │ API 请求
         ▼                                        │
┌─────────────────┐                    ┌──────────────────┐
│  GitHub Copilot │                    │  opencode /       │
│  API            │                    │  其他 AI 客户端    │
│  api.github     │                    └──────────────────┘
│  copilot.com    │
└─────────────────┘
```

---

## 三、技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| **语言** | TypeScript (Bun) | 与 opencode 生态一致，Bun 性能优秀，原生 SQLite |
| **Web 框架** | Hono | 轻量、类型安全、Bun 原生支持，适合 API 代理 |
| **数据库** | SQLite (via Drizzle ORM) | 零依赖、单文件部署、足够本地/小团队使用 |
| **Admin UI** | 内嵌静态页面 (Vanilla/Preact) | 轻量级管理界面，无需额外构建流程 |

---

## 四、数据模型

### 4.1 accounts（Copilot 账号）

```sql
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,        -- nanoid
  github_user TEXT NOT NULL,           -- GitHub 用户名
  oauth_token TEXT NOT NULL,           -- GitHub OAuth token (ghu_xxx)
  status      TEXT NOT NULL DEFAULT 'active',  -- active | disabled | exhausted | error
  plan        TEXT,                     -- pro | pro_plus | enterprise
  quota_limit INTEGER DEFAULT 300,     -- 月配额上限
  quota_used  INTEGER DEFAULT 0,       -- 当前已用
  quota_reset INTEGER,                 -- 配额重置时间 (unix timestamp)
  last_used   INTEGER,                 -- 最后使用时间
  error_msg   TEXT,                    -- 最后错误信息
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### 4.2 api_keys（分发给客户端的 API Key）

```sql
CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,        -- nanoid
  key         TEXT NOT NULL UNIQUE,    -- sk-cr-xxxx (自定义前缀)
  name        TEXT NOT NULL,           -- 名称标签
  status      TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  created_at  INTEGER NOT NULL,
  last_used   INTEGER,
  total_requests INTEGER DEFAULT 0
);
```

### 4.3 requests（请求日志）

```sql
CREATE TABLE requests (
  id              TEXT PRIMARY KEY,
  api_key_id      TEXT NOT NULL REFERENCES api_keys(id),
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  model           TEXT NOT NULL,
  status_code     INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  is_premium      INTEGER NOT NULL DEFAULT 0,  -- 是否消耗 premium request
  duration_ms     INTEGER,
  error           TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX requests_api_key_idx ON requests(api_key_id);
CREATE INDEX requests_account_idx ON requests(account_id);
CREATE INDEX requests_model_idx ON requests(model);
CREATE INDEX requests_created_at_idx ON requests(created_at);
```

### 4.4 quota_snapshots（配额快照，用于历史追踪）

```sql
CREATE TABLE quota_snapshots (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  quota_used  INTEGER NOT NULL,
  quota_limit INTEGER NOT NULL,
  captured_at INTEGER NOT NULL
);
```

---

## 五、核心模块设计

### 5.1 账号管理模块

**添加账号流程：**

```
POST /admin/accounts/authorize
    │
    ▼
发起 GitHub Device Flow (使用自定义 Client ID 或复用 OpenCode 的)
    │
    ▼
返回 { user_code, verification_uri }
    │
    ▼ 用户在浏览器完成授权
    │
轮询获取 access_token
    │
    ▼
存储到 accounts 表
    │
    ▼
立即获取配额信息（通过 API 调用响应 headers 或 /models 端点）
```

**状态机：**

```
      ┌──────────┐  认证成功    ┌────────┐
      │ pending  │────────────▶│ active │◀──── 配额重置/手动启用
      └──────────┘              └───┬────┘
                                    │
                          ┌─────────┼─────────┐
                          │         │         │
                     配额耗尽    API 错误   手动禁用
                          │         │         │
                          ▼         ▼         ▼
                    ┌──────────┐ ┌───────┐ ┌──────────┐
                    │exhausted │ │ error │ │ disabled │
                    └──────────┘ └───────┘ └──────────┘
```

### 5.2 请求路由模块

**路由策略（Round-Robin + 感知配额）：**

```typescript
function selectAccount(accounts: Account[]): Account | null {
  // 1. 过滤出 active 状态的账号
  const active = accounts.filter(a => a.status === 'active')
  if (active.length === 0) return null

  // 2. 按配额剩余比例加权，避免均匀消耗后同时耗尽
  // 优先使用配额充裕的账号
  active.sort((a, b) => {
    const ratioA = (a.quota_limit - a.quota_used) / a.quota_limit
    const ratioB = (b.quota_limit - b.quota_used) / b.quota_limit
    return ratioB - ratioA
  })

  // 3. 在配额相近的账号间轮转（避免总是打同一个）
  // 取配额剩余 > 最大值 80% 的账号组，在其中 round-robin
  const maxRemaining = active[0].quota_limit - active[0].quota_used
  const candidates = active.filter(a =>
    (a.quota_limit - a.quota_used) >= maxRemaining * 0.8
  )

  return candidates[roundRobinIndex++ % candidates.length]
}
```

**请求处理流程：**

```
客户端请求 (带 API Key)
    │
    ▼
验证 API Key → 无效则 401
    │
    ▼
选择账号 → 无可用账号则 503
    │
    ▼
构造请求 Headers:
    Authorization: Bearer ${account.oauth_token}
    User-Agent: opencode/${version}     ← 伪装为 opencode
    Openai-Intent: conversation-edits
    x-initiator: user
    │
    ▼
转发到 https://api.githubcopilot.com${path}
    │
    ▼
解析响应:
    ├── 成功: 提取 usage tokens, x-ratelimit-* headers
    │        记录到 requests 表
    │        更新 account 配额
    │        返回响应给客户端
    │
    ├── 429 (Rate Limited):
    │        标记当前账号 exhausted
    │        尝试下一个账号（重试 1 次）
    │        无可用账号则返回 429
    │
    └── 401/403 (Token Invalid):
             标记当前账号 error
             尝试下一个账号
```

### 5.3 配额追踪模块

**数据来源：**

1. **API 响应 Headers**（实时，主要来源）
   ```
   x-ratelimit-limit: 300
   x-ratelimit-remaining: 245
   x-ratelimit-reset: 1743465600
   ```

2. **请求计数**（本地追踪，作为补充）
   - 每次 premium 请求 +1
   - 根据模型判断是否为 premium（非免费模型 = premium）

3. **定时校准**（可选）
   - 定期向 Copilot API 发轻量请求（如 `/models`）获取最新 headers
   - 每月 1 号自动重置本地计数

**自动禁用逻辑：**
- `x-ratelimit-remaining` 为 0 时立即标记 `exhausted`
- 收到 429 时标记 `exhausted`
- `x-ratelimit-reset` 到期后自动恢复 `active`

### 5.4 统计模块

**多维度查询 API：**

```
GET /admin/stats?group_by=model&from=2026-03-01&to=2026-03-26
GET /admin/stats?group_by=api_key&period=today
GET /admin/stats?group_by=account&period=this_month
GET /admin/stats?group_by=hour&model=claude-sonnet-4
```

**统计维度：**

| 维度 | 说明 |
|------|------|
| 模型 | 各模型使用次数、token 消耗 |
| API Key | 每个 key 的使用量，方便分配追踪 |
| 账号 | 每个 Copilot 账号的消耗情况 |
| 时间 | 按小时/天/周/月 聚合 |
| 状态 | 成功/失败/429 分布 |

---

## 六、API 设计

### 6.1 代理 API（OpenAI 兼容，给客户端用）

```
POST /v1/chat/completions    ← 主要接口，OpenAI 兼容
POST /v1/responses           ← Responses API 兼容
GET  /v1/models              ← 模型列表（从 Copilot API 获取或缓存）
```

认证：`Authorization: Bearer sk-cr-xxxx`（使用 copilot-router 分发的 API Key）

### 6.2 管理 API（Admin 用）

```
# 账号管理
POST   /admin/accounts/authorize    ← 发起 Device Flow 添加新账号
GET    /admin/accounts              ← 列出所有账号
PATCH  /admin/accounts/:id          ← 启用/禁用账号
DELETE /admin/accounts/:id          ← 删除账号
GET    /admin/accounts/:id/quota    ← 查询单个账号配额

# API Key 管理
POST   /admin/keys                  ← 创建新 API Key
GET    /admin/keys                  ← 列出所有 Key
DELETE /admin/keys/:id              ← 删除/吊销 Key

# 统计
GET    /admin/stats                 ← 多维度统计查询
GET    /admin/stats/overview        ← 总览（总请求、总配额、活跃账号等）
GET    /admin/requests              ← 请求日志（分页）

# 系统
GET    /admin/health                ← 健康检查
```

Admin API 认证：`Authorization: Bearer ${ADMIN_TOKEN}`（环境变量配置）

---

## 七、opencode 集成方式

在 opencode 项目的 `opencode.json` 中配置：

```json
{
  "provider": {
    "github-copilot": {
      "options": {
        "baseURL": "http://localhost:4141"
      }
    }
  }
}
```

**关键点：**
- opencode 会把它自己的 OAuth token 放在 `Authorization` header 中发过来
- Copilot Router 需要**忽略 incoming Authorization**，替换为自己管理的账号 token
- opencode 的 custom fetch 会设置 `Openai-Intent`, `x-initiator` 等 headers，可以直接透传
- `User-Agent` 应保持 opencode 的 UA 或自定义一个合理的 UA

**或者，不走 opencode 的 Copilot 认证：** 由于 Copilot Router 暴露 OpenAI 兼容 API，也可以在 opencode 中配置为普通 OpenAI 兼容 provider：

```json
{
  "provider": {
    "copilot-router": {
      "options": {
        "baseURL": "http://localhost:4141/v1",
        "apiKey": "sk-cr-xxxx"
      }
    }
  }
}
```

这种方式更干净，不依赖 Copilot 认证流程。但需要在 Copilot Router 中自行维护模型列表。

---

## 八、项目结构

```
copilot-router/
├── src/
│   ├── index.ts              # 入口，启动 Hono server
│   ├── config.ts             # 配置管理
│   ├── db/
│   │   ├── schema.ts         # Drizzle schema
│   │   ├── index.ts          # DB 连接
│   │   └── migrate.ts        # 迁移
│   ├── account/
│   │   ├── index.ts          # 账号 CRUD
│   │   ├── oauth.ts          # GitHub Device Flow 实现
│   │   └── pool.ts           # 账号池 & 负载均衡
│   ├── proxy/
│   │   ├── index.ts          # 请求代理核心逻辑
│   │   ├── headers.ts        # Header 处理
│   │   └── stream.ts         # SSE 流转发 & token 统计
│   ├── auth/
│   │   └── index.ts          # API Key 验证
│   ├── stats/
│   │   └── index.ts          # 统计查询
│   ├── admin/
│   │   ├── routes.ts         # Admin API 路由
│   │   └── ui/               # 静态管理界面
│   └── quota/
│       └── index.ts          # 配额追踪 & 自动管理
├── drizzle/
│   └── migrations/           # DB 迁移文件
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── docs/
    ├── research-findings.md  # 调研报告
    └── architecture.md       # 本文档
```

---

## 九、开发计划（分阶段）

### Phase 1: 核心代理（MVP）
- [ ] 项目脚手架（Bun + Hono + Drizzle）
- [ ] SQLite 数据库 schema & 迁移
- [ ] GitHub OAuth Device Flow 实现
- [ ] 单账号请求代理（Chat Completions）
- [ ] 基本的响应解析和转发（含 SSE 流）
- [ ] API Key 认证

### Phase 2: 多账号 & 配额
- [ ] 多账号管理（增删改查）
- [ ] 账号池 & Round-Robin 路由
- [ ] 配额追踪（从响应 headers 提取）
- [ ] 自动禁用/恢复耗尽账号
- [ ] 429 重试到下一个账号

### Phase 3: 统计 & 管理
- [ ] 请求日志记录
- [ ] 多维度统计查询 API
- [ ] Admin Web UI
- [ ] 配额预警

### Phase 4: 增强
- [ ] Responses API 支持
- [ ] 模型列表缓存 & 透传
- [ ] 更智能的路由策略（基于模型的配额消耗倍率）
- [ ] Docker 部署支持

---

## 十、风险与注意事项

1. **ToS 风险**：多账号池化可能违反 GitHub Copilot 的服务条款，仅供个人研究使用。
2. **Token 有效期**：GitHub OAuth token 理论上不过期，但 GitHub 可能随时吊销。需要监控 401 响应。
3. **Client ID 选择**：
   - 使用 OpenCode 的 `Ov23li8tweQw6odWQebz` 可以直接走简洁路径
   - 也可以创建自己的 GitHub OAuth App
   - VS Code 的 `Iv1.b507a08c87ecfe98` 也能用，但 scope 不同
4. **速率限制**：除了月度 Premium Request 配额，还有每日/每模型的速率限制。需要处理 `x-ratelimit-type: UserByModelByDay` 类型的限制。
5. **API 变动**：Copilot API 是非公开 API，可能随时变动。需要良好的错误处理和日志。
