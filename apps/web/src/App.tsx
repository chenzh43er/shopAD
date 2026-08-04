import { Suspense, lazy } from "react";
import { Spin } from "antd";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireSuperAdmin } from "./auth/RequireSuperAdmin";
import { AdminLayout } from "./layout/AdminLayout";
import { LoginPage } from "./pages/LoginPage";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage").then((m) => ({ default: m.ProductsPage })),
);
const ProductFormPage = lazy(() =>
  import("./pages/ProductFormPage").then((m) => ({
    default: m.ProductFormPage,
  })),
);
const OrdersPage = lazy(() =>
  import("./pages/OrdersPage").then((m) => ({ default: m.OrdersPage })),
);
const OrderDetailPage = lazy(() =>
  import("./pages/OrderDetailPage").then((m) => ({
    default: m.OrderDetailPage,
  })),
);
const ShippersPage = lazy(() =>
  import("./pages/ShippersPage").then((m) => ({ default: m.ShippersPage })),
);
const AddressRegionsPage = lazy(() =>
  import("./pages/AddressRegionsPage").then((m) => ({
    default: m.AddressRegionsPage,
  })),
);
const CurrenciesPage = lazy(() =>
  import("./pages/CurrenciesPage").then((m) => ({ default: m.CurrenciesPage })),
);
const DomainsPage = lazy(() =>
  import("./pages/DomainsPage").then((m) => ({ default: m.DomainsPage })),
);
const EmployeesPage = lazy(() =>
  import("./pages/EmployeesPage").then((m) => ({ default: m.EmployeesPage })),
);

function PageFallback() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "80px 0",
      }}
    >
      <Spin size="large" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/new" element={<ProductFormPage />} />
            <Route path="products/:id/edit" element={<ProductFormPage />} />
            <Route
              path="orders"
              element={<Navigate to="/cod/pending_review" replace />}
            />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="cod" element={<OrdersPage />} />
            <Route
              path="cod/rejected"
              element={<Navigate to="/cod/invalid" replace />}
            />
            <Route path="cod/:tab" element={<OrdersPage />} />
            <Route element={<RequireSuperAdmin />}>
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="shippers" element={<ShippersPage />} />
              <Route path="address-regions" element={<AddressRegionsPage />} />
              <Route path="currencies" element={<CurrenciesPage />} />
              <Route path="domains" element={<DomainsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
