import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  USER_ROLE_LABELS,
  type AddressLibrary,
  type CreateEmployeeInput,
  type Profile,
  type UpdateEmployeeInput,
  type UserRole,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { useAuth } from "../auth/AuthContext";

type ListRes = { data: Profile[]; total: number };

type CreateForm = CreateEmployeeInput;
type EditForm = UpdateEmployeeInput & { email?: string };

function regionLabel(
  regionId: string,
  regions: AddressLibrary[],
): string {
  const region = regions.find((item) => item.id === regionId);
  if (!region) return regionId.slice(0, 8);
  const parts = [
    region.name,
    region.dial_code ? `+${region.dial_code}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function EmployeesPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [regions, setRegions] = useState<AddressLibrary[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [createForm] = Form.useForm<CreateForm>();
  const [editForm] = Form.useForm<EditForm>();
  const createRole = Form.useWatch("role", createForm);
  const editRole = Form.useWatch("role", editForm);

  const regionOptions = useMemo(
    () =>
      regions.map((region) => {
        const parts = [
          region.name,
          region.dial_code ? `+${region.dial_code}` : null,
          region.remark || null,
        ].filter(Boolean);
        return {
          value: region.id,
          label:
            parts.length > 1
              ? `${parts[0]}（${parts.slice(1).join(" · ")}）`
              : parts[0],
        };
      }),
    [regions],
  );

  const loadRegions = useCallback(async () => {
    setRegionsLoading(true);
    try {
      const res = await apiFetch<{ data: AddressLibrary[] }>(
        "/api/address-libraries",
      );
      setRegions(res.data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载地区失败");
    } finally {
      setRegionsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ListRes>("/api/employees");
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
    void loadRegions();
  }, [load, loadRegions]);

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const openEdit = (row: Profile) => {
    setEditing(row);
    editForm.setFieldsValue({
      email: row.email ?? "",
      display_name: row.display_name ?? "",
      role: row.role,
      is_active: row.is_active,
      region_ids: row.region_ids ?? [],
      password: "",
    });
    setEditOpen(true);
  };

  const columns: ColumnsType<Profile> = [
    {
      title: "员工",
      dataIndex: "display_name",
      width: 140,
      render: (v: string | null) => v || "—",
    },
    {
      title: "邮箱",
      dataIndex: "email",
      width: 220,
      render: (v: string | null) => v || "—",
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (role: UserRole) => (
        <Tag color={role === "super_admin" ? "gold" : "blue"}>
          {USER_ROLE_LABELS[role] ?? role}
        </Tag>
      ),
    },
    {
      title: "地区权限",
      dataIndex: "region_ids",
      width: 220,
      render: (ids: string[] | undefined, row) => {
        if (row.role === "super_admin") {
          return <Tag color="gold">全部地区</Tag>;
        }
        if (!ids?.length) {
          return <Tag color="warning">未分配</Tag>;
        }
        return (
          <Space size={[0, 4]} wrap>
            {ids.map((id) => (
              <Tag key={id}>{regionLabel(id, regions)}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 90,
      render: (active: boolean) =>
        active ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, row) => {
        const isSelf = row.id === user?.id;
        return (
          <Space>
            <Button type="link" onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该员工？删除后无法恢复。"
              disabled={isSelf}
              onConfirm={async () => {
                try {
                  await apiFetch(`/api/employees/${row.id}`, {
                    method: "DELETE",
                  });
                  message.success("已删除");
                  await load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "删除失败");
                }
              }}
            >
              <Button type="link" danger disabled={isSelf}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-title">
          <h1>员工管理</h1>
          <span className="list-count">共 {total} 条</span>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建员工
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={false}
        scroll={{ x: 920 }}
      />

      <Modal
        title="新建员工"
        open={createOpen}
        confirmLoading={saving}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        afterOpenChange={(open) => {
          if (open) {
            createForm.resetFields();
            createForm.setFieldsValue({ role: "employee", region_ids: [] });
          }
        }}
        onOk={async () => {
          try {
            const values = await createForm.validateFields();
            setSaving(true);
            await apiFetch("/api/employees", {
              method: "POST",
              body: JSON.stringify({
                email: values.email.trim(),
                password: values.password,
                display_name: values.display_name?.trim() || null,
                role: values.role ?? "employee",
                region_ids:
                  values.role === "super_admin"
                    ? []
                    : values.region_ids ?? [],
              }),
            });
            message.success("已创建");
            setCreateOpen(false);
            createForm.resetFields();
            await load();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "创建失败");
          } finally {
            setSaving(false);
          }
        }}
        destroyOnClose
      >
        <Form
          key={createOpen ? "create-open" : "create-closed"}
          form={createForm}
          layout="vertical"
          initialValues={{ role: "employee", region_ids: [] }}
          autoComplete="off"
        >
          <Form.Item
            name="email"
            label="登录邮箱"
            rules={[
              { required: true, message: "请填写邮箱" },
              { type: "email", message: "邮箱格式无效" },
            ]}
          >
            <Input
              maxLength={INPUT_LIMITS.email}
              autoComplete="off"
              name="employee_email_new"
              placeholder="请输入员工登录邮箱"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: "请填写密码" },
              { min: 6, message: "至少 6 位" },
            ]}
          >
            <Input.Password
              maxLength={INPUT_LIMITS.password}
              autoComplete="new-password"
              name="employee_password_new"
              placeholder="请设置初始密码"
            />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称">
            <Input
              maxLength={INPUT_LIMITS.name}
              autoComplete="off"
              placeholder="可选"
            />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: "employee", label: USER_ROLE_LABELS.employee },
                { value: "super_admin", label: USER_ROLE_LABELS.super_admin },
              ]}
            />
          </Form.Item>
          {createRole !== "super_admin" ? (
            <Form.Item
              name="region_ids"
              label="地区权限"
              rules={[
                {
                  required: true,
                  type: "array",
                  min: 1,
                  message: "请至少选择一个地区",
                },
              ]}
              extra="员工仅能查看与操作已分配地区的商品和订单"
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                loading={regionsLoading}
                placeholder="请选择可操作的地区"
                options={regionOptions}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="编辑员工"
        open={editOpen}
        confirmLoading={saving}
        onCancel={() => setEditOpen(false)}
        onOk={async () => {
          if (!editing) return;
          try {
            const values = await editForm.validateFields();
            setSaving(true);
            const payload: UpdateEmployeeInput = {
              display_name: values.display_name?.trim() || null,
              role: values.role,
              is_active: values.is_active,
            };
            if (values.role !== "super_admin") {
              payload.region_ids = values.region_ids ?? [];
            } else {
              payload.region_ids = [];
            }
            if (values.password?.trim()) {
              payload.password = values.password.trim();
            }
            await apiFetch(`/api/employees/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            });
            message.success("已保存");
            setEditOpen(false);
            await load();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "保存失败");
          } finally {
            setSaving(false);
          }
        }}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="email" label="登录邮箱">
            <Input disabled />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称">
            <Input maxLength={INPUT_LIMITS.name} />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              disabled={editing?.id === user?.id}
              options={[
                { value: "employee", label: USER_ROLE_LABELS.employee },
                { value: "super_admin", label: USER_ROLE_LABELS.super_admin },
              ]}
            />
          </Form.Item>
          {editRole !== "super_admin" ? (
            <Form.Item
              name="region_ids"
              label="地区权限"
              rules={[
                {
                  required: true,
                  type: "array",
                  min: 1,
                  message: "请至少选择一个地区",
                },
              ]}
              extra="员工仅能查看与操作已分配地区的商品和订单"
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                loading={regionsLoading}
                placeholder="请选择可操作的地区"
                options={regionOptions}
              />
            </Form.Item>
          ) : null}
          <Form.Item
            name="is_active"
            label="启用账号"
            valuePropName="checked"
          >
            <Switch disabled={editing?.id === user?.id} />
          </Form.Item>
          <Form.Item name="password" label="重置密码（留空则不改）">
            <Input.Password maxLength={INPUT_LIMITS.password} />
          </Form.Item>
          {editing?.id === user?.id ? (
            <Space>
              <Tag color="warning">当前登录账号，不可自降权限或停用</Tag>
            </Space>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
