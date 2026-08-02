import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
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
  AddressRegionPath,
  ImportAddressLibraryResult,
  Paginated,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { parseAddressRegionExcel } from "../lib/parseAddressRegionExcel";

type LibraryListRes = { data: AddressLibrary[]; total: number };

type RegionsRes = Paginated<AddressRegionPath> & {
  max_level: number;
};

type CreateForm = {
  name: string;
  dial_code: string;
  remark?: string;
};

const CN_LEVEL = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const levelLabel = (n: number) =>
  `${CN_LEVEL[n - 1] ?? String(n)}级区域`;

export function AddressRegionsPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [data, setData] = useState<AddressLibrary[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<LibraryListRes>("/api/address-libraries");
      setData(res.data);
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
  }, [detail, detailPage, detailPageSize, detailQ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDetailRows();
  }, [loadDetailRows]);

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
  };

  const handleImportForRow = async (row: AddressLibrary, file: File) => {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseAddressRegionExcel(buffer);

      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "确认导入",
          content: (
            <div>
              <p>
                地区：<strong>{row.name}</strong>
              </p>
              <p>
                共 {parsed.paths.length} 条，{parsed.maxLevel} 级区域
                （支持二级 / 三级 / 四级…）
              </p>
              <p style={{ color: "#666" }}>导入将覆盖该地区现有区域数据。</p>
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
        `/api/address-libraries/${row.id}/import`,
        {
          method: "POST",
          body: JSON.stringify({ paths: parsed.paths }),
        },
      );
      message.success(
        `已导入 ${res.imported_paths} 条（${res.max_level} 级）`,
      );
      await load();
      if (detail?.id === row.id) {
        setDetailPage(1);
        setDetail(res.library);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

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
      width: 320,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetail(row)}>
            查看
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleImportForRow(row, file);
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />} loading={importing}>
              导入
            </Button>
          </Upload>
          <Popconfirm
            title={`确认删除地区「${row.name}」？`}
            description="将同时删除其全部区域数据"
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
        <h1>地区管理</h1>
        <Button type="primary" onClick={openCreate}>
          新增地区
        </Button>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 16 }}>
        新增地区后可导入 Excel（表头为「一级区域 / 二级区域 / …」）。支持二级、三级、四级及更多级。
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
            label="导入文件（可选）"
            extra="xlsx/xls，列可为二级 / 三级 / 四级区域…"
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
            <Input maxLength={5} placeholder="如：62" addonBefore="+" allowClear />
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

      <Drawer
        title={detail ? `地区明细 · ${detail.name}` : "地区明细"}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={Math.min(960, typeof window !== "undefined" ? window.innerWidth - 48 : 960)}
        destroyOnClose
      >
        {detail ? (
          <>
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
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                beforeUpload={(file) => {
                  void handleImportForRow(detail, file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={importing}>
                  重新导入
                </Button>
              </Upload>
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
              locale={{ emptyText: "暂无区域数据，请导入 Excel" }}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
