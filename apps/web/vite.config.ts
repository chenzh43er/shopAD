import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("xlsx") || id.includes("exceljs")) return "xlsx";
          if (id.includes("@supabase")) return "supabase";
          // Keep react + antd in one chunk to avoid circular chunk
          // (antd -> react -> antd) that breaks React.createContext at runtime.
          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("antd") ||
            id.includes("@ant-design")
          ) {
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // 8788：避开本机常见占用 8787 的其他 wrangler（如 HousePro pages dev）
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
});
