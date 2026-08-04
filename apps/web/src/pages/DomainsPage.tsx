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
import type { Domain, UpsertDomainInput } from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";

type DomainListRes = { data: Domain[]; total: number };

const emptyForm: UpsertDomainInput = {
  host: "",
  name: "",
  remark: null,
  enabled: true,
  sort_order: 0,
};

export function DomainsPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Domain[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [form] = Form.useForm<UpsertDomainInput>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DomainListRes>("/api/domains");
      setData(res.data);
      setTotal(res.total);
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

  const openEdit = (row: Domain) => {
    setEditing(row);
    form.setFieldsValue({
      host: row.host,
      name: row.name,
      remark: row.remark,
      enabled: row.enabled,
      sort_order: row.sort_order,
    });
    setOpen(true);
  };

  const columns: ColumnsType<Domain> = [
    {
      title: "域名",
      dataIndex: "host",
      width: 260,
      render: (v: string, row) => (
        <Space>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{v}</span>
          {!row.enabled ? <Tag>停用</Tag> : null}
        </Space>
      ),
    },
    {
      title: "显示名称",
      dataIndex: "name",
      width: 160,
      render: (v: string) => v || "—",
    },
    {
      title: "备注",
      dataIndex: "remark",
      render: (v: string | null) => v || "—",
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
            title="确认删除该域名？"
            onConfirm={async () => {
              try {
                await apiFetch(`/api/domains/${row.id}`, {
                  method: "DELETE",
                });
                message.success("已删除");
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

  return (
    <div>
      <div className="page-header">
        <div className="page-header-title">
          <h1>域名管理</h1>
          <span className="list-count">共 {total} 条</span>
        </div>
        <Button type="primary" onClick={openCreate}>
          新增域名
        </Button>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 12 }}>
        管理落地页可用域名。商品上架前须选择域名。
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
        title={editing ? "编辑域名" : "新增域名"}
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        width={520}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            setSaving(true);
            const payload: UpsertDomainInput = {
              host: values.host,
              name: values.name ?? "",
              remark:
                values.remark === undefined || values.remark === null
                  ? null
                  : String(values.remark),
              enabled: values.enabled !== false,
              sort_order: Number(values.sort_order ?? 0),
            };
            if (editing) {
              await apiFetch(`/api/domains/${editing.id}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
              });
              message.success("已保存");
            } else {
              await apiFetch("/api/domains", {
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
          <Form.Item
            name="host"
            label="域名"
            rules={[{ required: true, message: "请填写域名" }]}
            extra="不含协议，如 shop.example.com"
          >
            <Input
              maxLength={INPUT_LIMITS.mediumText}
              placeholder="shop.example.com"
              style={{ fontFamily: "ui-monospace, monospace" }}
            />
          </Form.Item>
          <Form.Item name="name" label="显示名称">
            <Input
              maxLength={INPUT_LIMITS.name}
              placeholder="可选，便于识别"
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea
              maxLength={INPUT_LIMITS.mediumText}
              rows={2}
              placeholder="可选"
            />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item name="sort_order" label="排序" style={{ width: 140 }}>
              <InputNumber style={{ width: "100%" }} />
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
