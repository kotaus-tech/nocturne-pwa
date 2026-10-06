export default async (request: Request) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing target parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid target URL" }), { status: 400 });
  }

  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return new Response(JSON.stringify({ error: "Protocol not allowed" }), { status: 400 });
  }

  // Небольшой allow-list на всякий случай, чтобы прокси нельзя было
  // использовать как анонимный туннель куда угодно.
  const allowedHosts = ["api.ru-openrouter.ru", "polza.ai"];
  if (!allowedHosts.includes(targetUrl.hostname)) {
    return new Response(JSON.stringify({ error: "Host not allowed" }), { status: 403 });
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

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-ignore нужно для стрим-тела в fetch
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(targetUrl.toString(), init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Proxy fetch failed", details: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/api/llm-proxy",
};
