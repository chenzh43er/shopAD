import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type {
  AddressLibrary,
  AddressLibraryLocale,
  AddressRegionPath,
  ImportAddressLibraryResult,
  Paginated,
} from "@shopad/shared";
import {
  isValidOverlayLocaleCode,
  localeDisplayLabel,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { parseAddressRegionExcel } from "../lib/parseAddressRegionExcel";
import { ProductLocaleToolbar } from "../components/ProductLocaleEditor";

type LibraryListRes = { data: AddressLibrary[]; total: number };

type RegionsRes = Paginated<AddressRegionPath> & {
  max_level: number;
  locale?: string;
};

type CreateForm = {
  name: string;
  dial_code: string;
  remark?: string;
};

type ImportTargetMode = "default" | "locale";

type ImportModalState = {
  library: AddressLibrary;
  /** 打开时预选：默认或某语言码 */
  presetTarget?: "default" | string;
};

const CN_LEVEL = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const levelLabel = (n: number) =>
  `${CN_LEVEL[n - 1] ?? String(n)}级区域`;

export function AddressRegionsPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [data, setData] = useState<AddressLibrary[]>([]);
  const [total, setTotal] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AddressLibrary | null>(null);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [form] = Form.useForm<CreateForm>();
  const [editForm] = Form.useForm<CreateForm>();

  const [detail, setDetail] = useState<AddressLibrary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailQ, setDetailQ] = useState("");
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(50);
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailMaxLevel, setDetailMaxLevel] = useState(2);
  const [detailRows, setDetailRows] = useState<AddressRegionPath[]>([]);

  const [contentLocale, setContentLocale] = useState<"default" | string>(
    "default",
  );
  const [addedLocales, setAddedLocales] = useState<string[]>([]);
  const [localeLabels, setLocaleLabels] = useState<Record<string, string>>({});

  const [importModal, setImportModal] = useState<ImportModalState | null>(null);
  const [importMode, setImportMode] = useState<ImportTargetMode>("default");
  const [importLocaleCode, setImportLocaleCode] = useState<string>("");
  const [importNewLocaleName, setImportNewLocaleName] = useState("");
  const [importNewLocaleCode, setImportNewLocaleCode] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<LibraryListRes>("/api/address-libraries");
      setData(res.data);
      setTotal(res.total);
      setDetail((prev) => {
        if (!prev) return null;
        return res.data.find((item) => item.id === prev.id) ?? null;
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const syncLocalesFromLibrary = useCallback((lib: AddressLibrary | null) => {
    const rows = lib?.locales ?? [];
    const codes = rows.map((r) => r.locale);
    setAddedLocales(codes);
    const labels: Record<string, string> = {};
    for (const row of rows) {
      if (row.label?.trim()) labels[row.locale] = row.label.trim();
    }
    setLocaleLabels(labels);
  }, []);

  const loadDetailRows = useCallback(async () => {
    if (!detail) {
      setDetailRows([]);
      setDetailTotal(0);
      return;
    }
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(detailPage),
        pageSize: String(detailPageSize),
      });
      if (detailQ.trim()) params.set("q", detailQ.trim());
      if (contentLocale !== "default") {
        params.set("locale", contentLocale);
      }
      const res = await apiFetch<RegionsRes>(
        `/api/address-libraries/${detail.id}/regions?${params.toString()}`,
      );
      setDetailRows(res.data);
      setDetailTotal(res.total);
      setDetailMaxLevel(Math.max(2, res.max_level || 2));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载明细失败");
    } finally {
      setDetailLoading(false);
    }
  }, [detail, detailPage, detailPageSize, detailQ, contentLocale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDetailRows();
  }, [loadDetailRows]);

  useEffect(() => {
    if (!detail) {
      setContentLocale("default");
      setAddedLocales([]);
      setLocaleLabels({});
      return;
    }
    syncLocalesFromLibrary(detail);
  }, [detail?.id, syncLocalesFromLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  const importPathsToLibrary = async (
    libraryId: string,
    file: File,
  ): Promise<ImportAddressLibraryResult> => {
    const buffer = await file.arrayBuffer();
    const parsed = parseAddressRegionExcel(buffer);
    return apiFetch<ImportAddressLibraryResult>(
      `/api/address-libraries/${libraryId}/import`,
      {
        method: "POST",
        body: JSON.stringify({ paths: parsed.paths }),
      },
    );
  };

  const openCreate = () => {
    form.resetFields();
    setCreateFile(null);
    setCreateOpen(true);
  };

  const openEdit = (row: AddressLibrary) => {
    setEditing(row);
    editForm.setFieldsValue({
      name: row.name,
      dial_code: row.dial_code ?? "",
      remark: row.remark ?? "",
    });
  };

  const openDetail = (row: AddressLibrary) => {
    setDetail(row);
    setDetailQ("");
    setDetailPage(1);
    setContentLocale("default");
    syncLocalesFromLibrary(row);
  };

  const openImportModal = (
    library: AddressLibrary,
    presetTarget?: "default" | string,
  ) => {
    const locales = library.locales ?? [];
    const preset = presetTarget ?? "default";
    setImportModal({ library, presetTarget: preset });
    if (preset === "default") {
      setImportMode("default");
      setImportLocaleCode(locales[0]?.locale ?? "");
    } else {
      setImportMode("locale");
      setImportLocaleCode(preset);
    }
    setImportNewLocaleName("");
    setImportNewLocaleCode("");
    setImportFile(null);
  };

  const closeImportModal = () => {
    if (importing) return;
    setImportModal(null);
    setImportFile(null);
  };

  const handleAddLocale = async (code: string, label: string) => {
    if (!detail) throw new Error("请先打开地区明细");
    const saved = await apiFetch<AddressLibraryLocale>(
      `/api/address-libraries/${detail.id}/locales/${encodeURIComponent(code)}`,
      {
        method: "PUT",
        body: JSON.stringify({ locale: code, label, names: {} }),
      },
    );
    setAddedLocales((prev) => (prev.includes(code) ? prev : [...prev, code]));
    setLocaleLabels((prev) => ({ ...prev, [code]: label }));
    setDetail((prev) => {
      if (!prev) return prev;
      const others = (prev.locales ?? []).filter((l) => l.locale !== code);
      return {
        ...prev,
        locales: [
          ...others,
          { locale: saved.locale, label: saved.label ?? label },
        ],
      };
    });
    await load();
  };

  const handleRemoveLocale = async (code: string) => {
    if (!detail) throw new Error("请先打开地区明细");
    await apiFetch(
      `/api/address-libraries/${detail.id}/locales/${encodeURIComponent(code)}`,
      { method: "DELETE" },
    );
    setAddedLocales((prev) => prev.filter((c) => c !== code));
    setLocaleLabels((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    if (contentLocale === code) setContentLocale("default");
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            locales: (prev.locales ?? []).filter((l) => l.locale !== code),
          }
        : prev,
    );
    await load();
  };

  const ensureLocaleExists = async (
    libraryId: string,
    code: string,
    label: string,
  ) => {
    await apiFetch<AddressLibraryLocale>(
      `/api/address-libraries/${libraryId}/locales/${encodeURIComponent(code)}`,
      {
        method: "PUT",
        body: JSON.stringify({ locale: code, label, names: {} }),
      },
    );
  };

  const submitImportModal = async () => {
    if (!importModal) return;
    const { library } = importModal;
    if (!importFile) {
      message.error("请选择 Excel 文件");
      return;
    }

    let targetLocale: "default" | string = "default";
    let targetLabel: string | null = null;

    if (importMode === "locale") {
      const existingCodes = (library.locales ?? []).map((l) => l.locale);
      if (importLocaleCode === "__new__") {
        const name = importNewLocaleName.trim();
        const code = importNewLocaleCode.trim().toLowerCase();
        if (!name) {
          message.error("请填写语言名称");
          return;
        }
        if (!isValidOverlayLocaleCode(code)) {
          message.error(
            "字段须为 2 位小写字母，如 en、fr（不可用 id / ar / default）",
          );
          return;
        }
        if (existingCodes.includes(code)) {
          message.error(`语言字段「${code}」已存在，请直接选择`);
          return;
        }
        targetLocale = code;
        targetLabel = name;
      } else {
        const code = importLocaleCode.trim().toLowerCase();
        if (!code) {
          message.error("请选择要导入的语言");
          return;
        }
        targetLocale = code;
        targetLabel =
          library.locales?.find((l) => l.locale === code)?.label?.trim() ||
          null;
      }
    }

    setImporting(true);
    try {
      const buffer = await importFile.arrayBuffer();
      const parsed = parseAddressRegionExcel(buffer);

      if (targetLocale === "default") {
        const confirmed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: "确认导入默认语言",
            content: (
              <div>
                <p>
                  地区：<strong>{library.name}</strong>
                </p>
                <p>
                  目标：<strong>默认语言（主表）</strong>
                </p>
                <p>
                  共 {parsed.paths.length} 条，{parsed.maxLevel} 级区域
                </p>
                <p style={{ color: "#666" }}>
                  将覆盖现有默认区域数据，并清空各语言译文（语言条目保留，需重新导入译文）。
                </p>
              </div>
            ),
            okText: "开始导入",
            cancelText: "取消",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!confirmed) return;

        const res = await apiFetch<ImportAddressLibraryResult>(
          `/api/address-libraries/${library.id}/import`,
          {
            method: "POST",
            body: JSON.stringify({ paths: parsed.paths }),
          },
        );
        message.success(
          `已导入默认语言 ${res.imported_paths} 条（${res.max_level} 级）`,
        );
        setImportModal(null);
        setImportFile(null);
        await load();
        if (detail?.id === library.id) {
          setDetailPage(1);
          setDetail(res.library);
          setContentLocale("default");
          syncLocalesFromLibrary(res.library);
        }
        return;
      }

      if (importLocaleCode === "__new__" && targetLabel) {
        await ensureLocaleExists(library.id, targetLocale, targetLabel);
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "确认导入语言译文",
          content: (
            <div>
              <p>
                地区：<strong>{library.name}</strong>
              </p>
              <p>
                目标：
                <strong>
                  {localeDisplayLabel(targetLocale, targetLabel)} ·{" "}
                  {targetLocale}
                </strong>
              </p>
              <p>
                共 {parsed.paths.length}{" "}
                条译文路径（须与默认叶路径行数、级数一致，按叶子顺序一一对应）
              </p>
            </div>
          ),
          okText: "开始导入",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;

      const res = await apiFetch<{
        imported_paths: number;
        name_keys: number;
      }>(
        `/api/address-libraries/${library.id}/locales/${encodeURIComponent(targetLocale)}/import`,
        {
          method: "POST",
          body: JSON.stringify({
            paths: parsed.paths,
            label: targetLabel,
          }),
        },
      );
      message.success(
        `已导入 ${localeDisplayLabel(targetLocale, targetLabel)} 译文 ${res.imported_paths} 条（${res.name_keys} 个节点名）`,
      );
      setImportModal(null);
      setImportFile(null);
      await load();
      if (detail?.id === library.id) {
        setContentLocale(targetLocale);
        setDetailPage(1);
        setAddedLocales((prev) =>
          prev.includes(targetLocale) ? prev : [...prev, targetLocale],
        );
        if (targetLabel) {
          setLocaleLabels((prev) => ({
            ...prev,
            [targetLocale]: targetLabel!,
          }));
        }
        setDetail((prev) => {
          if (!prev) return prev;
          const others = (prev.locales ?? []).filter(
            (l) => l.locale !== targetLocale,
          );
          return {
            ...prev,
            locales: [
              ...others,
              { locale: targetLocale, label: targetLabel },
            ],
          };
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const importModalLocales = importModal?.library.locales ?? [];
  const importLocaleSelectOptions = useMemo(() => {
    const opts = importModalLocales.map((l) => ({
      value: l.locale,
      label: `${localeDisplayLabel(l.locale, l.label)} · ${l.locale}`,
    }));
    opts.push({ value: "__new__", label: "＋ 新建语言并导入…" });
    return opts;
  }, [importModalLocales]);

  const columns: ColumnsType<AddressLibrary> = [
    {
      title: "地区名称",
      dataIndex: "name",
      width: 160,
    },
    {
      title: "区号",
      dataIndex: "dial_code",
      width: 88,
      render: (v: string | null) => (v ? `+${v}` : "—"),
    },
    {
      title: "备注",
      dataIndex: "remark",
      render: (v: string | null) => v || "—",
    },
    {
      title: "语言",
      key: "locales",
      width: 140,
      render: (_, row) => {
        const codes = (row.locales ?? []).map((l) => l.locale);
        if (codes.length === 0) return "默认";
        return `默认 + ${codes.join(", ")}`;
      },
    },
    {
      title: "级数",
      dataIndex: "max_level",
      width: 88,
      render: (v: number) => (v > 0 ? `${v} 级` : "—"),
    },
    {
      title: "区域条数",
      dataIndex: "region_count",
      width: 100,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 180,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      key: "actions",
      width: 300,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetail(row)}>
            查看
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            size="small"
            icon={<UploadOutlined />}
            loading={importing && importModal?.library.id === row.id}
            onClick={() => openImportModal(row, "default")}
          >
            导入
          </Button>
          <Popconfirm
            title={`确认删除地区「${row.name}」？`}
            description="将同时删除其全部区域数据与语言覆盖"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                await apiFetch(`/api/address-libraries/${row.id}`, {
                  method: "DELETE",
                });
                message.success("已删除");
                if (detail?.id === row.id) setDetail(null);
                await load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : "删除失败");
              }
            }}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const detailColumns: ColumnsType<AddressRegionPath> = useMemo(
    () =>
      Array.from({ length: detailMaxLevel }, (_, i) => ({
        title: levelLabel(i + 1),
        key: `level_${i + 1}`,
        width: 180,
        render: (_: unknown, row: AddressRegionPath) => row.path[i] ?? "—",
      })),
    [detailMaxLevel],
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-title">
          <h1>地区管理</h1>
          <span className="list-count">共 {total} 条</span>
        </div>
        <Button type="primary" onClick={openCreate}>
          新增地区
        </Button>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 16 }}>
        导入时可选择写入「默认语言」或「其他多语言」。Excel 表头为「一级区域 /
        二级区域 / …」。覆盖语言译文须与默认叶路径行数、级数一致。
      </p>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: "max-content" }}
        pagination={false}
        locale={{ emptyText: "暂无地区，请点击「新增地区」" }}
      />

      <Modal
        title="新增地区"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        okText="确定"
        onOk={async () => {
          try {
            const values = await form.validateFields();
            const name = values.name.trim();
            const dial_code = values.dial_code.trim().replace(/^\+/, "");
            const remark = values.remark?.trim() || null;
            setSaving(true);

            const payload = { name, dial_code, remark };

            if (createFile) {
              const created = await apiFetch<AddressLibrary>(
                "/api/address-libraries",
                {
                  method: "POST",
                  body: JSON.stringify(payload),
                },
              );
              try {
                const res = await importPathsToLibrary(created.id, createFile);
                message.success(
                  `已创建并导入 ${res.imported_paths} 条（${res.max_level} 级）`,
                );
              } catch (importErr) {
                message.warning(
                  `地区已创建，但导入失败：${
                    importErr instanceof Error
                      ? importErr.message
                      : "请稍后在列表中重新导入"
                  }`,
                );
              }
            } else {
              await apiFetch("/api/address-libraries", {
                method: "POST",
                body: JSON.stringify(payload),
              });
              message.success("已创建");
            }

            setCreateOpen(false);
            await load();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "创建失败");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="name"
            label="地区名称"
            rules={[
              { required: true, message: "请输入地区名称" },
              { whitespace: true, message: "请输入地区名称" },
            ]}
          >
            <Input
              maxLength={INPUT_LIMITS.name}
              placeholder="如：极兔、印尼"
              allowClear
            />
          </Form.Item>
          <Form.Item
            name="dial_code"
            label="区号"
            rules={[
              { required: true, message: "请输入区号" },
              {
                pattern: /^[+]?[1-9][0-9]{0,3}$/,
                message: "区号须为 1–4 位数字，不以 0 开头（如 62）",
              },
            ]}
            extra="国际电话区号，不含国家名；印尼填 62"
          >
            <Input
              maxLength={5}
              placeholder="如：62"
              addonBefore="+"
              allowClear
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea
              rows={3}
              maxLength={INPUT_LIMITS.remark}
              showCount
              placeholder="可选"
              allowClear
            />
          </Form.Item>
          <Form.Item
            label="导入默认语言文件（可选）"
            extra="xlsx/xls；新建时仅写入默认主表。其他语言请创建后用「导入」选择目标语言"
          >
            <Upload
              accept=".xlsx,.xls"
              maxCount={1}
              fileList={
                createFile
                  ? [
                      {
                        uid: "create-file",
                        name: createFile.name,
                        status: "done",
                      },
                    ]
                  : []
              }
              beforeUpload={(file) => {
                setCreateFile(file);
                return false;
              }}
              onRemove={() => {
                setCreateFile(null);
              }}
            >
              <Button icon={<UploadOutlined />}>选择 Excel</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑地区"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        destroyOnClose
        okText="保存"
        onOk={async () => {
          if (!editing) return;
          try {
            const values = await editForm.validateFields();
            setSaving(true);
            await apiFetch(`/api/address-libraries/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                name: values.name.trim(),
                dial_code: values.dial_code.trim().replace(/^\+/, ""),
                remark: values.remark?.trim() || null,
              }),
            });
            message.success("已保存");
            setEditing(null);
            await load();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "保存失败");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="name"
            label="地区名称"
            rules={[
              { required: true, message: "请输入地区名称" },
              { whitespace: true, message: "请输入地区名称" },
            ]}
          >
            <Input maxLength={INPUT_LIMITS.name} allowClear />
          </Form.Item>
          <Form.Item
            name="dial_code"
            label="区号"
            rules={[
              { required: true, message: "请输入区号" },
              {
                pattern: /^[+]?[1-9][0-9]{0,3}$/,
                message: "区号须为 1–4 位数字，不以 0 开头（如 62）",
              },
            ]}
            extra="国际电话区号；印尼填 62"
          >
            <Input
              maxLength={5}
              placeholder="如：62"
              addonBefore="+"
              allowClear
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea
              rows={3}
              maxLength={INPUT_LIMITS.remark}
              showCount
              placeholder="可选"
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          importModal
            ? `导入区域 · ${importModal.library.name}`
            : "导入区域"
        }
        open={Boolean(importModal)}
        onCancel={closeImportModal}
        confirmLoading={importing}
        destroyOnClose
        okText="解析并导入"
        onOk={() => void submitImportModal()}
      >
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="导入目标"
            required
            extra={
              importMode === "default"
                ? "写入主表默认语言；会覆盖现有默认区域并清空各语言译文内容"
                : "写入覆盖语言译文；须与默认叶路径行数、级数一致（按顺序对应）"
            }
          >
            <Radio.Group
              value={importMode}
              onChange={(e) => {
                const mode = e.target.value as ImportTargetMode;
                setImportMode(mode);
                if (
                  mode === "locale" &&
                  !importLocaleCode &&
                  importModalLocales[0]
                ) {
                  setImportLocaleCode(importModalLocales[0].locale);
                }
              }}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="default">默认语言</Radio.Button>
              <Radio.Button value="locale">其他多语言</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {importMode === "locale" ? (
            <>
              <Form.Item
                label="语言"
                required
                extra="选择已有语言，或「新建语言并导入」"
              >
                <Select
                  value={importLocaleCode || undefined}
                  placeholder="请选择语言"
                  options={importLocaleSelectOptions}
                  onChange={(value) => setImportLocaleCode(value)}
                />
              </Form.Item>
              {importLocaleCode === "__new__" ? (
                <>
                  <Form.Item
                    label="语言名称"
                    required
                    extra="展示名称，如：英语、法语"
                  >
                    <Input
                      value={importNewLocaleName}
                      onChange={(e) => setImportNewLocaleName(e.target.value)}
                      placeholder="英语"
                      maxLength={32}
                    />
                  </Form.Item>
                  <Form.Item
                    label="语言字段"
                    required
                    extra="路径用代码，2 位小写字母，如 en、fr"
                  >
                    <Input
                      value={importNewLocaleCode}
                      onChange={(e) => setImportNewLocaleCode(e.target.value)}
                      placeholder="en"
                      maxLength={5}
                    />
                  </Form.Item>
                </>
              ) : null}
            </>
          ) : null}

          <Form.Item
            label="Excel 文件"
            required
            extra="表头「一级区域 / 二级区域 / …」或 PROVINSI / KABUPATEN / …"
          >
            <Upload
              accept=".xlsx,.xls"
              maxCount={1}
              fileList={
                importFile
                  ? [
                      {
                        uid: "import-file",
                        name: importFile.name,
                        status: "done",
                      },
                    ]
                  : []
              }
              beforeUpload={(file) => {
                setImportFile(file);
                return false;
              }}
              onRemove={() => setImportFile(null)}
            >
              <Button icon={<UploadOutlined />}>选择 Excel</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `地区明细 · ${detail.name}` : "地区明细"}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={Math.min(
          960,
          typeof window !== "undefined" ? window.innerWidth - 48 : 960,
        )}
        destroyOnClose
      >
        {detail ? (
          <>
            <ProductLocaleToolbar
              contentLocale={contentLocale}
              addedLocales={addedLocales}
              regionName={detail.name}
              localeLabels={localeLabels}
              onChangeLocale={(locale) => {
                setContentLocale(locale);
                setDetailPage(1);
              }}
              onAddLocale={handleAddLocale}
              onRemoveLocale={handleRemoveLocale}
              removeConfirmContent="将删除该语言下的地区名称译文。"
              showPathHint
              overlayHint=" · 当前为覆盖语言：列表显示译文；用「导入」可选择写入默认或本语言"
            />
            <Space wrap style={{ marginBottom: 16 }} size="middle">
              <span>
                {detail.dial_code ? `+${detail.dial_code} · ` : ""}
                {detail.max_level > 0 ? `${detail.max_level} 级` : "未导入"}
                {" · "}
                {detail.region_count} 个节点
                {detail.remark ? ` · ${detail.remark}` : ""}
              </span>
              <Input.Search
                style={{ width: 240 }}
                placeholder="搜索区域名称"
                allowClear
                maxLength={INPUT_LIMITS.search}
                onSearch={(value) => {
                  setDetailQ(value);
                  setDetailPage(1);
                }}
              />
              <Button
                icon={<UploadOutlined />}
                loading={importing}
                onClick={() =>
                  openImportModal(
                    detail,
                    contentLocale === "default" ? "default" : contentLocale,
                  )
                }
              >
                导入
              </Button>
            </Space>
            <Table
              rowKey="id"
              loading={detailLoading}
              columns={detailColumns}
              dataSource={detailRows}
              scroll={{ x: "max-content" }}
              pagination={{
                current: detailPage,
                pageSize: detailPageSize,
                total: detailTotal,
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100, 200],
                showTotal: (n) => `共 ${n} 条`,
                onChange: (p, ps) => {
                  setDetailPage(p);
                  setDetailPageSize(ps);
                },
              }}
              locale={{
                emptyText:
                  contentLocale === "default"
                    ? "暂无区域数据，请导入 Excel"
                    : "暂无译文或尚未导入本语言；请先保证默认数据存在后再导入译文",
              }}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
