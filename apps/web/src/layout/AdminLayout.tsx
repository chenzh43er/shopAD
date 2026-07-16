import { useEffect, useState } from "react";
import { Layout, Menu, Button, Typography, Space, Tag } from "antd";
import {
  ShoppingOutlined,
  UnorderedListOutlined,
  DashboardOutlined,
  LogoutOutlined,
  DollarOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { COD_MENU_PATHS, getOrdersListFrom, isCodListPath } from "../lib/listNav";

const { Header, Sider, Content } = Layout;

const items = [
  { key: "/", icon: <DashboardOutlined />, label: <Link to="/">概览</Link> },
  {
    key: "/products",
    icon: <ShoppingOutlined />,
    label: <Link to="/products">商品管理</Link>,
  },
  {
    key: "/orders",
    icon: <UnorderedListOutlined />,
    label: <Link to="/orders">订单管理</Link>,
  },
  {
    key: "/cod",
    icon: <DollarOutlined />,
    label: "COD订单",
    children: [
      {
        key: "/cod/pending_review",
        label: <Link to="/cod/pending_review">待审核</Link>,
      },
      {
        key: "/cod/rejected",
        label: <Link to="/cod/rejected">未通过</Link>,
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
        label: <Link to="/cod/completed">已完成</Link>,
      },
    ],
  },
  {
    key: "/shippers",
    icon: <EnvironmentOutlined />,
    label: <Link to="/shippers">寄件人管理</Link>,
  },
];

function resolveSelectedKey(
  pathname: string,
  stateFrom?: string | null,
): string {
  if (COD_MENU_PATHS.has(pathname)) return pathname;

  // 订单详情：保持进入时的列表菜单高亮（COD 子状态 / 订单管理）
  if (/^\/orders\/[^/]+/.test(pathname)) {
    const from = stateFrom || getOrdersListFrom();
    if (isCodListPath(from)) return from!;
    if (from === "/orders") return "/orders";
    return "/orders";
  }

  if (pathname.startsWith("/orders")) return "/orders";
  if (pathname.startsWith("/products")) return "/products";
  if (pathname.startsWith("/shippers")) return "/shippers";
  if (pathname === "/") return "/";
  return "";
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const stateFrom = (location.state as { from?: string } | null)?.from ?? null;
  const selected = resolveSelectedKey(location.pathname, stateFrom);
  const [openKeys, setOpenKeys] = useState<string[]>(
    location.pathname.startsWith("/cod") || isCodListPath(selected)
      ? ["/cod"]
      : [],
  );

  useEffect(() => {
    if (location.pathname.startsWith("/cod") || isCodListPath(selected)) {
      setOpenKeys((prev) => (prev.includes("/cod") ? prev : [...prev, "/cod"]));
    }
  }, [location.pathname, selected]);

  return (
    <Layout className="app-shell" style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={64} width={220}>
        <div className="brand">
          <span className="brand-mark" aria-hidden />
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
            color="processing"
            style={{ margin: 0, borderRadius: 6, fontWeight: 500 }}
          >
            管理后台
          </Tag>
          <Space size="middle">
            <Typography.Text type="secondary">{user?.email}</Typography.Text>
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
