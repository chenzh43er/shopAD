import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireSuperAdmin } from "./auth/RequireSuperAdmin";
import { AdminLayout } from "./layout/AdminLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { ShippersPage } from "./pages/ShippersPage";
import { AddressRegionsPage } from "./pages/AddressRegionsPage";
import { CurrenciesPage } from "./pages/CurrenciesPage";
import { EmployeesPage } from "./pages/EmployeesPage";

export default function App() {
  return (
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
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
