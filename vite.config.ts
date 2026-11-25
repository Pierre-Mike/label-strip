import { defineConfig, type Plugin } from "vite";

/** Content Security Policy for the built site: only this site's own files may load,
 * so no label data can leave the page. Left out in dev, where Vite injects scripts. */
const csp: Plugin = {
  name: "csp",
  apply: "build",
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "connect-src 'self' blob: data:",
      "img-src 'self' blob: data:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
};

export default defineConfig({
  base: "./",
  plugins: [csp],
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  worker: { format: "es" },
});
