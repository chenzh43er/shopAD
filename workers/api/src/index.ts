import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAdmin } from "./middleware/auth";
import { productsRoutes } from "./routes/products";
import { packagesRoutes } from "./routes/packages";
import { ordersRoutes } from "./routes/orders";
import { uploadsRoutes } from "./routes/uploads";
import { shippersRoutes } from "./routes/shippers";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const middleware = cors({
    origin: (origin) => {
      if (!origin) return origins[0] ?? "*";
      return origins.includes(origin) ? origin : origins[0] ?? "";
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  });

  return middleware(c, next);
});

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "shopad-api", ts: new Date().toISOString() }),
);

const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", requireAdmin);
api.route("/products", packagesRoutes);
api.route("/products", productsRoutes);
api.route("/orders", ordersRoutes);
api.route("/shippers", shippersRoutes);
api.route("/uploads", uploadsRoutes);

app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Internal Server Error" }, 500);
});

export default app;
