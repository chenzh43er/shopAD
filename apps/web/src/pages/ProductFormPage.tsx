import { useEffect, useState } from "react";
import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
  Upload,
  Image,
  Space,
  Spin,
  Tabs,
  message,
} from "antd";
import { UploadOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PRODUCT_STATUS_LABELS,
  type Product,
  type ProductStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { ProductPackageSettings } from "../components/ProductPackageSettings";
import { AuditLogPanel, formatActor } from "../components/AuditLogPanel";
import dayjs from "dayjs";

const MAX_GALLERY = 20;
const MAX_DETAIL_IMAGES = 30;

interface FormValues {
  name: string;
  description?: string;
  price: number;
  stock: number;
  status: ProductStatus;
  cover_url?: string | null;
  link_suffix?: string;
  title_external?: string;
  facebook_pixel_id?: string;
  google_conversion_id?: string;
  extra_html?: string;
  sku_code?: string;
  sku_display?: string;
  packages_enabled?: boolean;
  weight?: number;
  item_category?: string;
  item_type?: string;
}

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [detailUploading, setDetailUploading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const packagesEnabled = Form.useWatch("packages_enabled", form) ?? false;
  /** 只有已保存过基本信息的商品才能配置套餐 */
  const canEditPackages = Boolean(isEdit && id && product);

  useEffect(() => {
    if ((!packagesEnabled || !canEditPackages) && activeTab === "packages") {
      setActiveTab("basic");
    }
  }, [packagesEnabled, canEditPackages, activeTab]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<Product>(`/api/products/${id}`);
        if (cancelled) return;
        setProduct(data);
        form.setFieldsValue({
          name: data.name,
          description: data.description ?? undefined,
          price: Number(data.price),
          stock: data.stock,
          status: data.status,
          cover_url: data.cover_url,
          link_suffix: data.link_suffix ?? undefined,
          title_external: data.title_external ?? undefined,
          facebook_pixel_id: data.facebook_pixel_id ?? undefined,
          google_conversion_id: data.google_conversion_id ?? undefined,
          extra_html: data.extra_html ?? undefined,
          sku_code: data.sku_code ?? undefined,
          sku_display: data.sku_display ?? undefined,
          packages_enabled: data.packages_enabled ?? false,
          weight: Number(data.weight ?? 1),
          item_category: data.item_category ?? undefined,
          item_type: data.item_type || "BARANG",
        });
        setCoverUrl(data.cover_url);
        setGalleryUrls(data.gallery_urls ?? []);
        setDetailImageUrls(data.detail_image_urls ?? []);
        if (!data.packages_enabled) setActiveTab("basic");
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        navigate("/products");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, form, navigate]);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string; path: string }>(
        "/api/uploads/product-image",
        { method: "POST", body },
      );
      setCoverUrl(res.url);
      form.setFieldValue("cover_url", res.url);
      message.success("图片上传成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const uploadGalleryImage = async (file: File) => {
    if (galleryUrls.length >= MAX_GALLERY) {
      message.warning(`轮播图最多 ${MAX_GALLERY} 张`);
      return;
    }
    setGalleryUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string; path: string }>(
        "/api/uploads/product-image",
        { method: "POST", body },
      );
      setGalleryUrls((prev) => [...prev, res.url].slice(0, MAX_GALLERY));
      message.success("轮播图已添加");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setGalleryUploading(false);
    }
  };

  const uploadDetailImage = async (file: File) => {
    if (detailImageUrls.length >= MAX_DETAIL_IMAGES) {
      message.warning(`详情图最多 ${MAX_DETAIL_IMAGES} 张`);
      return;
    }
    setDetailUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string; path: string }>(
        "/api/uploads/product-image",
        { method: "POST", body },
      );
      setDetailImageUrls((prev) =>
        [...prev, res.url].slice(0, MAX_DETAIL_IMAGES),
      );
      message.success("详情图已添加");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setDetailUploading(false);
    }
  };

  const buildPayload = (
    values: FormValues,
    options?: { asDraft?: boolean },
  ) => {
    const suffix = values.link_suffix?.trim() || "";
    const asDraft = Boolean(options?.asDraft);
    const name = asDraft
      ? suffix
      : values.name?.trim() || suffix || "未命名商品";

    return {
      name,
      description: values.description?.trim() || null,
      price: values.price ?? 0,
      stock: values.stock ?? 0,
      status: (asDraft ? "draft" : values.status) as ProductStatus,
      cover_url: coverUrl,
      gallery_urls: galleryUrls,
      detail_image_urls: detailImageUrls,
      link_suffix: suffix || null,
      title_external: values.title_external?.trim() || null,
      facebook_pixel_id: values.facebook_pixel_id?.trim() || null,
      google_conversion_id: values.google_conversion_id?.trim() || null,
      extra_html: values.extra_html?.trim() || null,
      sku_code: values.sku_code?.trim() || null,
      sku_display: values.sku_display?.trim() || null,
      packages_enabled: Boolean(values.packages_enabled),
      weight: values.weight ?? 1,
      item_category: values.item_category?.trim() || null,
      item_type: values.item_type?.trim() || "BARANG",
    };
  };

  const persistProduct = async (
    payload: ReturnType<typeof buildPayload>,
    opts?: { afterSave?: "packages" | "stay" },
  ) => {
    if (isEdit && id) {
      const updated = await apiFetch<Product>(`/api/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setProduct(updated);
      form.setFieldsValue({
        name: updated.name,
        status: updated.status,
        link_suffix: updated.link_suffix ?? undefined,
      });
      if (!updated.packages_enabled) setActiveTab("basic");
      else if (opts?.afterSave === "packages") setActiveTab("packages");
      return updated;
    }

    const created = await apiFetch<Product>("/api/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    navigate(`/products/${created.id}/edit`, { replace: true });
    if (created.packages_enabled && opts?.afterSave === "packages") {
      setActiveTab("packages");
    }
    return created;
  };

  const saveDraft = async () => {
    try {
      const values = await form.validateFields(["link_suffix"]);
      const suffix = values.link_suffix?.trim();
      if (!suffix) {
        message.error("填写链接后缀后才能保存草稿");
        return;
      }
      setSaving(true);
      const allValues = form.getFieldsValue(true) as FormValues;
      const payload = buildPayload(
        { ...allValues, link_suffix: suffix },
        { asDraft: true },
      );
      await persistProduct(payload, { afterSave: "stay" });
      message.success(`草稿已保存（名称：${suffix}）`);
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  const basicForm = (
    <Form<FormValues>
      form={form}
      layout="vertical"
      style={{ maxWidth: 720 }}
      initialValues={{
        status: "draft",
        stock: 0,
        price: 0,
        weight: 1,
        item_type: "BARANG",
        packages_enabled: false,
      }}
      onFinish={async (values) => {
        const suffix = values.link_suffix?.trim();
        if (!suffix) {
          message.error("请先填写链接后缀");
          return;
        }
        setSaving(true);
        try {
          const payload = buildPayload({ ...values, link_suffix: suffix });
          const saved = await persistProduct(payload, {
            afterSave: payload.packages_enabled ? "packages" : "stay",
          });
          message.success(
            saved.packages_enabled
              ? "基本信息已保存，可配置套餐"
              : "基本信息已保存",
          );
        } catch (e) {
          message.error(e instanceof Error ? e.message : "保存失败");
        } finally {
          setSaving(false);
        }
      }}
    >
      <Form.Item
        label="链接后缀"
        name="link_suffix"
        rules={[{ required: true, message: "请填写链接后缀" }]}
        extra="落地页路径后缀，如 jhbg；保存草稿时商品名称使用此后缀"
      >
        <Input maxLength={64} placeholder="例如 jhbg" />
      </Form.Item>
      <Form.Item label="商品标题(内部)" name="name">
        <Input maxLength={120} placeholder="例如 九黑饼干" />
      </Form.Item>
      <Form.Item label="商品标题(外部)" name="title_external">
        <Input maxLength={500} placeholder="面向站点展示的标题" />
      </Form.Item>
      <Row gutter={24} align="top">
        <Col xs={24} md={12}>
          <Form.Item
            label="Facebook像素id"
            name="facebook_pixel_id"
            extra="多个用 # 隔开"
          >
            <Input maxLength={500} placeholder="请输入，多个用#隔开" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="Google转化ID" name="google_conversion_id">
            <Input maxLength={64} placeholder="例如 11083389190" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        label="附加HTML代码"
        name="extra_html"
        extra="落地页可注入的自定义 HTML / 脚本代码"
      >
        <Input.TextArea
          rows={8}
          placeholder="粘贴需要附加到页面的 HTML 代码"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
      </Form.Item>
      <Form.Item
        label="规格值（后端SKU）"
        name="sku_code"
        extra="物流/财务导出「中文属性*数量」，如 jhbg、htb-dz"
      >
        <Input maxLength={64} placeholder="例如 jhbg" />
      </Form.Item>
      <Form.Item label="对应外语（前端显示SKU）" name="sku_display">
        <Input
          maxLength={500}
          placeholder="例如 Produk Halal Aman untuk Dibeli"
        />
      </Form.Item>
      <Form.Item
        label="是否开启套餐"
        name="packages_enabled"
        valuePropName="checked"
        extra="开启后可在「套餐设置」中配置多档套餐；关闭则前台不展示套餐选项"
      >
        <Switch />
      </Form.Item>
      <Form.Item
        label="商品详情"
        name="description"
        extra="纯文字商品详情描述"
      >
        <Input.TextArea rows={6} maxLength={5000} showCount />
      </Form.Item>
      <Space size="large" style={{ display: "flex" }} wrap>
        <Form.Item
          label="价格（元）"
          name="price"
          rules={[{ required: true, message: "请输入价格" }]}
          extra="开启套餐后，实际售价以套餐折扣价为准"
        >
          <InputNumber min={0} precision={2} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          label="库存"
          name="stock"
          rules={[{ required: true, message: "请输入库存" }]}
        >
          <InputNumber min={0} precision={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item label="默认重量" name="weight">
          <InputNumber min={0} precision={2} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          label="状态"
          name="status"
          rules={[{ required: true, message: "请选择状态" }]}
        >
          <Select
            style={{ width: 160 }}
            options={(
              Object.entries(PRODUCT_STATUS_LABELS) as [
                ProductStatus,
                string,
              ][]
            ).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
      </Space>
      <Space size="large" style={{ display: "flex" }} wrap>
        <Form.Item label="物品类别" name="item_category">
          <Input style={{ width: 200 }} maxLength={64} />
        </Form.Item>
        <Form.Item label="物品类型" name="item_type">
          <Input style={{ width: 200 }} maxLength={64} placeholder="BARANG" />
        </Form.Item>
      </Space>

      <Form.Item
        label="商品封面"
        name="cover_url"
        extra="运用于聚合页和后台列表，单张不超过 5MB，建议 1:1"
      >
        <Space direction="vertical">
          {coverUrl ? (
            <Image src={coverUrl} width={160} style={{ borderRadius: 4 }} />
          ) : null}
          <Upload
            accept="image/jpeg,image/png,image/webp,image/gif"
            showUploadList={false}
            beforeUpload={(file) => {
              void uploadImage(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              上传图片
            </Button>
          </Upload>
        </Space>
      </Form.Item>

      <Form.Item
        label="商品轮播图"
        extra={`落地页轮播展示，最多 ${MAX_GALLERY} 张，单张不超过 5MB，建议 1:1`}
      >
        <Space wrap size={12} align="start">
          {galleryUrls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              style={{
                position: "relative",
                width: 96,
                height: 96,
                border: "1px solid #f0f0f0",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <Image
                src={url}
                width={96}
                height={96}
                style={{ objectFit: "cover" }}
              />
              <Button
                size="small"
                danger
                type="primary"
                icon={<DeleteOutlined />}
                style={{ position: "absolute", top: 4, right: 4 }}
                onClick={() =>
                  setGalleryUrls((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>
          ))}
          {galleryUrls.length < MAX_GALLERY ? (
            <Upload
              accept="image/jpeg,image/png,image/webp,image/gif"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadGalleryImage(file);
                return false;
              }}
            >
              <Button
                style={{ width: 96, height: 96 }}
                icon={<PlusOutlined />}
                loading={galleryUploading}
              >
                上传
              </Button>
            </Upload>
          ) : null}
        </Space>
      </Form.Item>

      <Form.Item
        label="商品详情图片"
        extra={`详情页长图/说明图，最多 ${MAX_DETAIL_IMAGES} 张，单张不超过 5MB`}
      >
        <Space wrap size={12} align="start">
          {detailImageUrls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              style={{
                position: "relative",
                width: 96,
                height: 96,
                border: "1px solid #f0f0f0",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <Image
                src={url}
                width={96}
                height={96}
                style={{ objectFit: "cover" }}
              />
              <Button
                size="small"
                danger
                type="primary"
                icon={<DeleteOutlined />}
                style={{ position: "absolute", top: 4, right: 4 }}
                onClick={() =>
                  setDetailImageUrls((prev) =>
                    prev.filter((_, i) => i !== index),
                  )
                }
              />
            </div>
          ))}
          {detailImageUrls.length < MAX_DETAIL_IMAGES ? (
            <Upload
              accept="image/jpeg,image/png,image/webp,image/gif"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadDetailImage(file);
                return false;
              }}
            >
              <Button
                style={{ width: 96, height: 96 }}
                icon={<PlusOutlined />}
                loading={detailUploading}
              >
                上传
              </Button>
            </Upload>
          ) : null}
        </Space>
      </Form.Item>

      <Space wrap>
        <Button loading={saving} onClick={() => void saveDraft()}>
          保存草稿
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存基本信息
        </Button>
        <Button onClick={() => navigate("/products")}>取消</Button>
      </Space>
      {!canEditPackages ? (
        <div style={{ marginTop: 12, color: "#999", fontSize: 13 }}>
          请先保存基本信息（至少填写链接后缀并保存），再进入「套餐设置」。
        </div>
      ) : null}
    </Form>
  );

  return (
    <div>
      <div className="page-header">
        <h1>{isEdit ? "编辑商品" : "新建商品"}</h1>
        <Button>
          <Link to="/products">返回列表</Link>
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "basic",
            label: "基本信息",
            children: (
              <>
                {isEdit && product ? (
                  <div
                    style={{
                      marginBottom: 16,
                      color: "#666",
                      fontSize: 13,
                    }}
                  >
                    添加人：{formatActor(product.creator)}　最后修改人：
                    {formatActor(product.updater)}　更新于：
                    {dayjs(product.updated_at).format("YYYY-MM-DD HH:mm:ss")}
                  </div>
                ) : null}
                {basicForm}
              </>
            ),
          },
          ...(packagesEnabled
            ? [
                {
                  key: "packages",
                  label: "套餐设置",
                  disabled: !canEditPackages,
                  children: canEditPackages && id && product ? (
                    <ProductPackageSettings
                      productId={id}
                      currentProduct={{
                        id: product.id,
                        name: product.name,
                        cover_url: product.cover_url,
                      }}
                    />
                  ) : (
                    <div style={{ color: "#999", padding: "24px 0" }}>
                      请先填写并保存基本信息后，再配置套餐。套餐商品默认为当前商品。
                    </div>
                  ),
                },
              ]
            : []),
          ...(isEdit && id
            ? [
                {
                  key: "logs",
                  label: "操作日志",
                  children: (
                    <AuditLogPanel
                      entityType="product"
                      entityId={id}
                      refreshKey={product?.updated_at}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
