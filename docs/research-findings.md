# Copilot Router 调研报告

## 一、OpenCode 如何利用 GitHub Copilot OAuth 调用 API

### 1.1 认证流程（OAuth 2.0 Device Authorization Grant）

OpenCode 使用 **OAuth 2.0 设备授权流程（Device Flow）** 获取 GitHub 令牌，整个流程实现在 `packages/opencode/src/plugin/copilot.ts`。

**关键参数：**
- **Client ID**: `Ov23li8tweQw6odWQebz`（OpenCode 自有的 GitHub OAuth App）
- **Scope**: `read:user`
- **Grant Type**: `urn:ietf:params:oauth:grant-type:device_code`

> 注意：VS Code/官方 CLI 使用另一个 Client ID `Iv1.b507a08c87ecfe98`，scope 更多（`copilot`, `repo`, `gist`, `read:org` 等）。OpenCode 只用了 `read:user` 就够了——这说明 Copilot API 的认证只需要一个合法的 GitHub OAuth token，并不严格校验 scope。

**完整流程：**

```
用户发起认证
    │
    ▼
POST https://github.com/login/device/code
    Body: { client_id: "Ov23li8tweQw6odWQebz", scope: "read:user" }
    Response: { device_code, user_code, verification_uri, interval }
    │
    ▼
用户在浏览器打开 verification_uri，输入 user_code
    │
    ▼
轮询 POST https://github.com/login/oauth/access_token
    Body: { client_id, device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }
    │
    ├── error: "authorization_pending" → 等待 interval 秒后重试
    ├── error: "slow_down" → 增加 5 秒后重试（RFC 8628）
    └── success: { access_token: "ghu_xxxx..." }
    │
    ▼
存储 access_token 作为 refresh token（实际上 GitHub 的 access_token 不过期）
```

### 1.2 API 请求流程

OpenCode **没有**使用 `copilot_internal/v2/token` 做二次 token 换取。它直接使用 GitHub OAuth token 调用 Copilot API：

```
请求构建（copilot.ts 中的 custom fetch）
    │
    ▼
设置 Headers:
    Authorization: Bearer ${access_token}     ← 直接用 OAuth token
    User-Agent: opencode/${version}
    Openai-Intent: conversation-edits
    x-initiator: user | agent
    Copilot-Vision-Request: true              ← 如果包含图片
    │
    ▼
发送到: ${baseURL}/chat/completions  或  ${baseURL}/responses
    │
    baseURL 来源:
    ├── GitHub.com 用户: 由 models.dev 定义（https://api.githubcopilot.com）
    ├── Enterprise 用户: https://copilot-api.${enterprise-domain}
    └── 用户自定义: opencode.json 中的 provider.github-copilot.options.baseURL
```

**重要发现：OpenCode 走了一条"简洁路径"**
- 不经过 `copilot_internal/v2/token` 换取短期 token
- 直接拿 GitHub OAuth token 当 Bearer token 打 Copilot API
- 这与 VS Code/官方 CLI 的行为不同（它们会换取 `tid=...` 短期 token）
- 但 Copilot API 两种方式都接受

### 1.3 模型路由

- 模型列表来自 `models.dev/api.json`（外部维护的模型数据库）
- GPT-5+ 使用 **Responses API** (`/responses`)，其他使用 **Chat Completions API** (`/chat/completions`)
- 所有 GitHub Copilot 下的模型费用被设为 $0（在 plugin loader 中覆盖）
- 默认优先使用免费模型：`gpt-5-mini`, `claude-haiku-4.5`

---

## 二、Base URL 能否通过配置修改

### 2.1 结论：✅ 完全支持，三种方式

**方式一：opencode.json 配置（推荐，最直接）**

```json
{
  "provider": {
    "github-copilot": {
      "options": {
        "baseURL": "http://localhost:8080"
      }
    }
  }
}
```

**方式二：Enterprise URL（OAuth 认证时选择）**

选择 "GitHub Enterprise" → 输入自定义域名 → baseURL 自动变为 `https://copilot-api.${domain}`

**方式三：models.dev 中的 api.url 字段**

每个模型在 models.dev 中有 `api.url` 字段，但用户配置的 `baseURL` 优先级更高。

### 2.2 优先级链（高 → 低）

```
1. opencode.json 中的 provider.github-copilot.options.baseURL    ← 最高
2. Auth plugin loader 返回的 baseURL（来自 enterprise URL）
3. models.dev 中模型的 api.url 字段
4. SDK 默认值: https://api.openai.com/v1                          ← 最低（兜底）
```

### 2.3 代码证据

`provider.ts` 第 1203-1227 行：

```typescript
const baseURL = iife(() => {
  let url =
    typeof options["baseURL"] === "string" && options["baseURL"] !== ""
      ? options["baseURL"]     // ← 优先使用配置的 baseURL
      : model.api.url          // ← 否则使用 models.dev 的 url
  if (!url) return
  // ... 变量替换逻辑
  return url
})
if (baseURL !== undefined) options["baseURL"] = baseURL
```

