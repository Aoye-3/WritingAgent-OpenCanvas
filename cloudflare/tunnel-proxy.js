const hopByHopHeaders = new Set([
  "connection",
  "expect",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const origin = normalizeOrigin(env.FACETWRITE_TUNNEL_API_ORIGIN);
    if (!origin) {
      return Response.json({
        error: {
          code: "tunnel_origin_required",
          message: "FACETWRITE_TUNNEL_API_ORIGIN must point to the Cloudflare Tunnel API origin."
        }
      }, { status: 500 });
    }

    const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, origin);
    const headers = copyProxyHeaders(request.headers, requestUrl);
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
    });

    return new Response(upstreamResponse.body, {
      status: normalizeStatus(upstreamResponse.status),
      statusText: upstreamResponse.statusText,
      headers: copyResponseHeaders(upstreamResponse.headers)
    });
  }
};

function normalizeOrigin(value) {
  const origin = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!origin) return "";
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

function copyProxyHeaders(source, requestUrl) {
  const headers = new Headers(source);
  for (const header of headers.keys()) {
    const lower = header.toLowerCase();
    if (hopByHopHeaders.has(lower) || lower === "host" || lower.startsWith("cf-")) {
      headers.delete(header);
    }
  }
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  return headers;
}

function copyResponseHeaders(source) {
  const headers = new Headers(source);
  for (const header of headers.keys()) {
    if (hopByHopHeaders.has(header.toLowerCase())) {
      headers.delete(header);
    }
  }
  return headers;
}

function normalizeStatus(status) {
  return status >= 200 && status <= 599 ? status : 502;
}
