export const PRODUCT_STATUSES = ["draft", "on_sale", "off_sale"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "awaiting_review",
  "awaiting_confirm",
  "awaiting_shipment",
  "shipped",
  "cod_shipped",
  "completed",
  "cod_completed",
  "cod_refused",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_TYPES = ["cod", "non_cod"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const REVIEW_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "草稿",
  on_sale: "在售",
  off_sale: "已删除",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  awaiting_review: "待审核",
  awaiting_confirm: "待确认",
  awaiting_shipment: "待发货",
  shipped: "已发货",
  cod_shipped: "已发货",
  completed: "已完成",
  cod_completed: "已签收",
  cod_refused: "拒绝签收",
  cancelled: "无效订单",
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  cod: "货到付款",
  non_cod: "非货到付款",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  not_required: "无需审核",
  pending: "待审核",
  approved: "已通过",
  rejected: "无效",
};

/** Allowed next statuses for admin order transitions */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  awaiting_review: ["awaiting_confirm", "cancelled"],
  awaiting_confirm: ["awaiting_shipment", "cancelled"],
  awaiting_shipment: ["shipped", "cod_shipped", "cancelled"],
  shipped: ["completed"],
  // 已发货仅可 → 已签收 / 拒绝签收（与「无效订单」无关）
  cod_shipped: ["cod_completed", "cod_refused"],
  completed: [],
  cod_completed: [],
  cod_refused: [],
  cancelled: [],
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 按支付类别过滤可流转状态：
 * - COD：待审核 → 待确认 → 待发货 → 已发货 → 已签收 / 拒绝签收
 * - 无效订单（cancelled）仅用于待审核 / 待确认 / 待发货阶段，与拒绝签收（cod_refused）不同
 * - 非 COD：走 pending/paid/shipped/completed，不使用 COD 专用状态
 */
export function canAdvanceCodOrder(
  paymentType: PaymentType,
  reviewStatus: ReviewStatus,
  to: OrderStatus,
): boolean {
  if (paymentType === "cod") {
    // COD 货到付款，不走待支付 / 已支付 / 非 COD 履约状态
    if (
      to === "pending" ||
      to === "paid" ||
      to === "shipped" ||
      to === "completed"
    ) {
      return false;
    }
    if (to === "cancelled") return true;
    if (to === "awaiting_review") return true;
    if (
      to === "awaiting_confirm" ||
      to === "awaiting_shipment" ||
      to === "cod_shipped" ||
      to === "cod_completed" ||
      to === "cod_refused"
    ) {
      return reviewStatus === "approved";
    }
    return true;
  }
  if (
    to === "awaiting_review" ||
    to === "awaiting_confirm" ||
    to === "awaiting_shipment" ||
    to === "cod_shipped" ||
    to === "cod_completed" ||
    to === "cod_refused"
  ) {
    return false;
  }
  return true;
}

/** 结合审核规则后，允许的下一状态 */
export function getAllowedOrderTransitions(
  from: OrderStatus,
  paymentType: PaymentType = "cod",
  reviewStatus: ReviewStatus = "pending",
): OrderStatus[] {
  return (ORDER_TRANSITIONS[from] ?? []).filter(
    (to) =>
      canTransitionOrder(from, to) &&
      canAdvanceCodOrder(paymentType, reviewStatus, to),
  );
}

export function isPaymentType(value: unknown): value is PaymentType {
  return value === "cod" || value === "non_cod";
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    typeof value === "string" &&
    (REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

export const USER_ROLES = ["super_admin", "employee"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "超级管理员",
  employee: "员工",
};

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

/** 兼容旧库 role='admin'（等同超级管理员） */
export function normalizeUserRole(value: unknown): UserRole | null {
  if (value === "admin") return "super_admin";
  if (isUserRole(value)) return value;
  return null;
}

export function isSuperAdmin(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === "super_admin";
}

export interface Profile {
  id: string;
  email: string | null;
  role: UserRole;
  display_name: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface CreateEmployeeInput {
  email: string;
  password: string;
  display_name?: string | null;
  role?: UserRole;
}

export interface UpdateEmployeeInput {
  display_name?: string | null;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

export interface ActorRef {
  id: string;
  display_name: string | null;
}

export interface Product {
  id: string;
  /** 商品标题(内部) */
  name: string;
  /** 商品详情（纯文字） */
  description: string | null;
  /** 商品描述条目（落地页卖点列表） */
  description_entries: string[];
  price: number;
  /** 关联币种 id */
  currency_id: string | null;
  /** 关联币种（查询时附带） */
  currency?: Pick<
    Currency,
    "id" | "code" | "name" | "name_zh" | "symbol" | "symbol_suffix"
  > | null;
  /** 商品封面 */
  cover_url: string | null;
  /** 商品轮播图 */
  gallery_urls: string[];
  /** 商品详情图片 */
  detail_image_urls: string[];
  status: ProductStatus;
  /** 链接后缀（落地页 URL） */
  link_suffix: string | null;
  /** 商品标题(外部) */
  title_external: string | null;
  /** Facebook像素id，多个用#分隔 */
  facebook_pixel_id: string | null;
  /** Google转化ID */
  google_conversion_id: string | null;
  /** Google Label */
  google_label: string | null;
  /** 附加HTML代码列表（落地页按顺序注入） */
  extra_html: string[];
  /** 规格值 / 后端SKU（导出拼成「sku * 数量」） */
  sku_code: string | null;
  /** 对应外语 / 前端显示SKU */
  sku_display: string | null;
  /** 是否开启套餐 */
  packages_enabled: boolean;
  /** 虚拟销量（落地页展示，后台手填） */
  sales_count: number;
  /** 默认重量（物流导出） */
  weight: number;
  /** 关联地区 id */
  region_id: string | null;
  /** 关联地区（查询时附带） */
  region?: { id: string; name: string; remark: string | null } | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** 所属人 profile id 列表 */
  owner_ids?: string[];
  /** 所属人（查询时附带） */
  owners?: ActorRef[];
  creator?: ActorRef | null;
  updater?: ActorRef | null;
}

/** 商品套餐（售价在套餐层，不在 SKU） */
export interface ProductPackage {
  id: string;
  product_id: string;
  /** 套餐名称 */
  name: string;
  /** 套餐名称(外文) */
  name_external: string;
  /** 套餐原价 */
  original_price: number;
  /** 套餐折扣价 */
  discount_price: number | null;
  /** 套餐摘要 */
  summary: string | null;
  /** 套餐图片 */
  image_url: string | null;
  /** 是否前端可见 */
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 套餐明细 */
export interface ProductPackageItem {
  id: string;
  package_id: string;
  /** 套餐内商品 */
  ref_product_id: string | null;
  /** 数量 */
  quantity: number;
  /** 是否每个商品独立选择属性 */
  independent_attrs: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProductPackageItemWithProduct extends ProductPackageItem {
  ref_product?: Pick<Product, "id" | "name" | "cover_url"> | null;
}

export interface ProductPackageWithItems extends ProductPackage {
  items: ProductPackageItemWithProduct[];
}

export interface UpsertProductPackageInput {
  name: string;
  name_external: string;
  original_price: number;
  discount_price?: number | null;
  summary?: string | null;
  image_url?: string | null;
  is_visible?: boolean;
  sort_order?: number;
  items?: Array<{
    id?: string;
    ref_product_id: string;
    quantity: number;
    independent_attrs?: boolean;
    sort_order?: number;
  }>;
}

export interface Order {
  id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string | null;
  /** 收件地址信息（完整字符串） */
  shipping_address: string | null;
  shipping_province: string | null;
  shipping_city: string | null;
  shipping_district: string | null;
  shipping_detail: string | null;
  total_amount: number;
  status: OrderStatus;
  remark: string | null;
  /** 无效订单拒绝理由 */
  reject_reason: string | null;
  /** 归属成员（财务导出） */
  owner_member: string | null;
  /** 发货订单号（财务导出「订单号」/ 物流电商订单号） */
  shipping_order_no: string | null;
  payment_method: string | null;
  /** 支付类别 */
  payment_type: PaymentType;
  /** 审核状态（货到付款） */
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  cod_amount: number | null;
  express_type: string | null;
  shipping_fee: number | null;
  other_fee: number | null;
  /** 物流件数（非套餐） */
  package_count: number;
  weight: number | null;
  insurance_type: string | null;
  insurance_flag: string | null;
  item_value: number | null;
  item_category: string | null;
  item_type: string | null;
  consignor_flag: string | null;
  consignor_name: string | null;
  consignor_phone: string | null;
  /** 发货选用的寄件人 */
  shipper_id: string | null;
  /** 寄件人（发货快照，对齐物流导出） */
  shipper_name: string | null;
  shipper_phone: string | null;
  shipper_province: string | null;
  shipper_city: string | null;
  shipper_district: string | null;
  shipper_address: string | null;
  shipper_address_info: string | null;
  /** 购买商品（一单一品） */
  product_id: string | null;
  /** 下单时商品名称快照 */
  product_name: string;
  /** 购买套餐 */
  package_id: string | null;
  /** 下单时套餐名称快照 */
  package_name: string | null;
  /** 下单时套餐外文名快照 */
  package_name_external: string | null;
  /** 下单时售价快照（通常取套餐价） */
  unit_price: number;
  /** 购买数量（套餐份数） */
  quantity: number;
  /** 下单时中文属性码快照 */
  sku_code: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  creator?: ActorRef | null;
  updater?: ActorRef | null;
  reviewer?: ActorRef | null;
  /** 关联商品币种（查询时附带，用于金额展示） */
  currency?: Pick<
    Currency,
    "id" | "code" | "name" | "name_zh" | "symbol" | "symbol_suffix"
  > | null;
}

export type AuditEntityType = "order" | "product";

export interface AuditLog {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  from_value: string | null;
  to_value: string | null;
  changes: Record<string, unknown> | null;
  remark: string | null;
  created_at: string;
}

/** 币种（ISO 4217） */
export interface Currency {
  id: string;
  /** ISO 4217 字母代码 */
  code: string;
  /** 英文名称 */
  name: string;
  /** 中文名称 */
  name_zh: string;
  /** 常用符号 */
  symbol: string;
  /** ISO 4217 数字代码 */
  numeric_code: number | null;
  /** 符号是否显示在金额之后 */
  symbol_suffix: boolean;
  is_default: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertCurrencyInput {
  code: string;
  name: string;
  name_zh: string;
  symbol: string;
  numeric_code?: number | null;
  symbol_suffix?: boolean;
  is_default?: boolean;
  enabled?: boolean;
  sort_order?: number;
}

/** 物流导出寄件人默认配置 */
export interface LogisticsShipper {
  id: string;
  name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  address_info: string | null;
  consignor_flag: string;
  consignor_name: string | null;
  consignor_phone: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertLogisticsShipperInput {
  name: string;
  phone?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  address_info?: string | null;
  consignor_flag?: string;
  consignor_name?: string | null;
  consignor_phone?: string | null;
  is_default?: boolean;
}

/** 命名地址库（地区名称） */
export interface AddressLibrary {
  id: string;
  name: string;
  /** 国际电话区号（不含 +），如印尼 62 */
  dial_code: string | null;
  /** 备注 */
  remark: string | null;
  /** 最大级数（导入或写入后维护） */
  max_level: number;
  /** 地域节点总数 */
  region_count: number;
  created_at: string;
  updated_at: string;
}

/** 地址库中的一级地域节点（邻接表，level 从 1 起） */
export interface AddressRegion {
  id: string;
  library_id: string;
  parent_id: string | null;
  name: string;
  level: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 一条完整地址路径（叶子对应 Excel 一行） */
export interface AddressRegionPath {
  /** 叶子节点 id */
  id: string;
  /** 从一级到当前级的名称列表 */
  path: string[];
  level: number;
}

export interface CreateAddressLibraryInput {
  name: string;
  /** 国际电话区号（不含 +），如 62 */
  dial_code: string;
  remark?: string | null;
}

export interface UpdateAddressLibraryInput {
  name?: string;
  dial_code?: string | null;
  remark?: string | null;
}

/**
 * 导入地址库：按地区名称 upsert 库，并用 paths 全量覆盖地域树。
 * paths 每一项为 [一级, 二级, 三级, ...]，级数可大于 3。
 */
export interface ImportAddressLibraryInput {
  name: string;
  paths: string[][];
}

export interface ImportAddressLibraryResult {
  library: AddressLibrary;
  imported_paths: number;
  region_count: number;
  max_level: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  description_entries?: string[];
  price: number;
  currency_id?: string | null;
  cover_url?: string | null;
  gallery_urls?: string[];
  detail_image_urls?: string[];
  status?: ProductStatus;
  link_suffix?: string | null;
  title_external?: string | null;
  facebook_pixel_id?: string | null;
  google_conversion_id?: string | null;
  google_label?: string | null;
  extra_html?: string[];
  sku_code?: string | null;
  sku_display?: string | null;
  packages_enabled?: boolean;
  /** 虚拟销量 */
  sales_count?: number;
  weight?: number;
  region_id?: string | null;
  /** 所属人（profiles.id 列表）；仅超级管理员可指定，可多名 */
  owner_ids?: string[];
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  description_entries?: string[];
  price?: number;
  currency_id?: string | null;
  cover_url?: string | null;
  gallery_urls?: string[];
  detail_image_urls?: string[];
  status?: ProductStatus;
  link_suffix?: string | null;
  title_external?: string | null;
  facebook_pixel_id?: string | null;
  google_conversion_id?: string | null;
  google_label?: string | null;
  extra_html?: string[];
  sku_code?: string | null;
  sku_display?: string | null;
  packages_enabled?: boolean;
  /** 虚拟销量 */
  sales_count?: number;
  weight?: number;
  region_id?: string | null;
  /** 所属人（profiles.id 列表）；仅超级管理员可指定，可多名 */
  owner_ids?: string[];
}
