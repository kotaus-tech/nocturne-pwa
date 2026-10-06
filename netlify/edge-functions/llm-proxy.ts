const ALLOWED_HOSTS = new Set(["api.ru-openrouter.ru", "polza.ai"]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  const origin = request.headers.get("origin");
  headers.set("Access-Control-Allow-Origin", origin || "*");
  if (origin) headers.set("Vary", "Origin");
  return headers;
}

function jsonResponse(request: Request, payload: unknown, status: number): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), { status, headers });
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (!target) {
    return jsonResponse(request, { error: "Missing target parameter" }, 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonResponse(request, { error: "Invalid target URL" }, 400);
  }

  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return jsonResponse(request, { error: "Protocol not allowed" }, 400);
  }

  // Прокси нельзя использовать как произвольный анонимный туннель.
  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return jsonResponse(request, { error: "Host not allowed" }, 403);
  }

  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "content-type" || lower === "accept") {
      forwardHeaders.set(key, value);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
  };

  // Читаем тело в ArrayBuffer, а не передаём одноразовый ReadableStream.
  // Это совместимо с Edge runtime и не ломает повторную отправку POST-запроса.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");

    const proxyHeaders = corsHeaders(request);
    for (const [key, value] of proxyHeaders.entries()) {
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return jsonResponse(request, {
      error: "Proxy fetch failed",
      details: String(err),
    }, 502);
  }
};

export const config = {
  path: "/api/llm-proxy",
};
