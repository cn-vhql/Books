const { createProxyMiddleware } = require("http-proxy-middleware");

const target = process.env.KOODO_DEV_PROXY_TARGET || "http://127.0.0.1:18083";

module.exports = function setupProxy(app) {
  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    logLevel: "warn",
  });

  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/config.js" ||
      req.path === "/manifest.json"
    ) {
      return proxy(req, res, next);
    }
    return next();
  });
};
