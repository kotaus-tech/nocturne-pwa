import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "node:stream";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Хосты, которые пускает резервный прокси. Список совпадает с allow-list
 * edge-функции `netlify/edge-functions/llm-proxy.ts` — меняться должен вместе
 * с ним.
 */
const PROXY_ALLOWED_HOSTS = ["api.ru-openrouter.ru", "polza.ai"];

const PROXY_PATH = "/api/llm-proxy";

/**
 * Резервный канал для провайдеров, которые не пускают браузер напрямую (CORS).
 *
 * В продакшене его роль играет edge-функция Netlify по пути `/api/llm-proxy`.
 * В dev-режиме функции нет, поэтому запрос уходил в никуда и приложение
 * показывало «Эндпоинт API не найден (404)». Мидлвара повторяет поведение
 * функции для тех же адресов, поэтому локальная разработка и превью ведут
 * себя так же, как продакшен на Netlify.
 */
function llmProxyDevPlugin(): Plugin {
  return {
    name: "nocturne-llm-proxy-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? "/", "http://localhost");
        if (requestUrl.pathname !== PROXY_PATH) {
          next();
          return;
        }

        const sendJson = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        };

        const target = requestUrl.searchParams.get("target");
        if (!target) {
          sendJson(400, { error: "Missing target parameter" });
          return;
        }

        let targetUrl: URL;
        try {
          targetUrl = new URL(target);
        } catch {
          sendJson(400, { error: "Invalid target URL" });
          return;
        }

        if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
          sendJson(400, { error: "Protocol not allowed" });
          return;
        }

        if (!PROXY_ALLOWED_HOSTS.includes(targetUrl.hostname)) {
          sendJson(403, { error: "Host not allowed" });
          return;
        }

        const forwardHeaders = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          const lower = key.toLowerCase();
          if (
            (lower === "authorization" || lower === "content-type" || lower === "accept") &&
            typeof value === "string"
          ) {
            forwardHeaders.set(key, value);
          }
        }

        const method = req.method ?? "GET";
        let body: Buffer | undefined;

        if (method !== "GET" && method !== "HEAD") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          body = Buffer.concat(chunks);
        }

        try {
          const upstream = await fetch(targetUrl.toString(), {
            method,
            headers: forwardHeaders,
            // Buffer — обычный ArrayBufferView, тип в lib.dom его не описывает.
            body: body as unknown as BodyInit | undefined,
          });

          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (
              lower === "content-encoding" ||
              lower === "content-length" ||
              lower === "transfer-encoding" ||
              lower === "connection"
            ) {
              return;
            }
            res.setHeader(key, value);
          });

          if (!upstream.body) {
            res.end();
            return;
          }

          Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
        } catch (err) {
          sendJson(502, { error: "Proxy fetch failed", details: String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), llmProxyDevPlugin()],
  server: {
    host: true,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
