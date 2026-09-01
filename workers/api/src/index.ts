import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { requireStaff } from "./middleware/auth";
import { productsRoutes } from "./routes/products";
import { packagesRoutes } from "./routes/packages";
import { ordersRoutes } from "./routes/orders";
import { registerPublicOrderRoutes } from "./routes/publicOrders";
import { uploadsRoutes } from "./routes/uploads";
import { shippersRoutes } from "./routes/shippers";
import { addressLibrariesRoutes } from "./routes/addressLibraries";
import { currenciesRoutes } from "./routes/currencies";
import { domainsRoutes } from "./routes/domains";
import { employeesRoutes, meRoutes } from "./routes/employees";
import { isRedisEnabled } from "./lib/redis";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: {
      accelerometer: [],
      camera: [],
      geolocation: [],
      gyroscope: [],
      magnetometer: [],
      microphone: [],
      payment: [],
      usb: [],
    },
  }),
);

app.use("*", async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const middleware = cors({
    origin: (origin) => {
      // 无 Origin（如同机 curl）不回显；未在白名单内一律拒绝，勿回落 origins[0]
      if (!origin) return "";
      return origins.includes(origin) ? origin : "";
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  });

  return middleware(c, next);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "shopad-api",
    redis: isRedisEnabled(c.env) ? "on" : "off",
    redis_flag: String(c.env.REDIS_ENABLED ?? ""),
    ts: new Date().toISOString(),
  }),
);

// 公开查单：无需员工 Token（须挂在鉴权 /api 之前）
registerPublicOrderRoutes(app);

const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", requireStaff);
api.route("/me", meRoutes);
api.route("/employees", employeesRoutes);
api.route("/products", packagesRoutes);
api.route("/products", productsRoutes);
api.route("/orders", ordersRoutes);
api.route("/shippers", shippersRoutes);
api.route("/address-libraries", addressLibrariesRoutes);
api.route("/currencies", currenciesRoutes);
api.route("/domains", domainsRoutes);
api.route("/uploads", uploadsRoutes);

app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
