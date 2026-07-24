import { Navigate, Outlet } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "./AuthContext";

/** Super-admin-only routes (employee management, global settings pages). */
export function RequireSuperAdmin() {
  const { loading, session, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: "40vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
