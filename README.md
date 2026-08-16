# ShopAD — 商品与订单管理后台

Cloudflare（Pages + Workers）+ Supabase（Auth / Postgres / Storage）+ React 管理端。

## 架构

```
浏览器 (React) ──登录──▶ Supabase Auth
       │
       └── Bearer JWT ──▶ Cloudflare Worker API ──▶ Supabase (DB / Storage)
```

- `apps/web`：管理后台（Vite + React + Ant Design）
- `workers/api`：业务 API（Hono on Cloudflare Workers）
- `packages/shared`：共享类型与订单状态流转规则
- `supabase/`：数据库 migration 与 seed

## 功能（一期）

- 管理员登录（Supabase Auth 邮箱密码）
- 商品 CRUD、上下架、封面图上传
- 订单列表筛选、详情、合法状态流转、备注

## 本地启动

### 1. 依赖

```bash
pnpm install
pnpm --filter @shopad/shared build
```

### 2. Supabase

1. 新建 Supabase 项目
2. 在 SQL Editor 执行 [`supabase/migrations/20260315000000_init.sql`](supabase/migrations/20260315000000_init.sql)
3. （可选）执行 [`supabase/seed.sql`](supabase/seed.sql) 写入示例商品/订单
4. 在 Authentication → Users 创建管理员账号（触发器会自动写入 `profiles.role = admin`）
5. Project Settings → API 复制：
   - Project URL
   - `anon` key
   - `service_role` key
6. Project Settings → API → JWT Secret（用于 Worker 校验 token）

### 3. 环境变量

**Worker** — 复制并填写：

```bash
cp workers/api/.dev.vars.example workers/api/.dev.vars
```

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
```

**Web** — 复制并填写：

```bash
cp apps/web/.env.example apps/web/.env
```

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
# 本地开发留空，走 Vite 代理到 :8787
VITE_API_BASE_URL=
```

### 4. 开发

```bash
pnpm dev
```

- 前端：http://localhost:5173
- API：http://127.0.0.1:8787（健康检查 `/api/health`）

也可分别启动：

```bash
pnpm dev:api
pnpm dev:web
```

## 部署

### Worker

```bash
cd workers/api
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_JWT_SECRET
# 可选：更新 wrangler.toml 中 CORS_ORIGINS 为 Pages / 自定义域名
pnpm deploy
```

### Pages（前端）

构建命令：`pnpm --filter @shopad/shared build && pnpm --filter @shopad/web build`  
输出目录：`apps/web/dist`  

Pages 环境变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` 保持为空（浏览器走同源 `/api`，由 `apps/web/functions` 代理到 Worker；勿直连 `*.workers.dev`，国内常被阻断）

可选：在 Pages 项目设置 `API_UPSTREAM` 覆盖默认 Worker 地址。

### 安全加固（概要）

代码侧已默认启用：Pages `_headers`（HSTS/CSP/防点击劫持等）、Worker `secureHeaders`、CORS 白名单不回落、公开查单 IP 限流、敏感表 RLS。

建议在控制台同步完成：

1. Cloudflare（`acomedia.work`）：SSL/TLS → **Full (strict)**；Security → 开启 **Bot Fight Mode**；尽量只用自定义域访问，少暴露 `*.workers.dev`
2. Supabase：Authentication → 关闭公开注册；Site URL / Redirect URLs 仅允许 `https://acomedia.work`（及 www）
3. 在 SQL Editor 执行最新 migration（含 `domains` / `currencies` / `product_owners` 的 RLS）

### 自定义域名（`acomedia.work`）

域名需已在**同一 Cloudflare 账号**下处于「活动」状态，然后：

1. **Workers & Pages** → 项目 `shopad` → **Custom domains** → **Set up a domain**
2. 添加 `acomedia.work`（可选再加 `www.acomedia.work`）；同账号 zone 会自动写 CNAME，状态变 Active 即可
3. 重新部署 Worker（使 `CORS_ORIGINS` 含新域名生效）
4. **Supabase** → Authentication → URL Configuration：
   - Site URL：`https://acomedia.work`
   - Redirect URLs 增加：`https://acomedia.work/**`、`https://www.acomedia.work/**`（若启用 www）

## 订单状态流转

| 当前 | 可转到 |
|------|--------|
| pending（待支付） | paid / cancelled |
| paid（已支付） | shipped / cancelled |
| shipped（已发货） | completed |
| completed / cancelled | （终态） |

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 探活（无需登录） |
| GET | `/api/orders/by-order-no` | 公开：按订单号查单（无需登录） |
| GET | `/api/orders/by-phone` | 公开：按手机号查最近一单（无需登录） |
| GET/POST | `/api/products` | 列表 / 创建 |
| GET/PUT/DELETE | `/api/products/:id` | 详情 / 更新 / 删除 |
| PATCH | `/api/products/:id/status` | 上下架 |
| POST | `/api/uploads/product-image` | 上传封面 |
| GET | `/api/orders` | 订单列表 |
| GET | `/api/orders/:id` | 订单详情 |
| PATCH | `/api/orders/:id/status` | 状态流转 |
| PATCH | `/api/orders/:id/remark` | 备注 |

公开查单接口文档见 [`workers/api/docs/public-order-lookup.md`](workers/api/docs/public-order-lookup.md)（Word：`workers/api/docs/ShopAD-Order-Lookup-API.docx`）。

除 health 与上述公开查单外，均需 `Authorization: Bearer <supabase_access_token>`，且用户须在 `profiles` 中为员工角色。

## 安全说明

密钥 / 连接串三层分工（同一 Supabase 库）：

| 运行面 | 凭证 | 说明 |
|--------|------|------|
| `apps/web` 浏览器 | `VITE_SUPABASE_ANON_KEY`（anon / publishable） | 禁止 service_role；受 RLS 约束 |
| `workers/api` | `SUPABASE_SERVICE_ROLE_KEY`（仅 Wrangler secrets） | 旁路 RLS，只做已鉴权管理写 |
| `product-1` 落地页 | `DATABASE_URL` → 角色 **`storefront`** | 见迁移 `20260817010000_storefront_db_role.sql`；禁止 postgres / 超管 |

部署 `storefront` 角色后请执行：

```sql
ALTER ROLE storefront WITH PASSWORD '强随机密码';
```

连接串示例：`postgresql://storefront:密码@db.<ref>.supabase.co:5432/postgres`

- 数据表开启 RLS；anon 无公开写策略；管理写操作走 Worker
- 生产环境建议关闭公开注册，仅邀请管理员账号
