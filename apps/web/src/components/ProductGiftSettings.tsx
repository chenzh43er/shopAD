import { useCallback, useEffect, useState } from "react";
import {
  AutoComplete,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  GiftOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type {
  ProductGift,
  ProductGiftLocale,
  UpsertProductGiftInput,
  UpsertProductGiftsBody,
} from "@shopad/shared";
import {
  localeDisplayLabel,
  saPathPrefixForLocale,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { ThumbImage } from "./ThumbImage";

type LookupProduct = {
  id: string;
  name: string;
  /** 商品标题(外部) */
  title_external: string | null;
  /** 各语言版本的商品标题(外部)，key 如 en */
  title_external_locales?: Record<string, string> | null;
  cover_url: string | null;
  sku_code: string | null;
  link_suffix: string | null;
  status: string;
  packages_enabled: boolean;
};

type LookupPackage = {
  id: string;
  name: string;
  name_external: string;
  is_visible: boolean;
};

type LookupCandidate = {
  product: LookupProduct;
  packages: LookupPackage[];
};

type DraftGift = {
  key: string;
  gift_product: LookupProduct | null;
  package_id: string | null;
  /** 已选套餐名称（接口回填 / 添加时快照，避免 packages_enabled=false 时列表空白） */
  package_name: string | null;
  quantity: number;
  /** 赠品自定义显示名称（为空时用赠品商品标题(外部)） */
  gift_name: string;
  /** locale → 赠品名称覆盖 */
  locales: Record<string, string>;
  /** 是否处于编辑态 */
  editing?: boolean;
  /** 进入编辑前的原值，取消编辑时回滚 */
  origin?: {
    package_id: string | null;
    package_name: string | null;
    quantity: number;
    gift_name: string;
    locales: Record<string, string>;
  } | null;
};

function localesFromApi(
  rows: ProductGiftLocale[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows ?? []) {
    const name = (row.gift_name ?? "").trim();
    if (name) out[row.locale] = name;
  }
  return out;
}

/** 赠品展示名：自定义名称优先，否则用赠品商品的标题(外部)，再回退内部名称 */
function giftDisplayName(
  giftName: string | null | undefined,
  product: LookupProduct | null,
): string {
  const custom = (giftName ?? "").trim();
  if (custom) return custom;
  const external = (product?.title_external ?? "").trim();
  if (external) return external;
  return (product?.name ?? "").trim();
}

/**
 * 非默认语言下赠品名称的默认值：
 * 该语言版本的商品标题(外部) → 默认商品标题(外部) → 内部名称。
 * 与前台一致：多语言时留空即默认该语言版本的商品标题(外部)。
 */
function giftLocaleDefaultName(
  product: LookupProduct | null,
  locale: string,
): string {
  const localized = (product?.title_external_locales?.[locale] ?? "").trim();
  if (localized) return localized;
  return giftDisplayName("", product);
}

/** 固定长度显示：超出部分省略号，鼠标悬停显示完整内容 */
function truncateText(text: string, max: number): string {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Props {
  productId: string;
  currentProduct: { id: string; name: string };
  /** 当前商品所属地区名（赠品仅可从同地区商品中选取） */
  regionName?: string | null;
  /** 与赠品页语言工具栏同步：default | en | fr … */
  contentLocale?: "default" | string;
  addedLocales?: string[];
  localeLabels?: Record<string, string>;
  /** 赠品保存成功后回调（用于刷新操作日志面板） */
  onChanged?: () => void;
}

export function ProductGiftSettings({
  productId,
  currentProduct,
  regionName,
  contentLocale = "default",
  addedLocales = [],
  localeLabels = {},
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gifts, setGifts] = useState<DraftGift[]>([]);
  /** 默认语言下的赠品区块总标题 */
  const [giftsTitle, setGiftsTitle] = useState("");
  /** locale → 赠品区块总标题 */
  const [giftsTitleLocales, setGiftsTitleLocales] = useState<
    Record<string, string>
  >({});
  /** 上次落库的总标题快照，用于判断是否有未保存改动 */
  const [savedTitle, setSavedTitle] = useState<{
    giftsTitle: string;
    giftsTitleLocales: Record<string, string>;
  }>({ giftsTitle: "", giftsTitleLocales: {} });
  const [packages, setPackages] = useState<Record<string, LookupPackage[]>>({});
  const [candidates, setCandidates] = useState<LookupCandidate[]>([]);
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);

  /** 选中的候选（待确认添加） */
  const [selected, setSelected] = useState<LookupCandidate | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [selectedQuantity, setSelectedQuantity] = useState(1);

  const editingLocale =
    contentLocale !== "default" ? contentLocale : null;
  const localeLabel = editingLocale
    ? localeDisplayLabel(editingLocale, localeLabels[editingLocale])
    : null;

  const loadPackages = useCallback(
    async (product: LookupProduct) => {
      // 赠品场景：商品可能未开启「套餐售卖」，但仍有 product_packages 可选；
      // 不能因 packages_enabled=false 就跳过加载，否则列表会误显示「未启用套餐」。
      if (packages[product.id]) return;
      if (!product.link_suffix) {
        setPackages((prev) => ({ ...prev, [product.id]: [] }));
        return;
      }
      try {
        const res = await apiFetch<{
          data: { product: LookupProduct; packages: LookupPackage[] };
        }>(
          `/api/products/lookup?link_suffix=${encodeURIComponent(
            product.link_suffix,
          )}&owner_product_id=${encodeURIComponent(productId)}`,
        );
        setPackages((prev) => ({
          ...prev,
          [product.id]: res.data.packages ?? [],
        }));
      } catch {
        setPackages((prev) => ({ ...prev, [product.id]: [] }));
      }
    },
    [packages, productId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        data: ProductGift[];
        gifts_title?: string | null;
        gifts_title_locales?: Record<string, string>;
      }>(`/api/products/${productId}/gifts`);
      const drafts: DraftGift[] = (res.data ?? []).map((gift) => ({
        key: gift.id,
        gift_product: gift.gift_product
          ? {
              id: gift.gift_product.id,
              name: gift.gift_product.name,
              title_external: gift.gift_product.title_external ?? null,
              title_external_locales:
                gift.gift_product.title_external_locales ?? null,
              cover_url: gift.gift_product.cover_url,
              sku_code: gift.gift_product.sku_code,
              link_suffix: gift.gift_product.link_suffix,
              status: "on_sale",
              packages_enabled: gift.gift_product.packages_enabled,
            }
          : null,
        package_id: gift.package_id,
        package_name: gift.package?.name?.trim() || null,
        quantity: gift.quantity,
        gift_name: (gift.gift_name ?? "").trim(),
        locales: localesFromApi(gift.locales as ProductGiftLocale[]),
        editing: false,
        origin: null,
      }));
      setGifts(drafts);
      setGiftsTitle(
        typeof res.gifts_title === "string" ? res.gifts_title.trim() : "",
      );
      const nextTitle = res.gifts_title_locales && typeof res.gifts_title_locales === "object"
        ? Object.fromEntries(
            Object.entries(res.gifts_title_locales).filter(
              ([, v]) => typeof v === "string" && v.trim(),
            ),
          )
        : {};
      setGiftsTitleLocales(nextTitle);
      setSavedTitle({
        giftsTitle:
          typeof res.gifts_title === "string" ? res.gifts_title.trim() : "",
        giftsTitleLocales: nextTitle,
      });
      for (const draft of drafts) {
        if (draft.gift_product) void loadPackages(draft.gift_product);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载赠品失败");
    } finally {
      setLoading(false);
    }
  }, [productId, loadPackages]);

  useEffect(() => {
    void load();
    // loadPackages 依赖 packages，仅按 productId 重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const updateGift = (key: string, patch: Partial<DraftGift>) => {
    setGifts((prev) =>
      prev.map((g) => (g.key === key ? { ...g, ...patch } : g)),
    );
  };

  const updateLocaleName = (key: string, locale: string, name: string) => {
    setGifts((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        const next = { ...g.locales };
        const trimmed = name.trim();
        if (!trimmed) delete next[locale];
        else next[locale] = name;
        return { ...g, locales: next };
      }),
    );
  };

  /** 自动补全：按商品内部名称或链接后缀模糊搜索（仅当前商品同地区） */
  const searchGifts = useCallback(
    async (keyword: string) => {
      const q = keyword.trim();
      if (!q) {
        setCandidates([]);
        return;
      }
      setSearching(true);
      try {
        const res = await apiFetch<{ data: { candidates: LookupCandidate[] } }>(
          `/api/products/lookup?q=${encodeURIComponent(
            q,
          )}&owner_product_id=${encodeURIComponent(productId)}`,
        );
        setCandidates(res.data.candidates ?? []);
      } catch {
        setCandidates([]);
      } finally {
        setSearching(false);
      }
    },
    [productId],
  );

  /** 点击候选：仅回填并展示详情，等待用户确认添加 */
  const pickCandidate = (candidate: LookupCandidate) => {
    setSelected(candidate);
    setSelectedPackageId(null);
    setSelectedQuantity(1);
    setPackages((prev) => ({
      ...prev,
      [candidate.product.id]: candidate.packages,
    }));
    setKeyword("");
    setCandidates([]);
  };

  const resetSelected = () => {
    setSelected(null);
    setSelectedPackageId(null);
    setSelectedQuantity(1);
  };

  /** 确认添加：直接加入赠品列表并立即落库 */
  const confirmAdd = async () => {
    if (!selected) return;
    const product = selected.product;
    if (product.id === productId) {
      message.error("赠品不能是当前商品本身");
      return;
    }
    if (!selectedPackageId) {
      message.error("请先选择赠品套餐");
      return;
    }
    if ((selected.packages ?? []).length === 0) {
      message.error("该商品没有可用套餐，无法添加为赠品");
      return;
    }
    // 同一赠品商品可重复添加，仅「商品 + 套餐 + 数量」组合不可重复
    const duplicated = gifts.some(
      (g) =>
        g.gift_product?.id === product.id &&
        (g.package_id ?? null) === (selectedPackageId ?? null) &&
        g.quantity === selectedQuantity,
    );
    if (duplicated) {
      message.error("该商品 + 套餐 + 数量组合已存在");
      return;
    }
    const selectedPkgName =
      (selected.packages ?? []).find((p) => p.id === selectedPackageId)
        ?.name ?? null;
    const next = [
      ...gifts,
      {
        key: newKey(),
        gift_product: product,
        package_id: selectedPackageId,
        package_name: selectedPkgName,
        quantity: selectedQuantity,
        gift_name: "",
        locales: {},
        editing: false,
        origin: null,
      },
    ];
    setGifts(next);
    const ok = await persist(next, `已添加赠品「${product.name}」`);
    if (ok) resetSelected();
  };

  /** 进入编辑：记录原值以便取消 */
  const startEdit = (row: DraftGift) => {
    if (row.gift_product) void loadPackages(row.gift_product);
    setGifts((prev) =>
      prev.map((g) =>
        g.key === row.key
          ? {
              ...g,
              editing: true,
              origin: {
                package_id: g.package_id,
                package_name: g.package_name,
                quantity: g.quantity,
                gift_name: g.gift_name,
                locales: { ...g.locales },
              },
            }
          : g,
      ),
    );
  };

  /** 取消编辑：回滚原值 */
  const cancelEdit = (row: DraftGift) => {
    setGifts((prev) =>
      prev.map((g) =>
        g.key === row.key
          ? {
              ...g,
              editing: false,
              origin: null,
              package_id: g.origin?.package_id ?? null,
              package_name: g.origin?.package_name ?? null,
              quantity: g.origin?.quantity ?? g.quantity,
              gift_name: g.origin?.gift_name ?? g.gift_name,
              locales: g.origin?.locales ?? g.locales,
            }
          : g,
      ),
    );
  };

  /** 删除：确认后移除并落库 */
  const removeRow = (row: DraftGift) => {
    const name = giftDisplayName(row.gift_name, row.gift_product) || "该赠品";
    Modal.confirm({
      title: "删除赠品",
      content: `确定删除赠品「${name}」吗？删除后该商品不再附带此赠品。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const next = gifts.filter((g) => g.key !== row.key);
        setGifts(next);
        await persist(next, "赠品已删除");
      },
    });
  };

  const updateSectionTitle = (value: string) => {
    if (editingLocale) {
      setGiftsTitleLocales((prev) => {
        const next = { ...prev };
        const trimmed = value.trim();
        if (!trimmed) delete next[editingLocale];
        else next[editingLocale] = value;
        return next;
      });
      return;
    }
    setGiftsTitle(value);
  };

  /** 落库：把待保存列表整体提交（后端 replace-all），并同步赠品总标题 */
  const persist = async (
    list: DraftGift[],
    successText: string,
    titleState?: {
      giftsTitle: string;
      giftsTitleLocales: Record<string, string>;
    },
  ) => {
    const combos = new Set<string>();
    for (const [index, gift] of list.entries()) {
      if (!gift.gift_product) {
        message.error(`第 ${index + 1} 个赠品：请先选择赠品商品`);
        return false;
      }
      if (!Number.isFinite(gift.quantity) || gift.quantity < 1) {
        message.error(`赠品「${gift.gift_product.name}」数量无效`);
        return false;
      }
      // 同一赠品商品可重复，仅「商品 + 套餐 + 数量」组合不可重复
      const combo = `${gift.gift_product.id}|${gift.package_id ?? ""}|${
        gift.quantity
      }`;
      if (combos.has(combo)) {
        message.error(
          `第 ${index + 1} 个赠品：商品 + 套餐 + 数量组合重复，请调整套餐或数量`,
        );
        return false;
      }
      combos.add(combo);
    }

    const payload: UpsertProductGiftInput[] = list.map((gift, index) => {
      const locales: Record<string, { gift_name: string }> = {};
      for (const [code, name] of Object.entries(gift.locales)) {
        const trimmed = name.trim();
        if (trimmed) locales[code] = { gift_name: trimmed };
      }
      return {
        gift_product_id: gift.gift_product!.id,
        package_id: gift.package_id,
        quantity: Math.floor(gift.quantity),
        gift_name: gift.gift_name.trim() ? gift.gift_name.trim() : null,
        locales: Object.keys(locales).length > 0 ? locales : undefined,
        sort_order: index,
      };
    });

    const title = titleState?.giftsTitle ?? giftsTitle;
    const titleLocales =
      titleState?.giftsTitleLocales ?? giftsTitleLocales;
    const localePayload: Record<string, string> = {};
    for (const [code, name] of Object.entries(titleLocales)) {
      const trimmed = name.trim();
      if (trimmed) localePayload[code] = trimmed;
    }
    const body: UpsertProductGiftsBody = {
      gifts: payload,
      gifts_title: title.trim() ? title.trim() : null,
      gifts_title_locales: localePayload,
    };

    setSaving(true);
    try {
      await apiFetch(`/api/products/${productId}/gifts`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      message.success(successText);
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存赠品失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveSectionTitle = async () => {
    await persist(gifts, "赠品总标题已保存");
  };

  /** 行内保存：提交当前编辑并落库 */
  const saveRow = async (row: DraftGift) => {
    const options = row.gift_product
      ? packages[row.gift_product.id] ?? []
      : [];
    if (options.length === 0) {
      message.error("该赠品商品没有可用套餐，无法保存");
      return;
    }
    if (!row.package_id) {
      message.error("请先选择赠品套餐");
      return;
    }
    const next = gifts.map((g) =>
      g.key === row.key ? { ...g, editing: false, origin: null } : g,
    );
    setGifts(next);
    await persist(next, "赠品已保存");
  };

  const selectedOptions = selected ? (selected.packages ?? []) : [];

  const titleCurrentValue = editingLocale
    ? (giftsTitleLocales[editingLocale] ?? "")
    : giftsTitle;
  const titleSavedValue = editingLocale
    ? (savedTitle.giftsTitleLocales[editingLocale] ?? "")
    : savedTitle.giftsTitle;
  const titleDirty = titleCurrentValue.trim() !== titleSavedValue.trim();
  const effectivePreview = editingLocale
    ? (giftsTitleLocales[editingLocale] ?? "").trim() ||
      giftsTitle.trim() ||
      ""
    : giftsTitle.trim();

  return (
    <div>
      <Space
        style={{ marginBottom: 12, color: "#666" }}
        align="start"
        direction="vertical"
      >
        <span>
          为「{currentProduct.name}」添加赠品。赠品本身是另一个商品：
          搜索商品的内部名称或链接后缀自动补全 → 选择后查看详情 →
          必须选择赠品套餐后才能确认添加 → 确认添加后立即保存生效。
          同一个赠品商品可以重复添加
          （套餐或数量不同即可），但「商品 + 套餐 + 数量」组合不能重复。
          「赠品总标题」为店面赠品区块标题（如 Bonus Gratis / Free Gift /
          هدية مجانية），留空则使用各市场默认文案。
          「赠品名称」可自定义单项展示名，留空时默认使用该赠品商品的
          商品标题(外部)；多语言下默认使用该语言版本的商品标题(外部)。
          {editingLocale ? (
            <>
              {" "}
              当前编辑{" "}
              <b>
                {localeLabel} · {editingLocale}（
                {saPathPrefixForLocale(editingLocale, regionName)}）
              </b>{" "}
              的赠品总标题与赠品名称（留空则总标题回退默认语言/市场文案，
              名称回退该语言商品标题(外部)）；套餐/数量等仍在「默认」语言下修改。
            </>
          ) : addedLocales.length > 0 ? (
            <>
              {" "}
              已添加语言：{addedLocales.join(", ")}
              。上方切换语言后，可填写该语言的赠品总标题与赠品名称。
            </>
          ) : null}
          {regionName ? (
            <>
              <br />
              赠品仅可从「{regionName}」地区的商品中选取，其他地区商品不会出现在搜索结果中。
            </>
          ) : null}
          导出 Excel 时「中文属性*数量」为「主品 * (套餐内件数×购买数量) | 赠品A * (套餐内件数×赠品数量) | …」。
        </span>
      </Space>

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={
          <Space size={6} align="center">
            <GiftOutlined />
            <span>赠品总标题</span>
            <Tooltip
              title="此标题会显示在店面赠品区块顶部（Free Gift / Bonus Gratis / هدية مجانية）。留空时使用各市场默认文案；多语言下可单独设置，未设置时回退默认语言。"
              placement="right"
            >
              <QuestionCircleOutlined style={{ color: "#8c8c8c" }} />
            </Tooltip>
          </Space>
        }
        extra={
          <Space>
            {titleDirty ? (
              <span style={{ color: "#faad14", fontSize: 13 }}>
                有未保存改动
              </span>
            ) : null}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void saveSectionTitle()}
              disabled={!titleDirty}
            >
              保存总标题
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Input
            style={{ width: "100%", maxWidth: 420 }}
            maxLength={80}
            allowClear
            value={titleCurrentValue}
            placeholder={
              editingLocale
                ? giftsTitle.trim()
                  ? `留空回退默认语言：${truncateText(giftsTitle, 40)}`
                  : `该语言的赠品区块总标题（${localeLabel}）`
                : "留空则使用各市场默认文案（Free Gift / Bonus Gratis / هدية مجانية）"
            }
            onChange={(e) => updateSectionTitle(e.target.value)}
          />
          {!editingLocale ? (
            effectivePreview ? (
              <span style={{ color: "#666", fontSize: 13 }}>
                当前预览：<strong>{effectivePreview}</strong>
              </span>
            ) : (
              <span style={{ color: "#8c8c8c", fontSize: 13 }}>
                未设置，将使用各市场默认文案
              </span>
            )
          ) : effectivePreview === titleCurrentValue.trim() && titleCurrentValue.trim() ? (
            <span style={{ color: "#666", fontSize: 13 }}>
              当前预览（{localeLabel}）：<strong>{effectivePreview}</strong>
            </span>
          ) : effectivePreview ? (
            <span style={{ color: "#8c8c8c", fontSize: 13 }}>
              {titleCurrentValue.trim()
                ? `该语言未设置，将回退：${truncateText(effectivePreview, 60)}`
                : `未设置，将回退：${truncateText(effectivePreview, 60)}`}
            </span>
          ) : (
            <span style={{ color: "#8c8c8c", fontSize: 13 }}>
              未设置，将使用各市场默认文案
            </span>
          )}
        </Space>
      </Card>

      <Space style={{ marginBottom: 12, width: "100%" }} align="start">
        <AutoComplete
          style={{ width: 460 }}
          popupMatchSelectWidth={false}
          classNames={{ popup: { root: "gift-product-search-popup" } }}
          value={keyword}
          placeholder={
            regionName
              ? `搜索「${regionName}」地区商品的内部名称或链接后缀`
              : "输入赠品商品的内部名称或链接后缀，自动补全后选择"
          }
          options={candidates.map((c) => ({
            value: c.product.id,
            label: (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  whiteSpace: "normal",
                }}
              >
                {c.product.cover_url ? (
                  <ThumbImage src={c.product.cover_url} width={36} height={36} />
                ) : null}
                <div style={{ lineHeight: 1.4, minWidth: 0, wordBreak: "break-word" }}>
                  <div style={{ wordBreak: "break-word" }} title={c.product.name}>
                    {c.product.name}
                  </div>
                  <Space size={[4, 4]} wrap>
                    {c.product.title_external?.trim() ? (
                      <Tag
                        color="purple"
                        style={{
                          maxWidth: 280,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "inline-block",
                          verticalAlign: "middle",
                        }}
                        title={`标题(外部)：${c.product.title_external}`}
                      >
                        标题(外部)：{c.product.title_external}
                      </Tag>
                    ) : null}
                    <Tag color="blue" style={{ whiteSpace: "normal", height: "auto" }}>
                      {c.product.link_suffix}
                    </Tag>
                    <Tag style={{ whiteSpace: "normal", height: "auto" }}>
                      中文属性：{c.product.sku_code || "未填"}
                    </Tag>
                    {c.product.status !== "on_sale" ? (
                      <Tag color="orange">非在售</Tag>
                    ) : null}
                  </Space>
                </div>
              </div>
            ),
          }))}
          filterOption={(input, option) => {
            const c = candidates.find((x) => x.product.id === option?.value);
            if (!c) return false;
            const kw = input.toLowerCase();
            return (
              c.product.name.toLowerCase().includes(kw) ||
              (c.product.link_suffix ?? "").toLowerCase().includes(kw)
            );
          }}
          onSearch={searchGifts}
          onSelect={(value) => {
            const candidate = candidates.find((c) => c.product.id === value);
            if (candidate) pickCandidate(candidate);
          }}
        >
          <Input
            value={keyword}
            placeholder={
              regionName
                ? `搜索「${regionName}」地区商品的内部名称或链接后缀`
                : "输入赠品商品的内部名称或链接后缀，自动补全后选择"
            }
            onChange={(e) => {
              setKeyword(e.target.value);
              void searchGifts(e.target.value);
            }}
            suffix={<SearchOutlined />}
          />
        </AutoComplete>
        {searching ? <span style={{ color: "#999" }}>搜索中…</span> : null}
      </Space>

      {selected ? (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title="赠品详情（确认后添加）"
          extra={
            <Space>
              <Button size="small" onClick={resetSelected}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                loading={saving}
                disabled={!selectedPackageId}
                onClick={() => void confirmAdd()}
              >
                确认添加
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space>
              {selected.product.cover_url ? (
                <ThumbImage
                  src={selected.product.cover_url}
                  width={64}
                  height={64}
                />
              ) : null}
              <div>
                <div>
                  <strong>{selected.product.name}</strong>
                </div>
                <Space size={4} style={{ marginTop: 4 }}>
                  {selected.product.title_external?.trim() ? (
                    <Tag
                      color="purple"
                      style={{
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "inline-block",
                        verticalAlign: "middle",
                      }}
                      title={`标题(外部)：${selected.product.title_external}`}
                    >
                      标题(外部)：{truncateText(selected.product.title_external, 40)}
                    </Tag>
                  ) : null}
                  <Tag color="blue">
                    链接后缀：{selected.product.link_suffix}
                  </Tag>
                  <Tag>中文属性：{selected.product.sku_code || "未填"}</Tag>
                  {selected.product.status !== "on_sale" ? (
                    <Tag color="orange">非在售</Tag>
                  ) : null}
                </Space>
              </div>
            </Space>
            <Space size={12} wrap>
              <Space size={4}>
                <span>赠品套餐：</span>
                {selectedOptions.length === 0 ? (
                  <span style={{ color: "#999" }}>
                    {selected.product.packages_enabled
                      ? "无可用套餐"
                      : "该商品未启用套餐"}
                  </span>
                ) : (
                  <Select
                    style={{ width: 220 }}
                    placeholder="请选择赠品套餐"
                    value={selectedPackageId ?? undefined}
                    options={selectedOptions.map((pkg) => ({
                      value: pkg.id,
                      label: pkg.name,
                    }))}
                    onChange={(value) => setSelectedPackageId(value ?? null)}
                  />
                )}
              </Space>
              <Space size={4}>
                <span>数量：</span>
                <InputNumber
                  min={1}
                  precision={0}
                  value={selectedQuantity}
                  onChange={(v) => setSelectedQuantity(Number(v ?? 1))}
                />
              </Space>
            </Space>
          </Space>
        </Card>
      ) : null}

      <Table<DraftGift>
        rowKey="key"
        loading={loading}
        pagination={false}
        dataSource={gifts}
        locale={{ emptyText: "暂无赠品，在上方搜索商品后选择即可添加" }}
        scroll={{ x: 1050 }}
        columns={[
          {
            title: "操作",
            width: 180,
            fixed: "left",
            render: (_, row) =>
              row.editing ? (
                <Space size={4}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SaveOutlined />}
                    loading={saving}
                    onClick={() => void saveRow(row)}
                  >
                    保存
                  </Button>
                  <Button size="small" onClick={() => cancelEdit(row)}>
                    取消
                  </Button>
                </Space>
              ) : (
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => startEdit(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeRow(row)}
                  >
                    删除
                  </Button>
                </Space>
              ),
          },
          {
            title: "赠品商品",
            dataIndex: "gift_product",
            width: 300,
            render: (_, row) => {
              const product = row.gift_product;
              if (!product) return <span style={{ color: "#999" }}>未选择</span>;
              return (
                <Space>
                  {product.cover_url ? (
                    <ThumbImage src={product.cover_url} width={40} height={40} />
                  ) : null}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 240,
                      }}
                      title={product.name}
                    >
                      {product.name}
                    </div>
                    <Space size={4}>
                      {product.title_external?.trim() ? (
                        <Tag
                          color="purple"
                          style={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "inline-block",
                            verticalAlign: "middle",
                          }}
                          title={`标题(外部)：${product.title_external}`}
                        >
                          标题(外部)：{truncateText(product.title_external, 24)}
                        </Tag>
                      ) : null}
                      <Tag color="blue">{product.link_suffix}</Tag>
                      <Tag>中文属性：{product.sku_code || "未填"}</Tag>
                      {product.status !== "on_sale" ? (
                        <Tag color="orange">非在售</Tag>
                      ) : null}
                    </Space>
                  </div>
                </Space>
              );
            },
          },
          {
            title: editingLocale
              ? `赠品名称（${localeLabel}）`
              : "赠品名称",
            dataIndex: "gift_name",
            width: 240,
            render: (_, row) => {
              if (editingLocale) {
                const localeName = row.locales[editingLocale] ?? "";
                const localeDefault = giftLocaleDefaultName(
                  row.gift_product,
                  editingLocale,
                );
                if (row.editing) {
                  return (
                    <Input
                      style={{ width: "100%" }}
                      maxLength={200}
                      allowClear
                      value={localeName}
                      placeholder={
                        localeDefault
                          ? truncateText(localeDefault, 24)
                          : `该语言赠品名（${localeLabel}）`
                      }
                      onChange={(e) =>
                        updateLocaleName(
                          row.key,
                          editingLocale,
                          e.target.value,
                        )
                      }
                    />
                  );
                }
                if (!localeName.trim()) {
                  if (!localeDefault) {
                    return (
                      <span style={{ color: "#999" }}>
                        未设置（无商品标题(外部)可回退）
                      </span>
                    );
                  }
                  return (
                    <div style={{ minWidth: 0, maxWidth: 220 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={localeDefault}
                      >
                        {localeDefault}
                      </div>
                      <span style={{ color: "#999", fontSize: 12 }}>
                        默认使用该语言商品标题(外部)
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}
                    title={localeName}
                  >
                    {localeName}
                  </div>
                );
              }

              if (row.editing) {
                return (
                  <Input
                    style={{ width: "100%" }}
                    maxLength={200}
                    allowClear
                    value={row.gift_name}
                    placeholder={
                      row.gift_product?.title_external?.trim()
                        ? truncateText(row.gift_product.title_external, 24)
                        : "留空则使用商品标题(外部)"
                    }
                    onChange={(e) =>
                      updateGift(row.key, { gift_name: e.target.value })
                    }
                  />
                );
              }
              const display = giftDisplayName(row.gift_name, row.gift_product);
              if (!display) return <span style={{ color: "#999" }}>未设置</span>;
              const isDefault = !(row.gift_name ?? "").trim();
              return (
                <div style={{ minWidth: 0, maxWidth: 220 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={display}
                  >
                    {display}
                  </div>
                  {isDefault ? (
                    <span style={{ color: "#999", fontSize: 12 }}>
                      默认使用商品标题(外部)
                    </span>
                  ) : null}
                </div>
              );
            },
          },
          {
            title: "赠品套餐",
            dataIndex: "package_id",
            width: 220,
            render: (_, row) => {
              const product = row.gift_product;
              if (!product) return "-";
              const options = packages[product.id] ?? [];
              const chosen = options.find((p) => p.id === row.package_id);
              const displayName =
                chosen?.name ??
                (row.package_id ? row.package_name : null);

              if (!row.editing || editingLocale) {
                if (displayName) return displayName;
                if (row.package_id) {
                  return (
                    <span style={{ color: "#999" }}>套餐已选（名称加载中）</span>
                  );
                }
                if (options.length === 0) {
                  return (
                    <span style={{ color: "#999" }}>
                      {product.packages_enabled ? "无可用套餐" : "未启用套餐"}
                    </span>
                  );
                }
                return "未选择套餐";
              }

              if (options.length === 0) {
                return (
                  <span style={{ color: "#999" }}>
                    {product.packages_enabled ? "无可用套餐" : "未启用套餐"}
                  </span>
                );
              }
              return (
                <Select
                  style={{ width: "100%" }}
                  placeholder="请选择赠品套餐"
                  value={row.package_id ?? undefined}
                  options={options.map((pkg) => ({
                    value: pkg.id,
                    label: pkg.name,
                  }))}
                  onChange={(value) => {
                    const name =
                      options.find((p) => p.id === value)?.name ?? null;
                    updateGift(row.key, {
                      package_id: value ?? null,
                      package_name: name,
                    });
                  }}
                />
              );
            },
          },
          {
            title: "数量",
            dataIndex: "quantity",
            width: 110,
            render: (_, row) =>
              row.editing && !editingLocale ? (
                <InputNumber
                  min={1}
                  precision={0}
                  style={{ width: "100%" }}
                  value={row.quantity}
                  onChange={(v) =>
                    updateGift(row.key, { quantity: Number(v ?? 1) })
                  }
                />
              ) : (
                <span>{row.quantity}</span>
              ),
          },
        ]}
      />

      <span style={{ color: "#999" }}>
        共 {gifts.length} 个赠品，确认添加后立即生效
      </span>
    </div>
  );
}
