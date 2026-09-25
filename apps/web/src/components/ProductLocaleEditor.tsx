import { useEffect, useState } from "react";
import {
  Button,
  Col,
  Form,
  Image,
  Input,
  Modal,
  Row,
  Space,
  Upload,
  message,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  isValidOverlayLocaleCode,
  localeDisplayLabel,
  saPathPrefixForLocale,
  type ProductLocale,
  type UpsertProductLocaleInput,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { SortableImageList } from "./SortableImageList";

const MAX_GALLERY = 20;
const MAX_DETAIL_IMAGES = 30;
const MAX_DESCRIPTION_ENTRIES = 30;

export type LocaleDraft = {
  title_external: string;
  facebook_pixel_id: string;
  google_conversion_id: string;
  google_label: string;
  description: string;
  description_entries: string[];
  cover_url: string | null;
  gallery_urls: string[];
  detail_image_urls: string[];
};

export function emptyLocaleDraft(): LocaleDraft {
  return {
    title_external: "",
    facebook_pixel_id: "",
    google_conversion_id: "",
    google_label: "",
    description: "",
    description_entries: [],
    cover_url: null,
    gallery_urls: [],
    detail_image_urls: [],
  };
}

export function localeFromApi(row: ProductLocale): LocaleDraft {
  return {
    title_external: row.title_external ?? "",
    facebook_pixel_id: row.facebook_pixel_id ?? "",
    google_conversion_id: row.google_conversion_id ?? "",
    google_label: row.google_label ?? "",
    description: row.description ?? "",
    description_entries: Array.isArray(row.description_entries)
      ? row.description_entries
      : [],
    cover_url: row.cover_url ?? null,
    gallery_urls: Array.isArray(row.gallery_urls) ? row.gallery_urls : [],
    detail_image_urls: Array.isArray(row.detail_image_urls)
      ? row.detail_image_urls
      : [],
  };
}

type ToolbarProps = {
  contentLocale: "default" | string;
  addedLocales: string[];
  linkSuffix?: string | null;
  /** 当前商品地区名称（如 ID / SA），决定默认主字段路径前缀 */
  regionName?: string | null;
  /** 自定义语言展示名（字段码 → 名称） */
  localeLabels?: Record<string, string>;
  onChangeLocale: (locale: "default" | string) => void;
  /** 添加并自动持久化；失败时抛错 */
  onAddLocale: (locale: string, label: string) => void | Promise<void>;
  /** 删除并持久化；失败时抛错 */
  onRemoveLocale: (locale: string) => void | Promise<void>;
};

export function ProductLocaleToolbar({
  contentLocale,
  addedLocales,
  linkSuffix,
  regionName,
  localeLabels = {},
  onChangeLocale,
  onAddLocale,
  onRemoveLocale,
}: ToolbarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [langName, setLangName] = useState("");
  const [langCode, setLangCode] = useState("");

  const defaultPrefix = saPathPrefixForLocale("default", regionName);
  const prefix = saPathPrefixForLocale(contentLocale, regionName);
  const pathHint = linkSuffix
    ? `${prefix}/${linkSuffix}`
    : `${prefix}/{link_suffix}`;

  const normalizedCode = langCode.trim().toLowerCase();
  const pathPreview = isValidOverlayLocaleCode(normalizedCode)
    ? saPathPrefixForLocale(normalizedCode, regionName)
    : normalizedCode
      ? "—"
      : defaultPrefix;

  const openAdd = () => {
    setLangName("");
    setLangCode("");
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const name = langName.trim();
    const code = langCode.trim().toLowerCase();
    if (!name) {
      message.error("请填写语言名称");
      return;
    }
    if (!isValidOverlayLocaleCode(code)) {
      message.error("字段须为 2 位小写字母，如 en、fr（不可用 id / ar / default）");
      return;
    }
    if (addedLocales.includes(code)) {
      message.error(`语言字段「${code}」已添加`);
      return;
    }
    setAdding(true);
    try {
      await onAddLocale(code, name);
      setAddOpen(false);
      onChangeLocale(code);
      message.success(`已添加并保存「${name}」`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "添加语言失败");
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = (code: string) => {
    Modal.confirm({
      title: `删除语言「${localeDisplayLabel(code, localeLabels[code])}」？`,
      content: "将删除该语言下的商品覆盖内容（套餐外文名需在套餐里另行清理）。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setRemovingCode(code);
        try {
          await onRemoveLocale(code);
          message.success("已删除该语言");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除语言失败");
          throw e;
        } finally {
          setRemovingCode(null);
        }
      },
    });
  };

  return (
    <div
      style={{
        marginBottom: 20,
        padding: "12px 14px",
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, marginRight: 4 }}>语言内容</span>
        <Button
          type={contentLocale === "default" ? "primary" : "default"}
          size="small"
          onClick={() => onChangeLocale("default")}
        >
          默认（主字段 {defaultPrefix}）
        </Button>
        {addedLocales.map((code) => (
          <Space.Compact key={code}>
            <Button
              type={contentLocale === code ? "primary" : "default"}
              size="small"
              onClick={() => onChangeLocale(code)}
            >
              {localeDisplayLabel(code, localeLabels[code])} · {code}（
              {saPathPrefixForLocale(code, regionName)}）
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={removingCode === code}
              onClick={() => confirmRemove(code)}
            >
              删除
            </Button>
          </Space.Compact>
        ))}
        <Button size="small" icon={<PlusOutlined />} onClick={openAdd}>
          添加语言
        </Button>
      </div>
      <div style={{ color: "#888", fontSize: 12 }}>
        当前落地页路径：<code>{pathHint}</code>
        {contentLocale !== "default"
          ? " · 仅编辑下列多语言字段；价格/SKU/套餐开关等仍在「默认」"
          : ` · 默认主字段路径 ${defaultPrefix}；覆盖语言路径为 /地区_语言字段（如 ${saPathPrefixForLocale("en", regionName)}）`}
      </div>

      <Modal
        title="添加语言"
        open={addOpen}
        onCancel={() => (adding ? undefined : setAddOpen(false))}
        onOk={() => void submitAdd()}
        okText="添加并保存"
        confirmLoading={adding}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label="语言"
            required
            extra="展示名称，如：英语、法语"
          >
            <Input
              value={langName}
              onChange={(e) => setLangName(e.target.value)}
              placeholder="英语"
              maxLength={32}
              disabled={adding}
            />
          </Form.Item>
          <Form.Item
            label="字段"
            required
            extra="路径用代码，2 位小写字母，如 en、fr"
          >
            <Input
              value={langCode}
              onChange={(e) => setLangCode(e.target.value)}
              placeholder="en"
              maxLength={5}
              disabled={adding}
            />
          </Form.Item>
          <Form.Item
            label="落地路径"
            extra="由「地区 slug + _ + 语言字段」拼接"
          >
            <Input value={pathPreview} readOnly />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

type LocaleEditorProps = {
  productId: string;
  locale: string;
  localeLabel?: string | null;
  draft: LocaleDraft;
  onChange: (next: LocaleDraft) => void;
  onSaved: (row: ProductLocale) => void;
};

export function ProductLocaleEditor({
  productId,
  locale,
  localeLabel,
  draft,
  onChange,
  onSaved,
}: LocaleEditorProps) {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [detailUploading, setDetailUploading] = useState(false);

  const patch = (partial: Partial<LocaleDraft>) =>
    onChange({ ...draft, ...partial });

  const uploadOne = async (file: File): Promise<string> => {
    const body = new FormData();
    body.append("file", file);
    const res = await apiFetch<{ url: string }>("/api/uploads/product-image", {
      method: "POST",
      body,
    });
    return res.url;
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: UpsertProductLocaleInput = {
        locale,
        label: localeLabel?.trim() || null,
        title_external: draft.title_external.trim() || null,
        facebook_pixel_id: draft.facebook_pixel_id.trim() || null,
        google_conversion_id: draft.google_conversion_id.trim() || null,
        google_label: draft.google_label.trim() || null,
        description: draft.description.trim() || null,
        description_entries: draft.description_entries
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, MAX_DESCRIPTION_ENTRIES),
        cover_url: draft.cover_url,
        gallery_urls: draft.gallery_urls.slice(0, MAX_GALLERY),
        detail_image_urls: draft.detail_image_urls.slice(0, MAX_DETAIL_IMAGES),
      };
      const saved = await apiFetch<ProductLocale>(
        `/api/products/${productId}/locales/${encodeURIComponent(locale)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      onSaved(saved);
      message.success(
        `已保存 ${localeDisplayLabel(locale, localeLabel)} 内容`,
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存语言内容失败");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    /* keep draft controlled by parent */
  }, [locale]);

  return (
    <div style={{ maxWidth: 720 }}>
      <Form layout="vertical">
        <Form.Item label="商品标题(外部)">
          <Input
            maxLength={INPUT_LIMITS.mediumText}
            value={draft.title_external}
            onChange={(e) => patch({ title_external: e.target.value })}
            placeholder="该语言落地页标题"
          />
        </Form.Item>
        <Row gutter={24}>
          <Col xs={24} md={12}>
            <Form.Item label="Facebook像素id" extra="多个用 # 隔开">
              <Input
                maxLength={INPUT_LIMITS.mediumText}
                value={draft.facebook_pixel_id}
                onChange={(e) => patch({ facebook_pixel_id: e.target.value })}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={24}>
          <Col xs={24} md={12}>
            <Form.Item label="Google转化ID">
              <Input
                maxLength={INPUT_LIMITS.shortId}
                value={draft.google_conversion_id}
                onChange={(e) =>
                  patch({ google_conversion_id: e.target.value })
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="Google Label">
              <Input
                maxLength={INPUT_LIMITS.mediumText}
                value={draft.google_label}
                onChange={(e) => patch({ google_label: e.target.value })}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="商品描述条目"
          extra={`最多 ${MAX_DESCRIPTION_ENTRIES} 条`}
        >
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {draft.description_entries.map((item, index) => (
              <div
                key={`entry-${index}`}
                style={{ display: "flex", gap: 8, width: "100%" }}
              >
                <Input
                  style={{ flex: 1 }}
                  maxLength={INPUT_LIMITS.mediumText}
                  value={item}
                  onChange={(e) => {
                    const next = [...draft.description_entries];
                    next[index] = e.target.value;
                    patch({ description_entries: next });
                  }}
                  placeholder={`描述条目 #${index + 1}`}
                />
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    patch({
                      description_entries: draft.description_entries.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                />
              </div>
            ))}
            {draft.description_entries.length < MAX_DESCRIPTION_ENTRIES ? (
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() =>
                  patch({
                    description_entries: [...draft.description_entries, ""],
                  })
                }
              >
                添加描述条目
              </Button>
            ) : null}
          </Space>
        </Form.Item>

        <Form.Item label="商品详情">
          <Input.TextArea
            rows={6}
            maxLength={INPUT_LIMITS.longText}
            showCount
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="商品封面">
          <Space direction="vertical">
            {draft.cover_url ? (
              <Image
                src={draft.cover_url}
                width={160}
                style={{ borderRadius: 4 }}
              />
            ) : null}
            <Upload
              accept="image/jpeg,image/png,image/webp,image/gif"
              showUploadList={false}
              beforeUpload={(file) => {
                void (async () => {
                  setUploading(true);
                  try {
                    const url = await uploadOne(file);
                    patch({ cover_url: url });
                  } catch (e) {
                    message.error(
                      e instanceof Error ? e.message : "上传失败",
                    );
                  } finally {
                    setUploading(false);
                  }
                })();
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传封面
              </Button>
            </Upload>
          </Space>
        </Form.Item>

        <Form.Item label="商品轮播图" extra={`最多 ${MAX_GALLERY} 张`}>
          <Space wrap size={12}>
            {draft.gallery_urls.map((url, index) => (
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
                <Image src={url} width={96} height={96} style={{ objectFit: "cover" }} />
                <Button
                  size="small"
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  style={{ position: "absolute", top: 4, right: 4 }}
                  onClick={() =>
                    patch({
                      gallery_urls: draft.gallery_urls.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                />
              </div>
            ))}
            {draft.gallery_urls.length < MAX_GALLERY ? (
              <Upload
                accept="image/jpeg,image/png,image/webp,image/gif"
                showUploadList={false}
                beforeUpload={(file) => {
                  void (async () => {
                    setGalleryUploading(true);
                    try {
                      const url = await uploadOne(file);
                      patch({
                        gallery_urls: [...draft.gallery_urls, url].slice(
                          0,
                          MAX_GALLERY,
                        ),
                      });
                    } catch (e) {
                      message.error(
                        e instanceof Error ? e.message : "上传失败",
                      );
                    } finally {
                      setGalleryUploading(false);
                    }
                  })();
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

        <Form.Item label="商品详情图片">
          <SortableImageList
            urls={draft.detail_image_urls}
            onChange={(urls) => patch({ detail_image_urls: urls })}
            max={MAX_DETAIL_IMAGES}
            uploading={detailUploading}
            onUpload={(file) => {
              void (async () => {
                setDetailUploading(true);
                try {
                  const url = await uploadOne(file);
                  patch({
                    detail_image_urls: [
                      ...draft.detail_image_urls,
                      url,
                    ].slice(0, MAX_DETAIL_IMAGES),
                  });
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "上传失败");
                } finally {
                  setDetailUploading(false);
                }
              })();
            }}
          />
        </Form.Item>

        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存本语言内容
        </Button>
      </Form>
    </div>
  );
}
