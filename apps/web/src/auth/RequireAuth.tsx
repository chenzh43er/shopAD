import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  // 与 LoginPage 一致：仅 session+profile 才放行，避免重定向环
  if (!session || !profile) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
