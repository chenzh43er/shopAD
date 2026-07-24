import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  LogisticsShipper,
  UpsertLogisticsShipperInput,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";

type ShipperListRes = { data: LogisticsShipper[]; total: number };

const emptyForm: UpsertLogisticsShipperInput = {
  name: "",
  phone: "",
  province: "",
  city: "",
  district: "",
  address: "",
  address_info: "",
  consignor_flag: "0",
  consignor_name: "",
  consignor_phone: "",
  is_default: false,
};

export function ShippersPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<LogisticsShipper[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LogisticsShipper | null>(null);
  const [form] = Form.useForm<UpsertLogisticsShipperInput>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ShipperListRes>("/api/shippers");
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
    form.setFieldsValue(emptyForm);
    setOpen(true);
  };

  const openEdit = (row: LogisticsShipper) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      phone: row.phone ?? "",
      province: row.province ?? "",
      city: row.city ?? "",
      district: row.district ?? "",
      address: row.address ?? "",
      address_info: row.address_info ?? "",
      consignor_flag: row.consignor_flag ?? "0",
      consignor_name: row.consignor_name ?? "",
      consignor_phone: row.consignor_phone ?? "",
      is_default: row.is_default,
    });
    setOpen(true);
  };

  const columns: ColumnsType<LogisticsShipper> = [
    {
      title: "寄件人",
      dataIndex: "name",
      width: 120,
      render: (v: string, row) => (
        <Space>
          {v}
          {row.is_default ? <Tag color="blue">默认</Tag> : null}
        </Space>
      ),
    },
    { title: "寄件人电话", dataIndex: "phone", width: 140 },
    { title: "寄件省", dataIndex: "province", width: 100 },
    { title: "寄件城市", dataIndex: "city", width: 120 },
    { title: "寄件区域", dataIndex: "district", width: 120 },
    {
      title: "寄件地址",
      dataIndex: "address",
      width: 220,
    },
    {
      title: "委托人标识",
      dataIndex: "consignor_flag",
      width: 100,
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
            title="确认删除该寄件人？"
            disabled={row.is_default}
            onConfirm={async () => {
              try {
                await apiFetch(`/api/shippers/${row.id}`, { method: "DELETE" });
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
        <h1>寄件人管理</h1>
        <Button type="primary" onClick={openCreate}>
          新增寄件人
        </Button>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 12 }}>
        对应物流导出模板左侧寄件栏（寄件人 / 电话 / 省市区地址 / 委托人）。发货时可选择寄件人写入订单。
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
        title={editing ? "编辑寄件人" : "新增寄件人"}
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        width={640}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            setSaving(true);
            const payload: UpsertLogisticsShipperInput = {
              name: values.name,
              phone: values.phone || null,
              province: values.province || null,
              city: values.city || null,
              district: values.district || null,
              address: values.address || null,
              address_info: values.address_info || null,
              consignor_flag: values.consignor_flag || "0",
              consignor_name: values.consignor_name || null,
              consignor_phone: values.consignor_phone || null,
              is_default: Boolean(values.is_default),
            };
            if (editing) {
              await apiFetch(`/api/shippers/${editing.id}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
              });
              message.success("已保存");
            } else {
              await apiFetch("/api/shippers", {
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
            name="name"
            label="寄件人"
            rules={[{ required: true, message: "请填写寄件人" }]}
          >
            <Input maxLength={INPUT_LIMITS.name} placeholder="如 UBT" />
          </Form.Item>
          <Form.Item name="phone" label="寄件人电话">
            <Input
              maxLength={INPUT_LIMITS.phone}
              placeholder="如 087893521997"
            />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item name="province" label="寄件省" style={{ width: 180 }}>
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
            <Form.Item name="city" label="寄件城市" style={{ width: 180 }}>
              <Input
                maxLength={INPUT_LIMITS.region}
                placeholder="如 JAKARTA"
              />
            </Form.Item>
            <Form.Item name="district" label="寄件区域" style={{ width: 180 }}>
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="寄件地址">
            <Input.TextArea
              rows={2}
              maxLength={INPUT_LIMITS.address}
              showCount
            />
          </Form.Item>
          <Form.Item name="address_info" label="寄件地址信息">
            <Input maxLength={INPUT_LIMITS.addressInfo} />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item
              name="consignor_flag"
              label="委托人标识"
              style={{ width: 140 }}
            >
              <Input maxLength={INPUT_LIMITS.flag} placeholder="默认 0" />
            </Form.Item>
            <Form.Item
              name="consignor_name"
              label="委托人姓名"
              style={{ width: 180 }}
            >
              <Input maxLength={INPUT_LIMITS.name} />
            </Form.Item>
            <Form.Item
              name="consignor_phone"
              label="委托人电话"
              style={{ width: 180 }}
            >
              <Input maxLength={INPUT_LIMITS.phone} />
            </Form.Item>
          </Space>
          <Form.Item
            name="is_default"
            label="设为默认寄件人"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
