import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#3b9cff",
          colorInfo: "#3b9cff",
          colorLink: "#3b9cff",
          colorBgLayout: "#f3f7fb",
          colorBorder: "#dce5ef",
          colorBorderSecondary: "#e8eef5",
          colorText: "#1f2a37",
          colorTextSecondary: "#6b7c8f",
          borderRadius: 8,
          controlHeight: 36,
          fontFamily:
            '"IBM Plex Sans", "Noto Sans SC", "Segoe UI", sans-serif',
        },
        components: {
          Button: {
            primaryShadow: "0 2px 8px rgba(59, 156, 255, 0.28)",
            borderRadius: 8,
          },
          Menu: {
            darkItemBg: "transparent",
            darkSubMenuItemBg: "transparent",
            darkItemSelectedBg: "rgba(59, 156, 255, 0.22)",
            darkItemHoverBg: "rgba(255, 255, 255, 0.08)",
            itemBorderRadius: 8,
            itemMarginInline: 10,
          },
          Card: {
            borderRadiusLG: 10,
          },
          Table: {
            headerBg: "#f5f8fc",
            borderColor: "#e8eef5",
          },
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
