/** 前端文本输入长度上限（与表单 maxLength 对齐，避免超长内容直接打到后端） */
export const INPUT_LIMITS = {
  /** 链接后缀 / SKU 编码 / 转化 ID 等短标识 */
  shortId: 64,
  /** 姓名、内部标题、套餐名等 */
  name: 120,
  /** 电话 */
  phone: 32,
  /** 省 / 市 / 区 */
  region: 64,
  /** 详细地址 */
  address: 500,
  /** 地址补充信息 */
  addressInfo: 200,
  /** 委托人标识等短标记 */
  flag: 16,
  /** 外部标题、像素 ID、SKU 展示文案、套餐摘要等 */
  mediumText: 500,
  /** 商品详情等长描述 */
  longText: 5000,
  /** 单段附加 HTML */
  extraHtml: 50000,
  /** 订单备注 */
  remark: 500,
  /** 发货订单号 / 归属成员 */
  shippingMeta: 64,
  /** 登录邮箱 */
  email: 254,
  /** 登录密码 */
  password: 128,
  /** 列表搜索框 */
  search: 120,
} as const;
