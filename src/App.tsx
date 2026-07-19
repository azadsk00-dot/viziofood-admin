import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AdminRoute, StaffRoute } from "./components/ProtectedRoute";

import ProductManagement from "./admin/ProductManagement";
import {
  EnhancedDashboard,
  EnhancedOrders,
} from "./admin/AdminEnhanced";

import {
  Categories,
  Customers,
  Reports,
  SettingsPage,
} from "./admin/pages";

import AdminLogin from "./pages/AdminLogin";

const Kitchen = lazy(() => import("./pages/Kitchen"));
const AdminLayout = lazy(() => import("./admin/AdminLayout"));

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="admin-message">Loading...</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/admin" replace />} />

          <Route path="/admin/login" element={<AdminLogin />} />

          <Route
            path="/kitchen"
            element={
              <StaffRoute>
                <Kitchen />
              </StaffRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<EnhancedDashboard />} />
            <Route path="orders" element={<EnhancedOrders />} />
            <Route path="products" element={<ProductManagement />} />
            <Route path="categories" element={<Categories />} />
            <Route path="customers" element={<Customers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}