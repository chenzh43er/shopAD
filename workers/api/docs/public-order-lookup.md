# 公开订单查询 API

无需登录、无需 Token。适用于客服工具、落地页查单等场景。

**Base URL（开发/线上 Worker）**

```text
https://shopad-api.ubeator.workers.dev
```

本地：`http://127.0.0.1:8787`

---

## 1. 按订单号查询

### 请求

```http
GET /api/orders/by-order-no?order_no={订单号}
```

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| `order_no` | Query | 是* | 订单号，精确匹配 |
| `orderNo` | Query | 是* | 与 `order_no` 等价，二选一 |

\* 至少提供其中一个。

### 成功响应 `200`

```json
{
  "data": {
    "id": "uuid",
    "order_no": "26080212345678",
    "product_id": "uuid",
    "product_name": "商品名",
    "package_name": "套餐名",
    "customer_name": "收件人",
    "customer_phone": "628123456789",
    "shipping_address": "完整地址（冗余）",
    "shipping_province": "省",
    "shipping_city": "市",
    "shipping_district": "区",
    "shipping_detail": "详细地址",
    "shipping_order_no": "运单号或 null",
    "total_amount": 199000,
    "status": "awaiting_confirm",
    "payment_type": "cod",
    "created_at": "2026-08-02T10:00:00.000Z",
    "updated_at": "2026-08-02T12:00:00.000Z",
    "currency": {
      "id": "uuid",
      "code": "IDR",
      "name": "Indonesian Rupiah",
      "name_zh": "印尼盾",
      "symbol": "Rp",
      "symbol_suffix": false
    }
  }
}
```

`currency` 可能为 `null`（商品未绑定币种时）。

### 错误响应

| 状态码 | 示例 body | 说明 |
|--------|-----------|------|
| `400` | `{"error":"请提供订单号"}` | 缺少订单号 |
| `404` | `{"error":"订单不存在"}` | 无匹配订单 |
| `500` | `{"error":"..."}` | 服务端错误 |

### 示例

```bash
curl "https://shopad-api.ubeator.workers.dev/api/orders/by-order-no?order_no=26080212345678"
```

```powershell
Invoke-RestMethod "https://shopad-api.ubeator.workers.dev/api/orders/by-order-no?order_no=26080212345678"
```

---

## 2. 按手机号查询（最近一单）

仅返回该手机号下按 `updated_at` 倒序的**最近一笔**订单，响应结构与按订单号查询一致（单对象，非数组）。

### 请求

```http
GET /api/orders/by-phone?phone={手机号}
```

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| `phone` | Query | 是* | 手机号 |
| `customer_phone` | Query | 是* | 与 `phone` 等价，二选一 |

\* 至少提供 `phone` 或 `customer_phone` 其中一个。

### 手机号匹配规则

- 会去掉空格、`-`、`()`、`.`、`+`
- 会去掉前导 `0`，便于兼容本地号与国际号  
  例：`08123456789`、`628123456789`、`+62 812-3456-789` 可命中同一号码
- 使用包含匹配（`ILIKE %digits%`）
- 取 `updated_at` 最新的一条

### 成功响应 `200`

```json
{
  "data": {
    "id": "uuid",
    "order_no": "26080212345678",
    "product_id": "uuid",
    "product_name": "商品名",
    "package_name": "套餐名",
    "customer_name": "收件人",
    "customer_phone": "628123456789",
    "shipping_address": "完整地址（冗余）",
    "shipping_province": "省",
    "shipping_city": "市",
    "shipping_district": "区",
    "shipping_detail": "详细地址",
    "shipping_order_no": "运单号或 null",
    "total_amount": 199000,
    "status": "cod_shipped",
    "payment_type": "cod",
    "created_at": "2026-08-02T10:00:00.000Z",
    "updated_at": "2026-08-02T12:00:00.000Z",
    "currency": {
      "id": "uuid",
      "code": "IDR",
      "name": "Indonesian Rupiah",
      "name_zh": "印尼盾",
      "symbol": "Rp",
      "symbol_suffix": false
    }
  }
}
```

### 错误响应

| 状态码 | 示例 body | 说明 |
|--------|-----------|------|
| `400` | `{"error":"请提供手机号"}` | 缺少手机号 |
| `404` | `{"error":"订单不存在"}` | 该手机号无订单 |
| `500` | `{"error":"..."}` | 服务端错误 |

### 示例

```bash
curl "https://shopad-api.ubeator.workers.dev/api/orders/by-phone?phone=628123456789"
```

```powershell
Invoke-RestMethod "https://shopad-api.ubeator.workers.dev/api/orders/by-phone?phone=628123456789"
```

---

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (uuid) | 订单 ID |
| `order_no` | string | 订单号 |
| `product_id` | string \| null | 商品 ID |
| `product_name` | string \| null | 商品名快照 |
| `package_name` | string \| null | 套餐名快照 |
| `customer_name` | string | 收件人姓名 |
| `customer_phone` | string \| null | 收件人手机号 |
| `shipping_address` | string \| null | 完整地址快照 |
| `shipping_province` | string \| null | 省 |
| `shipping_city` | string \| null | 市 |
| `shipping_district` | string \| null | 区 |
| `shipping_detail` | string \| null | 详细地址 |
| `shipping_order_no` | string \| null | 物流运单号 |
| `total_amount` | number | 订单金额 |
| `status` | string | 订单状态，见下表 |
| `payment_type` | string \| null | `cod` / `non_cod` 等 |
| `created_at` | string (ISO 8601) | 创建时间 |
| `updated_at` | string (ISO 8601) | 最近更新时间 |
| `currency` | object \| null | 币种信息（随商品） |

### `status` 枚举

| 值 | 含义 |
|----|------|
| `pending` | 待支付 |
| `paid` | 已支付 |
| `awaiting_review` | 待审核 |
| `awaiting_confirm` | 待确认 |
| `awaiting_shipment` | 待发货 |
| `shipped` | 已发货 |
| `cod_shipped` | 已发货（COD） |
| `completed` | 已完成 |
| `cod_completed` | 已签收 |
| `cod_refused` | 拒绝签收 |
| `cancelled` | 无效订单 |

### `payment_type` 枚举

| 值 | 含义 |
|----|------|
| `cod` | 货到付款 |
| `non_cod` | 非货到付款 |

---

## 鉴权与安全说明

- 这两个接口**不需要** `Authorization`。
- 后台其余 `/api/orders/*`（列表、详情、改状态等）仍需员工 Bearer Token。
- 公开接口不返回审核人、内部备注、寄件人内部信息等敏感列。
- 手机号查询仅返回最近一单；请仅在可信渠道使用。

---

## 健康检查（可选）

```http
GET /api/health
```

```json
{
  "ok": true,
  "service": "shopad-api",
  "ts": "2026-08-02T13:21:08.042Z"
}
```
