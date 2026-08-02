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
# 可选：更新 wrangler.toml 中 CORS_ORIGINS 为 Pages 域名
pnpm deploy
```

### Pages（前端）

构建命令：`pnpm --filter @shopad/shared build && pnpm --filter @shopad/web build`  
输出目录：`apps/web/dist`  

Pages 环境变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`（Worker 线上地址，如 `https://shopad-api.xxx.workers.dev`）

部署后把 Worker 的 `CORS_ORIGINS` 设为 Pages 域名。

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

- 浏览器只使用 Supabase **anon** key；**service_role** 仅存在于 Worker secrets
- 数据表开启 RLS 且无公开写策略；管理写操作走 Worker
- 生产环境建议关闭公开注册，仅邀请管理员账号
