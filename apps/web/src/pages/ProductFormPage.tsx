import { useEffect, useState } from "react";
import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
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
import {
  CopyOutlined,
  UploadOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  type AddressLibrary,
  type Currency,
  type Product,
  type Profile,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { useAuth } from "../auth/AuthContext";
import { ProductPackageSettings } from "../components/ProductPackageSettings";
import { AuditLogPanel, formatActor } from "../components/AuditLogPanel";
import { SortableImageList } from "../components/SortableImageList";
import dayjs from "dayjs";

const MAX_GALLERY = 20;
const MAX_DETAIL_IMAGES = 30;
const MAX_EXTRA_HTML = 20;
const MAX_DESCRIPTION_ENTRIES = 30;

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  // DB 未迁到 text[] 时，数组常被存成 JSON 字符串
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      /* fall through */
    }
  }
  return [trimmed];
}

function normalizeExtraHtmlList(value: unknown): string[] {
  return normalizeStringList(value);
}

function normalizeDescriptionEntriesList(value: unknown): string[] {
  return normalizeStringList(value);
}

interface FormValues {
  name: string;
  description?: string;
  description_entries?: string[];
  price: number;
  cover_url?: string | null;
  link_suffix?: string;
  title_external?: string;
  facebook_pixel_id?: string;
  google_conversion_id?: string;
  google_label?: string;
  extra_html?: string[];
  sku_code?: string;
  sku_display?: string;
  packages_enabled?: boolean;
  sales_count?: number;
  weight?: number;
  region_id?: string | null;
  currency_id?: string | null;
  owner_ids?: string[];
}

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { isSuperAdmin, profile } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const [copyForm] = Form.useForm<{ link_suffix: string }>();
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [detailUploading, setDetailUploading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const [regions, setRegions] = useState<AddressLibrary[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [owners, setOwners] = useState<Profile[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const packagesEnabled = Form.useWatch("packages_enabled", form) ?? false;
  const watchedCurrencyId = Form.useWatch("currency_id", form) as
    | string
    | null
    | undefined;
  /** 只有已保存过基本信息的商品才能配置套餐 */
  const canEditPackages = Boolean(isEdit && id && product);
  const selectedCurrency =
    currencies.find((c) => c.id === watchedCurrencyId) ??
    product?.currency ??
    null;

  useEffect(() => {
    if ((!packagesEnabled || !canEditPackages) && activeTab === "packages") {
      setActiveTab("basic");
    }
  }, [packagesEnabled, canEditPackages, activeTab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRegionsLoading(true);
      try {
        const res = await apiFetch<{ data: AddressLibrary[] }>(
          "/api/address-libraries",
        );
        if (!cancelled) setRegions(res.data);
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载地区失败");
        }
      } finally {
        if (!cancelled) setRegionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCurrenciesLoading(true);
      try {
        const res = await apiFetch<{ data: Currency[] }>(
          "/api/currencies?enabled=1",
        );
        if (cancelled) return;
        setCurrencies(res.data);
        if (!id) {
          const def = res.data.find((c) => c.is_default) ?? res.data[0];
          if (def) form.setFieldValue("currency_id", def.id);
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载币种失败");
        }
      } finally {
        if (!cancelled) setCurrenciesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, form]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      setOwnersLoading(true);
      try {
        const res = await apiFetch<{ data: Profile[] }>("/api/employees");
        if (cancelled) return;
        setOwners(res.data.filter((p) => p.is_active && p.role === "employee"));
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载员工列表失败");
        }
      } finally {
        if (!cancelled) setOwnersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const ownerOptions = (() => {
    const map = new Map(
      owners.map((p) => [
        p.id,
        {
          value: p.id,
          label: p.display_name || p.email || p.id,
        },
      ]),
    );
    for (const o of product?.owners ?? []) {
      if (!map.has(o.id)) {
        map.set(o.id, {
          value: o.id,
          label: o.display_name || o.id,
        });
      }
    }
    if (!isSuperAdmin && profile?.id && !map.has(profile.id)) {
      map.set(profile.id, {
        value: profile.id,
        label: profile.display_name || profile.email || profile.id,
      });
    }
    return [...map.values()];
  })();

  // 员工新建时锁定所属人为自己
  useEffect(() => {
    if (isSuperAdmin || isEdit || !profile?.id) return;
    form.setFieldsValue({ owner_ids: [profile.id] });
  }, [isSuperAdmin, isEdit, profile?.id, form]);

  useEffect(() => {
    const cur = product?.currency;
    if (!cur) return;
    setCurrencies((prev) =>
      prev.some((c) => c.id === cur.id)
        ? prev
        : [
            ...prev,
            {
              id: cur.id,
              code: cur.code,
              name: cur.name,
              name_zh: cur.name_zh,
              symbol: cur.symbol,
              symbol_suffix: cur.symbol_suffix,
              numeric_code: null,
              is_default: false,
              enabled: false,
              sort_order: 0,
              created_at: "",
              updated_at: "",
            },
          ],
    );
  }, [product?.currency]);

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
          description_entries: normalizeDescriptionEntriesList(
            data.description_entries,
          ),
          price: Number(data.price),
          cover_url: data.cover_url,
          link_suffix: data.link_suffix ?? undefined,
          title_external: data.title_external ?? undefined,
          facebook_pixel_id: data.facebook_pixel_id ?? undefined,
          google_conversion_id: data.google_conversion_id ?? undefined,
          google_label: data.google_label ?? undefined,
          extra_html: normalizeExtraHtmlList(data.extra_html),
          sku_code: data.sku_code ?? undefined,
          sku_display: data.sku_display ?? undefined,
          packages_enabled: data.packages_enabled ?? false,
          sales_count: Number(data.sales_count ?? 0),
          weight: Number(data.weight ?? 1),
          region_id: data.region_id ?? undefined,
          currency_id: data.currency_id ?? undefined,
          owner_ids: data.owner_ids ?? data.owners?.map((o) => o.id) ?? [],
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
      description_entries: (values.description_entries ?? [])
        .map((item) => item?.trim() || "")
        .filter(Boolean)
        .slice(0, MAX_DESCRIPTION_ENTRIES),
      price: values.price ?? 0,
      status: asDraft ? "draft" : "on_sale",
      cover_url: coverUrl,
      gallery_urls: galleryUrls,
      detail_image_urls: detailImageUrls,
      link_suffix: suffix || null,
      title_external: values.title_external?.trim() || null,
      facebook_pixel_id: values.facebook_pixel_id?.trim() || null,
      google_conversion_id: values.google_conversion_id?.trim() || null,
      google_label: values.google_label?.trim() || null,
      extra_html: (values.extra_html ?? [])
        .map((item) => item?.trim() || "")
        .filter(Boolean)
        .slice(0, MAX_EXTRA_HTML),
      sku_code: values.sku_code?.trim() || null,
      sku_display: values.sku_display?.trim() || null,
      packages_enabled: Boolean(values.packages_enabled),
      sales_count: Math.max(0, Math.floor(Number(values.sales_count ?? 0))),
      weight: values.weight ?? 1,
      region_id: values.region_id || null,
      currency_id: values.currency_id || null,
      ...(isSuperAdmin ? { owner_ids: values.owner_ids ?? [] } : {}),
    };
  };

  const persistProduct = async (
    payload: ReturnType<typeof buildPayload>,
    opts?: { afterSave?: "packages" | "stay" | "list" },
  ) => {
    if (isEdit && id) {
      let updated = await apiFetch<Product>(`/api/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      // 全量保存若未带上状态变更，再用专用接口确保草稿→在售生效
      if (payload.status && updated.status !== payload.status) {
        updated = await apiFetch<Product>(`/api/products/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: payload.status }),
        });
      }
      if (opts?.afterSave === "list") {
        navigate("/products");
        return updated;
      }
      setProduct(updated);
      form.setFieldsValue({
        name: updated.name,
        link_suffix: updated.link_suffix ?? undefined,
        description_entries: normalizeDescriptionEntriesList(
          updated.description_entries,
        ),
        extra_html: normalizeExtraHtmlList(updated.extra_html),
        owner_ids: updated.owner_ids ?? updated.owners?.map((o) => o.id) ?? [],
      });
      if (!updated.packages_enabled) setActiveTab("basic");
      else if (opts?.afterSave === "packages") setActiveTab("packages");
      return updated;
    }

    const created = await apiFetch<Product>("/api/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (opts?.afterSave === "list") {
      navigate("/products");
      return created;
    }
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
      const allValues = form.getFieldsValue(true) as FormValues;
      if (product?.status === "on_sale") {
        message.warning("当前商品为在售。保存草稿会改为草稿状态；上架请点「保存并上架」");
      }
      setSaving(true);
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

  const openCopyModal = () => {
    copyForm.resetFields();
    setCopyOpen(true);
  };

  const submitCopy = async () => {
    if (!id) return;
    try {
      const values = await copyForm.validateFields();
      const suffix = values.link_suffix?.trim();
      if (!suffix) {
        message.error("请填写新的链接后缀");
        return;
      }
      setCopying(true);
      const created = await apiFetch<Product>(`/api/products/${id}/copy`, {
        method: "POST",
        body: JSON.stringify({ link_suffix: suffix }),
      });
      setCopyOpen(false);
      message.success("商品已复制为草稿，可继续编辑");
      navigate(`/products/${created.id}/edit`);
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "复制失败");
    } finally {
      setCopying(false);
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
        price: 0,
        sales_count: 0,
        weight: 1,
        packages_enabled: false,
        description_entries: [],
        extra_html: [],
        ...(!isSuperAdmin && profile?.id
          ? { owner_ids: [profile.id] }
          : {}),
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
          await persistProduct(payload, { afterSave: "list" });
          message.success("已保存并上架");
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
        <Input maxLength={INPUT_LIMITS.shortId} placeholder="例如 jhbg" />
      </Form.Item>
      {isSuperAdmin ? (
        <Form.Item
          label="所属人"
          name="owner_ids"
          rules={[
            {
              required: true,
              type: "array",
              min: 1,
              message: "请至少选择一名所属人",
            },
          ]}
          extra="可多选；被指定的员工可管理此商品及关联订单"
        >
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            loading={ownersLoading}
            placeholder="请选择所属员工（可多选）"
            options={ownerOptions}
          />
        </Form.Item>
      ) : (
        <Form.Item
          label="所属人"
          name="owner_ids"
          extra="所属人为当前登录账号，不可修改"
        >
          <Select
            mode="multiple"
            disabled
            options={ownerOptions}
            placeholder={
              profile?.display_name || profile?.email || "当前员工"
            }
          />
        </Form.Item>
      )}
      <Form.Item
        label="地区"
        name="region_id"
        rules={[{ required: true, message: "请选择地区" }]}
        extra={
          regions.length === 0 && !regionsLoading ? (
            <span>
              暂无地区，请先到{" "}
              <Link to="/address-regions">地区管理</Link> 新增
            </span>
          ) : (
            "上架前须选择地区"
          )
        }
      >
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          loading={regionsLoading}
          placeholder="请选择地区"
          options={regions.map((r) => {
            const parts = [
              r.name,
              r.dial_code ? `+${r.dial_code}` : null,
              r.remark || null,
            ].filter(Boolean);
            return {
              value: r.id,
              label:
                parts.length > 1
                  ? `${parts[0]}（${parts.slice(1).join(" · ")}）`
                  : parts[0],
            };
          })}
        />
      </Form.Item>
      <Form.Item
        label="币种"
        name="currency_id"
        rules={[{ required: true, message: "请选择币种" }]}
        extra={
          currencies.length === 0 && !currenciesLoading ? (
            <span>
              暂无币种，请先到 <Link to="/currencies">币种管理</Link> 新增
            </span>
          ) : (
            "上架前须选择币种；价格按所选币种展示"
          )
        }
      >
        <Select
          showSearch
          optionFilterProp="label"
          loading={currenciesLoading}
          placeholder="请选择币种"
          options={currencies.map((c) => ({
            value: c.id,
            label: `${c.code} ${c.symbol} · ${c.name_zh}`,
          }))}
        />
      </Form.Item>
      <Form.Item label="商品标题(内部)" name="name">
        <Input maxLength={INPUT_LIMITS.name} placeholder="例如 九黑饼干" />
      </Form.Item>
      <Form.Item label="商品标题(外部)" name="title_external">
        <Input
          maxLength={INPUT_LIMITS.mediumText}
          placeholder="面向站点展示的标题"
        />
      </Form.Item>
      <Row gutter={24} align="top">
        <Col xs={24} md={12}>
          <Form.Item
            label="Facebook像素id"
            name="facebook_pixel_id"
            extra="多个用 # 隔开"
          >
            <Input
              maxLength={INPUT_LIMITS.mediumText}
              placeholder="请输入，多个用#隔开"
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={24} align="top">
        <Col xs={24} md={12}>
          <Form.Item label="Google转化ID" name="google_conversion_id">
            <Input
              maxLength={INPUT_LIMITS.shortId}
              placeholder="例如 11083389190"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="Google Label" name="google_label">
            <Input
              maxLength={INPUT_LIMITS.mediumText}
              placeholder="例如 purchase / AW-xxx/label"
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        label="附加HTML代码"
        extra={`可添加多段，落地页按顺序注入，最多 ${MAX_EXTRA_HTML} 条`}
      >
        <Form.List name="extra_html">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    width: "100%",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Form.Item
                      {...field}
                      noStyle
                      rules={[
                        {
                          validator: async (_, value) => {
                            if (
                              typeof value === "string" &&
                              value.length > INPUT_LIMITS.extraHtml
                            ) {
                              throw new Error("单段 HTML 过长");
                            }
                          },
                        },
                      ]}
                    >
                      <Input.TextArea
                        rows={6}
                        maxLength={INPUT_LIMITS.extraHtml}
                        showCount
                        placeholder={`粘贴 HTML / 脚本代码 #${index + 1}`}
                        style={{
                          width: "100%",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      />
                    </Form.Item>
                  </div>
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    aria-label={`删除第 ${index + 1} 段 HTML`}
                  />
                </div>
              ))}
              {fields.length < MAX_EXTRA_HTML ? (
                <Button
                  type="dashed"
                  onClick={() => add("")}
                  icon={<PlusOutlined />}
                  block
                >
                  添加一条 HTML 代码
                </Button>
              ) : null}
            </Space>
          )}
        </Form.List>
      </Form.Item>
      <Form.Item
        label="规格值（后端SKU）"
        name="sku_code"
        extra="物流/财务导出「中文属性*数量」，如 jhbg、htb-dz"
      >
        <Input maxLength={INPUT_LIMITS.shortId} placeholder="例如 jhbg" />
      </Form.Item>
      <Form.Item label="对应外语（前端显示SKU）" name="sku_display">
        <Input
          maxLength={INPUT_LIMITS.mediumText}
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
        label="商品描述条目"
        extra={`落地页「Yang Anda Dapatkan」卖点列表，最多 ${MAX_DESCRIPTION_ENTRIES} 条`}
      >
        <Form.List name="description_entries">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    width: "100%",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Form.Item
                      {...field}
                      noStyle
                      rules={[
                        {
                          validator: async (_, value) => {
                            if (
                              typeof value === "string" &&
                              value.length > INPUT_LIMITS.mediumText
                            ) {
                              throw new Error("单条描述过长");
                            }
                          },
                        },
                      ]}
                    >
                      <Input
                        maxLength={INPUT_LIMITS.mediumText}
                        showCount
                        placeholder={`描述条目 #${index + 1}`}
                      />
                    </Form.Item>
                  </div>
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    aria-label={`删除第 ${index + 1} 条描述`}
                  />
                </div>
              ))}
              {fields.length < MAX_DESCRIPTION_ENTRIES ? (
                <Button
                  type="dashed"
                  onClick={() => add("")}
                  icon={<PlusOutlined />}
                  block
                >
                  添加描述条目
                </Button>
              ) : null}
            </Space>
          )}
        </Form.List>
      </Form.Item>
      <Form.Item
        label="商品详情"
        name="description"
        extra="纯文字商品详情描述（无描述条目时，落地页可从此解析卖点）"
      >
        <Input.TextArea
          rows={6}
          maxLength={INPUT_LIMITS.longText}
          showCount
        />
      </Form.Item>
      <Space size="large" style={{ display: "flex" }} wrap>
        <Form.Item
          label={
            selectedCurrency
              ? `价格（${selectedCurrency.code} ${selectedCurrency.symbol}）`
              : "价格"
          }
          name="price"
          rules={[{ required: true, message: "请输入价格" }]}
          extra="开启套餐后，实际售价以套餐折扣价为准"
        >
          <InputNumber min={0} precision={2} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          label="虚拟销量"
          name="sales_count"
          extra="落地页展示用，不会随真实订单增减"
        >
          <InputNumber min={0} precision={0} step={1} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item label="默认重量" name="weight">
          <InputNumber min={0} precision={2} style={{ width: 160 }} />
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
        extra={`详情页按此顺序展示；可拖拽图片或点左右箭头调整顺序。最多 ${MAX_DETAIL_IMAGES} 张，单张不超过 5MB`}
      >
        <SortableImageList
          urls={detailImageUrls}
          onChange={setDetailImageUrls}
          max={MAX_DETAIL_IMAGES}
          uploading={detailUploading}
          onUpload={(file) => {
            void uploadDetailImage(file);
          }}
        />
      </Form.Item>

      <Space wrap>
        <Button loading={saving} onClick={() => void saveDraft()}>
          保存草稿
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存并上架
        </Button>
        <Button onClick={() => navigate("/products")}>取消</Button>
      </Space>
      {!canEditPackages ? (
        <div style={{ marginTop: 12, color: "#999", fontSize: 13 }}>
          请先保存草稿（至少填写链接后缀），再进入「套餐设置」。
        </div>
      ) : null}
    </Form>
  );

  return (
    <div>
      <div className="page-header">
        <h1>{isEdit ? "编辑商品" : "新建商品"}</h1>
        <Space>
          {isEdit && id ? (
            <Button icon={<CopyOutlined />} onClick={openCopyModal}>
              复制商品
            </Button>
          ) : null}
          <Button>
            <Link to="/products">返回列表</Link>
          </Button>
        </Space>
      </div>

      <Modal
        title="复制商品"
        open={copyOpen}
        onCancel={() => {
          if (!copying) setCopyOpen(false);
        }}
        onOk={() => void submitCopy()}
        confirmLoading={copying}
        okText="确认复制"
        cancelText="取消"
        destroyOnClose
      >
        <p style={{ marginBottom: 16, color: "#666" }}>
          将复制当前商品的基本信息与套餐，新商品保存为草稿。请填写一个尚未使用的链接后缀。
        </p>
        <Form form={copyForm} layout="vertical">
          <Form.Item
            label="新链接后缀"
            name="link_suffix"
            rules={[{ required: true, message: "请填写新的链接后缀" }]}
            extra={
              product?.link_suffix
                ? `原后缀：${product.link_suffix}（不可重复使用）`
                : undefined
            }
          >
            <Input
              maxLength={INPUT_LIMITS.shortId}
              placeholder="例如 jhbg-copy"
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "basic",
            label: "基本信息",
            children: (
              <>
                {isEdit && product && !isSuperAdmin ? (
                  <div
                    style={{
                      marginBottom: 16,
                      color: "#666",
                      fontSize: 13,
                    }}
                  >
                    最后修改人：{formatActor(product.updater)}　更新于：
                    {dayjs(product.updated_at).format("YYYY-MM-DD HH:mm:ss")}
                  </div>
                ) : null}
                {isEdit && product && isSuperAdmin ? (
                  <div
                    style={{
                      marginBottom: 16,
                      color: "#666",
                      fontSize: 13,
                    }}
                  >
                    最后修改人：{formatActor(product.updater)}　更新于：
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
                      请先填写并保存草稿后，再配置套餐。套餐商品默认为当前商品。
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
