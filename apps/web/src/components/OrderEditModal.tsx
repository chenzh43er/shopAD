import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  message,
} from "antd";
import {
  type Order,
  type Paginated,
  type Product,
  type ProductPackageWithItems,
  type UpdateOrderInput,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { formatMoney } from "../lib/formatMoney";
import { INPUT_LIMITS } from "../lib/inputLimits";

type EditOrderFormValues = {
  customer_name: string;
  customer_phone?: string;
  shipping_province?: string;
  shipping_city?: string;
  shipping_district?: string;
  shipping_detail?: string;
  shipping_address?: string;
  product_id: string;
  package_id?: string;
  quantity: number;
  owner_member?: string;
  shipping_order_no?: string;
};

function packageItemCount(pkg: ProductPackageWithItems): number {
  const sum = (pkg.items ?? []).reduce((acc, item) => {
    const n = Number(item.quantity);
    return acc + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  return Math.max(1, sum || 1);
}

function packageUnitPrice(pkg: ProductPackageWithItems): number {
  const raw = pkg.discount_price ?? pkg.original_price;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

type OrderEditModalProps = {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onSaved?: (order: Order) => void;
};

export function OrderEditModal({
  open,
  orderId,
  onClose,
  onSaved,
}: OrderEditModalProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<
    Array<
      Pick<
        Product,
        "id" | "name" | "sku_code" | "price" | "packages_enabled" | "weight"
      >
    >
  >([]);
  const [packages, setPackages] = useState<ProductPackageWithItems[]>([]);
  const [skuCode, setSkuCode] = useState<string | null>(null);
  const [unitPrice, setUnitPrice] = useState(0);
  const [packageCount, setPackageCount] = useState(1);
  const [packagesEnabled, setPackagesEnabled] = useState(false);
  const [form] = Form.useForm<EditOrderFormValues>();
  const quantity = Form.useWatch("quantity", form) ?? 1;
  const previewTotal = useMemo(
    () =>
      Number((unitPrice * Math.max(1, Number(quantity) || 1)).toFixed(2)),
    [unitPrice, quantity],
  );

  const loadProducts = async () => {
    const res = await apiFetch<
      Paginated<
        Pick<
          Product,
          | "id"
          | "name"
          | "sku_code"
          | "price"
          | "packages_enabled"
          | "weight"
        >
      >
    >("/api/products?page=1&pageSize=500");
    return res.data ?? [];
  };

  const loadPackages = async (productId: string) => {
    const res = await apiFetch<{ data: ProductPackageWithItems[] }>(
      `/api/products/${productId}/packages`,
    );
    return res.data ?? [];
  };

  const applyProductSync = async (
    productId: string,
    preferredPackageId?: string | null,
    productList = products,
  ) => {
    const product =
      productList.find((p) => p.id === productId) ??
      (await apiFetch<Product>(`/api/products/${productId}`));

    const pkgList = await loadPackages(productId);
    setPackages(pkgList);
    setSkuCode(product.sku_code ?? null);

    const usePackages = Boolean(product.packages_enabled) && pkgList.length > 0;
    setPackagesEnabled(usePackages);

    if (usePackages) {
      const selected =
        pkgList.find((p) => p.id === preferredPackageId) ?? pkgList[0];
      setPackageCount(packageItemCount(selected));
      setUnitPrice(packageUnitPrice(selected));
      form.setFieldsValue({
        product_id: productId,
        package_id: selected.id,
      });
    } else {
      setPackageCount(1);
      setUnitPrice(Number(product.price) || 0);
      form.setFieldsValue({
        product_id: productId,
        package_id: undefined,
      });
    }
  };

  const applyPackageSync = (packageId: string) => {
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    setPackageCount(packageItemCount(pkg));
    setUnitPrice(packageUnitPrice(pkg));
    form.setFieldsValue({ package_id: packageId });
  };

  const initFromOrder = async (data: Order) => {
    setOrder(data);
    const productList = await loadProducts();
    let list = productList;
    if (data.product_id && !list.some((p) => p.id === data.product_id)) {
      try {
        const current = await apiFetch<Product>(`/api/products/${data.product_id}`);
        list = [
          {
            id: current.id,
            name: current.name,
            sku_code: current.sku_code,
            price: current.price,
            packages_enabled: current.packages_enabled,
            weight: current.weight,
          },
          ...list,
        ];
      } catch {
        list = [
          {
            id: data.product_id,
            name: data.product_name || data.product_id,
            sku_code: data.sku_code,
            price: data.unit_price,
            packages_enabled: Boolean(data.package_id),
            weight: data.weight ?? 1,
          },
          ...list,
        ];
      }
    }
    setProducts(list);

    form.setFieldsValue({
      customer_name: data.customer_name,
      customer_phone: data.customer_phone ?? "",
      shipping_province: data.shipping_province ?? "",
      shipping_city: data.shipping_city ?? "",
      shipping_district: data.shipping_district ?? "",
      shipping_detail: data.shipping_detail ?? "",
      shipping_address: data.shipping_address ?? "",
      product_id: data.product_id ?? undefined,
      package_id: data.package_id ?? undefined,
      quantity: Math.max(1, Number(data.quantity) || 1),
      owner_member: data.owner_member ?? "",
      shipping_order_no: data.shipping_order_no ?? "",
    });

    if (data.product_id) {
      const pkgList = await loadPackages(data.product_id);
      setPackages(pkgList);
      const product =
        list.find((p) => p.id === data.product_id) ??
        (await apiFetch<Product>(`/api/products/${data.product_id}`));
      setSkuCode(product.sku_code ?? data.sku_code ?? null);
      const usePackages =
        Boolean(product.packages_enabled) && pkgList.length > 0;
      setPackagesEnabled(usePackages);
      if (usePackages) {
        const selected =
          pkgList.find((p) => p.id === data.package_id) ?? pkgList[0];
        setPackageCount(packageItemCount(selected));
        setUnitPrice(packageUnitPrice(selected));
        form.setFieldsValue({ package_id: selected.id });
      } else {
        setPackageCount(1);
        setUnitPrice(Number(product.price) || Number(data.unit_price) || 0);
        form.setFieldsValue({ package_id: undefined });
      }
    } else {
      setPackages([]);
      setSkuCode(data.sku_code);
      setUnitPrice(Number(data.unit_price) || 0);
      setPackageCount(Math.max(1, Number(data.package_count) || 1));
      setPackagesEnabled(false);
    }
  };

  useEffect(() => {
    if (!open || !orderId) {
      setOrder(null);
      form.resetFields();
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await apiFetch<Order>(`/api/orders/${orderId}`);
        if (cancelled) return;
        await initFromOrder(data);
      } catch (e) {
        if (cancelled) return;
        message.error(e instanceof Error ? e.message : "加载编辑数据失败");
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在打开/切换订单时加载
  }, [open, orderId]);

  const submit = async () => {
    if (!order) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: UpdateOrderInput = {
        customer_name: values.customer_name.trim(),
        customer_phone: values.customer_phone?.trim() || null,
        shipping_province: values.shipping_province?.trim() || null,
        shipping_city: values.shipping_city?.trim() || null,
        shipping_district: values.shipping_district?.trim() || null,
        shipping_detail: values.shipping_detail?.trim() || null,
        shipping_address: values.shipping_address?.trim() || null,
        quantity: values.quantity,
        owner_member: values.owner_member?.trim() || null,
        shipping_order_no: values.shipping_order_no?.trim() || null,
      };

      if (values.product_id) {
        payload.product_id = values.product_id;
        payload.package_id = packagesEnabled ? values.package_id || null : null;
      }

      const updated = await apiFetch<Order>(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      message.success("订单信息已更新");
      onSaved?.(updated);
      onClose();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="编辑订单"
      open={open}
      onCancel={() => {
        if (saving) return;
        onClose();
      }}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      destroyOnClose
      width={720}
    >
      <Spin spinning={loading}>
        <p style={{ color: "#666", marginBottom: 12 }}>
          更换商品或套餐时，中文属性、单价、套餐件数会按商品实际数据自动同步。
        </p>
        <Form form={form} layout="vertical" disabled={loading || !order}>
          <Space wrap style={{ width: "100%" }} size="middle">
            <Form.Item
              name="customer_name"
              label="收件人"
              rules={[{ required: true, message: "请填写收件人" }]}
              style={{ width: 220 }}
            >
              <Input maxLength={INPUT_LIMITS.name} />
            </Form.Item>
            <Form.Item
              name="customer_phone"
              label="收件人电话"
              style={{ width: 220 }}
            >
              <Input maxLength={INPUT_LIMITS.phone} />
            </Form.Item>
          </Space>
          <Space wrap style={{ width: "100%" }} size="middle">
            <Form.Item
              name="shipping_province"
              label="收件省"
              style={{ width: 140 }}
            >
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
            <Form.Item
              name="shipping_city"
              label="收件城市"
              style={{ width: 140 }}
            >
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
            <Form.Item
              name="shipping_district"
              label="收件地区"
              style={{ width: 140 }}
            >
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
          </Space>
          <Form.Item name="shipping_detail" label="收件地址">
            <Input maxLength={INPUT_LIMITS.address} />
          </Form.Item>
          <Form.Item name="shipping_address" label="收件地址信息">
            <Input maxLength={INPUT_LIMITS.addressInfo} />
          </Form.Item>
          <Form.Item
            name="product_id"
            label="商品"
            rules={[{ required: true, message: "请选择商品" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择商品"
              options={products.map((p) => ({
                value: p.id,
                label: p.name || p.id,
              }))}
              onChange={(productId: string) => {
                void applyProductSync(productId);
              }}
            />
          </Form.Item>
          {packagesEnabled ? (
            <Form.Item
              name="package_id"
              label="套餐"
              rules={[{ required: true, message: "请选择套餐" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择套餐"
                options={packages.map((p) => ({
                  value: p.id,
                  label: p.name_external
                    ? `${p.name}（${p.name_external}）`
                    : p.name,
                }))}
                onChange={(packageId: string) => {
                  applyPackageSync(packageId);
                }}
              />
            </Form.Item>
          ) : (
            <Form.Item label="套餐">
              <Input value="该商品未开启套餐" disabled />
            </Form.Item>
          )}
          <Space wrap style={{ width: "100%" }} size="middle">
            <Form.Item label="中文属性" style={{ width: 220 }}>
              <Input value={skuCode || "—"} disabled />
            </Form.Item>
            <Form.Item label="单价" style={{ width: 160 }}>
              <Input
                value={formatMoney(unitPrice, order?.currency)}
                disabled
              />
            </Form.Item>
            <Form.Item label="套餐内件数" style={{ width: 140 }}>
              <Input value={String(packageCount)} disabled />
            </Form.Item>
            <Form.Item
              name="quantity"
              label="购买数量"
              rules={[{ required: true, message: "请填写购买数量" }]}
              style={{ width: 140 }}
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="预估总金额" style={{ width: 180 }}>
              <Input
                value={formatMoney(previewTotal, order?.currency)}
                disabled
              />
            </Form.Item>
          </Space>
          <Space wrap style={{ width: "100%" }} size="middle">
            <Form.Item
              name="owner_member"
              label="归属成员"
              style={{ width: 220 }}
            >
              <Input maxLength={INPUT_LIMITS.shippingMeta} />
            </Form.Item>
            <Form.Item
              name="shipping_order_no"
              label="发货订单号"
              style={{ width: 220 }}
            >
              <Input maxLength={INPUT_LIMITS.shippingMeta} />
            </Form.Item>
          </Space>
        </Form>
      </Spin>
    </Modal>
  );
}
