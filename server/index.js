// Vizio Food — Express server for Hostinger Web App (Node.js runtime).
//
// Responsibilities:
//   1. Expose /api/* routes (REST API surface lives here).
//   2. Serve the production Vite build from ../dist as static assets.
//   3. Fall back to index.html for any other GET request so React Router's
//      BrowserRouter can handle client-side routes (e.g. /admin, /kitchen).
//
// Run locally or on Hostinger with:  npm start   (i.e. `node server/index.js`).
//
// Hostinger runs Node apps behind Phusion Passenger. Passenger injects the
// port via the PORT env var, so we MUST listen on `process.env.PORT` — do not
// hard-code a port. See the deployment notes for the panel settings.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust the first proxy hop so req.secure / X-Forwarded-* headers (set by
// Hostinger's nginx -> Passenger -> app chain) are honored.
app.set("trust proxy", 1);

// Body parsers for JSON/URL-encoded API payloads. A modest limit is plenty
// for the cart/order bodies used by this project.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
// All API endpoints are mounted under /api. Add real handlers here; for now a
// health check is provided so deployment can be verified end-to-end.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Example placeholder so the /api surface is clearly extensible.
app.get("/api", (_req, res) => {
  res.json({ name: "vizio-food-api", version: "1.0.0" });
});

// ---------------------------------------------------------------------------
// Static assets (Vite build output)
// ---------------------------------------------------------------------------
const distDir = path.resolve(__dirname, "..", "dist");

// Serve built assets (JS/CSS/images/sounds/favicon) with long-lived
// immutability headers — Vite hashes filenames, so they are safe to cache.
app.use(
  express.static(distDir, {
    maxAge: "1y",
    immutable: true,
    index: false, // we serve index.html explicitly via the SPA fallback below
  })
);

// ---------------------------------------------------------------------------
// SPA fallback — BrowserRouter
// ---------------------------------------------------------------------------
// Any non-API GET request that didn't match a real file (e.g. /, /admin,
// /admin/orders, /kitchen) returns index.html so the client-side router can
// take over. API 404s stay JSON (handled below) so they aren't masked by HTML.
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) {
      // Most likely dist/ hasn't been built yet — give an actionable message
      // instead of a bare 500 during first-run/deploy debugging.
      res.status(500).send(
        "Build output not found. Run `npm run build` before starting the server."
      );
    }
  });
});

// Generic JSON 404 for unmatched /api routes (kept after the SPA fallback so
// only true API misses reach it).
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Passenger swallows stdout in production, but this helps locally and in
  // Hostinger's "Live Logs"/PM2 output.
  console.log(`Vizio Food server listening on port ${PORT}`);
});