配置合并在 `provider.ts` 第 1107-1113 行：用户 config 中的 options 会被 merge 进去，优先级高于 auth loader 的结果。

### 2.4 Custom Fetch 的传递

关键点：OpenCode 的 Copilot plugin 不仅设置 `baseURL`，还注入了一个 **custom fetch function**（`copilot.ts` 第 64-141 行），用于：
1. 动态获取最新 token（`getAuth()`）
2. 设置 Copilot 特有 headers
3. 删除标准 `authorization` header（小写），替换为 `Authorization: Bearer ${token}`

**对我们的 Router 意味着：** 当 opencode 配置 baseURL 指向我们的 proxy 时，请求会带着这些 Copilot 特有 headers 过来。我们的 proxy 需要：
- 忽略 incoming 的 `Authorization` header（那是 opencode 的 token）
- 使用自己管理的多个 account token 重新构造 `Authorization`

---

## 三、社区现有项目调研

### 3.1 主要项目对比

| 项目 | 语言 | Stars | 多账号 | 配额追踪 | OpenAI 兼容 | 关键特点 |
|------|------|-------|--------|---------|------------|---------|
| **copilot2api-go** | Go | ~50 | ✅ Round-Robin/Priority | ✅ Web 仪表盘 | ✅ | 最完整的多账号方案 |
| **copilot-api-proxy** | Python | - | ❌ 单账号 | ✅ 详细统计 | ✅ + Anthropic | 最好的使用追踪 |
| **copilot-more-continued** | Python | - | ❌ 单账号 | ✅ Token 级别 | ✅ | 最精确的速率限制 |
| **copilot-openai-server** | Go | - | ❌ 单账号 | ❌ | ✅ | 使用官方 Copilot SDK |

### 3.2 两种认证路径

**路径 A：OpenCode 路径（简洁）**
```
GitHub OAuth token (ghu_xxx)
    → 直接作为 Bearer token 调 Copilot API
    → 优点：简单，不需要 token 刷新
    → 缺点：可能有更严格的速率限制
```

**路径 B：VS Code 路径（经典）**
```
GitHub OAuth token (ghu_xxx)
    → GET api.github.com/copilot_internal/v2/token
    → 获取短期 token (tid=xxx, 有效期 25-30 分钟)
    → 用短期 token 调 Copilot API
    → 需要每 ~20 分钟刷新
    → 大部分社区项目使用此路径
```

### 3.3 Copilot API 端点

| 用途 | URL |
|------|-----|
| 设备授权 | `POST https://github.com/login/device/code` |
| Token 获取 | `POST https://github.com/login/oauth/access_token` |
| 短期 Token 换取 | `GET https://api.github.com/copilot_internal/v2/token` |
| Chat Completions | `POST https://api.githubcopilot.com/chat/completions` |
| Responses API | `POST https://api.githubcopilot.com/responses` |
| 模型列表 | `GET https://api.githubcopilot.com/models` |

### 3.4 Premium Request 配额系统

| 计划 | 月配额 | 重置时间 |
|------|--------|---------|
| Copilot Pro ($10/mo) | 300 次 | 每月 1 号 00:00 UTC |
| Copilot Pro+ ($39/mo) | 1,500 次 | 每月 1 号 00:00 UTC |
| Copilot Enterprise | 1,000+ 次/seat | 每月 1 号 00:00 UTC |

**配额查询方式：**
- API 响应 Headers：`x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-limit`
- REST API：`GET /users/{username}/settings/billing/shared-storage`（需要 `user` scope）
- 429 响应：返回 `retry-after` header

**模型消耗倍率（Premium Request Multiplier）：**
- 0x（免费/基础）：`gpt-4o`, `gpt-5-mini`, `gpt-4.1`
- 1x（标准 Premium）：`claude-3.5-sonnet`, `gemini-1.5-pro`, `gpt-5`
- 更高倍率：某些高端模型可能消耗更多配额

---

## 四、关键技术发现总结

1. **OpenCode 的 Client ID 不同于 VS Code 的**：OpenCode 用 `Ov23li8tweQw6odWQebz`，VS Code 用 `Iv1.b507a08c87ecfe98`。两个都能正常工作。
2. **不需要二次 token 换取**：OpenCode 证明了直接用 GitHub OAuth token 就能调 Copilot API，不必走 `copilot_internal/v2/token`。
3. **baseURL 完全可配置**：通过 `opencode.json` 中的 `provider.github-copilot.options.baseURL` 即可指向自定义代理。
4. **Custom Fetch 会传递 Copilot 特有 headers**：代理需要理解并正确处理这些 headers。
5. **模型列表来自 models.dev**：不需要自己维护模型列表，可以透传或从 Copilot API 的 `/models` 获取。
6. **配额信息在响应 Headers 中**：可以从每次 API 响应中解析 `x-ratelimit-*` headers 来追踪配额。
