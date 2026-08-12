// Minimal HTTP client for talking to Journiv. Uses node:http/https rather than
// fetch() specifically so the outbound Host header can be overridden: fetch()
// treats Host as a forbidden header and silently ignores it, which would make
// JOURNIV_HOST_HEADER impossible. Kept side-effect-free so it can be tested
// without starting the MCP server.
import http from "node:http";
import https from "node:https";

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface RawRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// Connects to the host/port in `fullUrl`, but if `hostHeader` is non-empty sends
// that as the Host header instead of the URL's authority. This is what lets the
// MCP reach Journiv by internal IP while presenting the public hostname that
// Journiv's TrustedHostMiddleware (DOMAIN_NAME) requires.
export function rawRequest(
  fullUrl: string,
  opts: RawRequestOptions = {},
  hostHeader = ""
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl);
    const mod = u.protocol === "https:" ? https : http;
    const headers: Record<string, string | number> = { ...(opts.headers ?? {}) };
    if (hostHeader) headers["Host"] = hostHeader;
    if (opts.body != null) headers["Content-Length"] = Buffer.byteLength(opts.body);

    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}
