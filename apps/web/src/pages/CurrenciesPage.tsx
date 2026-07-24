import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Currency, UpsertCurrencyInput } from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";

type CurrencyListRes = { data: Currency[]; total: number };

const emptyForm: UpsertCurrencyInput = {
  code: "",
  name: "",
  name_zh: "",
  symbol: "",
  numeric_code: null,
  symbol_suffix: false,
  is_default: false,
  enabled: true,
  sort_order: 0,
};

export function CurrenciesPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Currency[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Currency | null>(null);
  const [form] = Form.useForm<UpsertCurrencyInput>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<CurrencyListRes>("/api/currencies");
      setData(res.data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      ...emptyForm,
      sort_order: (data[data.length - 1]?.sort_order ?? 0) + 10,
    });
    setOpen(true);
  };

  const openEdit = (row: Currency) => {
    setEditing(row);
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      name_zh: row.name_zh,
      symbol: row.symbol,
      numeric_code: row.numeric_code,
      symbol_suffix: row.symbol_suffix,
      is_default: row.is_default,
      enabled: row.enabled,
      sort_order: row.sort_order,
    });
    setOpen(true);
  };

  const columns: ColumnsType<Currency> = [
    {
      title: "代码",
      dataIndex: "code",
      width: 90,
      render: (v: string, row) => (
        <Space>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{v}</span>
          {row.is_default ? <Tag color="blue">默认</Tag> : null}
          {!row.enabled ? <Tag>停用</Tag> : null}
        </Space>
      ),
    },
    {
      title: "符号",
      dataIndex: "symbol",
      width: 80,
      render: (v: string) => (
        <span style={{ fontSize: 16, fontWeight: 600 }}>{v}</span>
      ),
    },
    { title: "中文名称", dataIndex: "name_zh", width: 160 },
    { title: "英文名称", dataIndex: "name" },
    {
      title: "数字代码",
      dataIndex: "numeric_code",
      width: 90,
      render: (v: number | null) => v ?? "—",
    },
    {
      title: "符号位置",
      dataIndex: "symbol_suffix",
      width: 90,
      render: (v: boolean) => (v ? "后缀" : "前缀"),
    },
    {
      title: "排序",
      dataIndex: "sort_order",
      width: 70,
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该币种？"
            disabled={row.is_default}
            onConfirm={async () => {
              try {
                await apiFetch(`/api/currencies/${row.id}`, {
                  method: "DELETE",
                });
                message.success("已删除");
                await load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : "删除失败");
              }
            }}
          >
            <Button size="small" danger disabled={row.is_default}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>币种管理</h1>
        <Button type="primary" onClick={openCreate}>
          新增币种
        </Button>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 12 }}>
        常用币种已按 ISO 4217 预置（数据来源 data.gov.my）。商品需选择币种用于价格展示。
      </p>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: "max-content" }}
        pagination={false}
      />

      <Modal
        title={editing ? "编辑币种" : "新增币种"}
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        width={560}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            setSaving(true);
            const payload: UpsertCurrencyInput = {
              code: values.code,
              name: values.name,
              name_zh: values.name_zh,
              symbol: values.symbol,
              numeric_code:
                values.numeric_code === undefined ||
                values.numeric_code === null
                  ? null
                  : Number(values.numeric_code),
              symbol_suffix: Boolean(values.symbol_suffix),
              is_default: Boolean(values.is_default),
              enabled: values.enabled !== false,
              sort_order: Number(values.sort_order ?? 0),
            };
            if (editing) {
              await apiFetch(`/api/currencies/${editing.id}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
              });
              message.success("已保存");
            } else {
              await apiFetch("/api/currencies", {
                method: "POST",
                body: JSON.stringify(payload),
              });
              message.success("已创建");
            }
            setOpen(false);
            await load();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "保存失败");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical" initialValues={emptyForm}>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item
              name="code"
              label="币种代码"
              rules={[{ required: true, message: "请填写 ISO 代码" }]}
              style={{ width: 120 }}
              extra="如 USD"
            >
              <Input
                maxLength={3}
                disabled={Boolean(editing)}
                style={{ textTransform: "uppercase" }}
              />
            </Form.Item>
            <Form.Item
              name="symbol"
              label="符号"
              rules={[{ required: true, message: "请填写符号" }]}
              style={{ width: 120 }}
            >
              <Input maxLength={16} placeholder="如 $" />
            </Form.Item>
            <Form.Item
              name="numeric_code"
              label="数字代码"
              style={{ width: 140 }}
            >
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="name_zh"
            label="中文名称"
            rules={[{ required: true, message: "请填写中文名称" }]}
          >
            <Input maxLength={INPUT_LIMITS.name} placeholder="如 美元" />
          </Form.Item>
          <Form.Item
            name="name"
            label="英文名称"
            rules={[{ required: true, message: "请填写英文名称" }]}
          >
            <Input
              maxLength={INPUT_LIMITS.mediumText}
              placeholder="如 US Dollar"
            />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item name="sort_order" label="排序" style={{ width: 140 }}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="symbol_suffix"
              label="符号在金额后"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="is_default"
              label="设为默认"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
