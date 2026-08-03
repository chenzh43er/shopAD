import { useEffect, useMemo, useState } from "react";
import { Layout, Menu, Button, Typography, Space, Tag } from "antd";
import {
  ShoppingOutlined,
  DashboardOutlined,
  LogoutOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  PayCircleOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { USER_ROLE_LABELS } from "@shopad/shared";
import { useAuth } from "../auth/AuthContext";
import { COD_MENU_PATHS, getOrdersListFrom, isCodListPath } from "../lib/listNav";

const { Header, Sider, Content } = Layout;

const DEFAULT_COD_PATH = "/cod/pending_review";

function resolveSelectedKey(
  pathname: string,
  stateFrom?: string | null,
): string {
  if (COD_MENU_PATHS.has(pathname)) return pathname;

  if (/^\/orders\/[^/]+/.test(pathname)) {
    const from = stateFrom || getOrdersListFrom();
    if (isCodListPath(from)) return from!;
    return DEFAULT_COD_PATH;
  }

  if (pathname.startsWith("/cod")) return DEFAULT_COD_PATH;
  if (pathname.startsWith("/products")) return "/products";
  if (pathname.startsWith("/shippers")) return "/shippers";
  if (pathname.startsWith("/address-regions")) return "/address-regions";
  if (pathname.startsWith("/currencies")) return "/currencies";
  if (pathname.startsWith("/employees")) return "/employees";
  if (pathname === "/") return "/";
  return "";
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isSuperAdmin, signOut } = useAuth();
  const stateFrom = (location.state as { from?: string } | null)?.from ?? null;
  const selected = resolveSelectedKey(location.pathname, stateFrom);
  const [openKeys, setOpenKeys] = useState<string[]>(
    location.pathname.startsWith("/cod") || isCodListPath(selected)
      ? ["/cod"]
      : [],
  );

  const items = useMemo(() => {
    const base = [
      { key: "/", icon: <DashboardOutlined />, label: <Link to="/">概览</Link> },
      {
        key: "/products",
        icon: <ShoppingOutlined />,
        label: <Link to="/products">商品管理</Link>,
      },
      {
        key: "/cod",
        icon: <DollarOutlined />,
        label: "COD订单",
        children: [
          {
            key: "/cod/all",
            label: <Link to="/cod/all">全部订单</Link>,
          },
          {
            key: "/cod/pending_review",
            label: <Link to="/cod/pending_review">待审核</Link>,
          },
          {
            key: "/cod/awaiting_confirm",
            label: <Link to="/cod/awaiting_confirm">待确认</Link>,
          },
          {
            key: "/cod/awaiting_shipment",
            label: <Link to="/cod/awaiting_shipment">待发货</Link>,
          },
          {
            key: "/cod/shipped",
            label: <Link to="/cod/shipped">已发货</Link>,
          },
          {
            key: "/cod/completed",
            label: <Link to="/cod/completed">已签收</Link>,
          },
          {
            key: "/cod/refused",
            label: <Link to="/cod/refused">拒绝签收</Link>,
          },
          {
            key: "/cod/invalid",
            label: <Link to="/cod/invalid">无效订单</Link>,
          },
        ],
      },
    ];

    if (!isSuperAdmin) return base;

    return [
      ...base,
      {
        key: "/employees",
        icon: <TeamOutlined />,
        label: <Link to="/employees">员工管理</Link>,
      },
      {
        key: "/shippers",
        icon: <EnvironmentOutlined />,
        label: <Link to="/shippers">寄件人管理</Link>,
      },
      {
        key: "/address-regions",
        icon: <GlobalOutlined />,
        label: <Link to="/address-regions">地区管理</Link>,
      },
      {
        key: "/currencies",
        icon: <PayCircleOutlined />,
        label: <Link to="/currencies">币种管理</Link>,
      },
    ];
  }, [isSuperAdmin]);

  useEffect(() => {
    if (location.pathname.startsWith("/cod") || isCodListPath(selected)) {
      setOpenKeys((prev) => (prev.includes("/cod") ? prev : [...prev, "/cod"]));
    }
  }, [location.pathname, selected]);

  const roleLabel = profile?.role
    ? USER_ROLE_LABELS[profile.role] ?? profile.role
    : "管理后台";

  return (
    <Layout className="app-shell" style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={64} width={220}>
        <div className="brand">
          <img
            className="brand-mark"
            src="/logo.png"
            alt=""
            width={28}
            height={28}
          />
          <span>ShopAD</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selected ? [selected] : []}
          openKeys={openKeys}
          onOpenChange={setOpenKeys}
          items={items}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 20,
            height: 56,
            lineHeight: "56px",
          }}
        >
          <Tag
            color={isSuperAdmin ? "gold" : "processing"}
            style={{ margin: 0, borderRadius: 6, fontWeight: 500 }}
          >
            {roleLabel}
          </Tag>
          <Space size="middle">
            <Typography.Text type="secondary">
              {profile?.display_name || user?.email}
            </Typography.Text>
            <Button
              icon={<LogoutOutlined />}
              onClick={async () => {
                await signOut();
                navigate("/login", { replace: true });
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content>
          <div className="app-content">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
