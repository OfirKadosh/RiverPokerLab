import { defineConfig } from "vite";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
const requireBackend = createRequire(import.meta.url);
export default defineConfig(({ command, mode }) => {
  if (mode === "ui-preview" && command !== "serve")
    throw Error("UI preview cannot be built for deployment. Use the normal production build.");
  const preview = command === "serve" && mode === "ui-preview";
  return {
    plugins: [react(), ...(preview ? [{
      name: "local-ui-preview",
      configureServer(server: any) {
        const app = requireBackend("../backend/src/dev/preview.js").createPreviewApp();
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.url?.split("?")[0].startsWith("/api/")) app(req, res, next);
          else next();
        });
      },
    }] : [])],
    ...(preview ? { define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") } } : {}),
    server: {
      host: preview ? "127.0.0.1" : "0.0.0.0",
      ...(preview ? {} : { proxy: { "/api": { target: "http://127.0.0.1:5000", changeOrigin: true } } }),
    },
  };
});
