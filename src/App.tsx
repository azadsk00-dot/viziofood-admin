import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AdminRoute, StaffRoute } from "./components/ProtectedRoute";
import { Footer, Navbar, OrdersPausedBanner } from "./components/Layout";

import ProductManagement from "./admin/ProductManagement";
import {
  EnhancedDashboard,
  EnhancedOrders,
} from "./admin/AdminEnhanced";

import {
  Categories,
  Customers,
  Reports,
} from "./admin/pages";
import { SettingsPage } from "./admin/Settings";

import AdminLogin from "./pages/AdminLogin";
import { CheckoutCancel, CheckoutSuccess } from "./pages/CheckoutResult";

const Home = lazy(() => import("./pages/Home"));
const Menu = lazy(() => import("./pages/Menu"));
const About = lazy(() => import("./pages/About"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Account = lazy(() => import("./pages/Account"));
const Kitchen = lazy(() => import("./pages/Kitchen"));
const AdminLayout = lazy(() => import("./admin/AdminLayout"));

function Public() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navbar />
      <OrdersPausedBanner />
      <main id="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/about" element={<About />} />
          <Route path="/account" element={<Account />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/checkout/cancel" element={<CheckoutCancel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="admin-message">Loading...</div>}>
        <Routes>
          <Route path="/kitchen" element={<StaffRoute><Kitchen /></StaffRoute>} />

          <Route path="/admin/login" element={<AdminLogin />} />

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
            {/* /admin/menu is the historical/bookmarked URL for the menu
                manager — keep it working as an alias for the products page. */}
            <Route path="menu" element={<ProductManagement />} />
            <Route path="categories" element={<Categories />} />
            <Route path="customers" element={<Customers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsPage />} />
            {/* Unknown /admin/* paths must stay inside the admin panel —
                without this they fall through to the public site's splat
                route (e.g. /admin/menu used to render the public menu). */}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>

          <Route path="*" element={<Public />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
