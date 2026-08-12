// Integration test for the Host-header override, reproducing the real failure:
// Journiv's Starlette TrustedHostMiddleware rejects any request whose Host isn't
// its configured public hostname with 400 "Invalid host header". These tests
// stand up a stub that behaves exactly that way and prove:
//   - connecting by IP without the override is rejected (the bug), and
//   - the override makes Journiv accept the request (the fix),
// while still connecting to the internal address.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { rawRequest } from "./httpclient.js";

const TRUSTED_HOST = "journal.example.net";
let server: http.Server;
let base: string; // http://127.0.0.1:<port> — the "internal" address

before(async () => {
  server = http.createServer((req, res) => {
    // Mimic TrustedHostMiddleware: compare Host without its port.
    const host = (req.headers.host ?? "").split(":")[0];
    if (host !== TRUSTED_HOST) {
      res.statusCode = 400;
      res.end("Invalid host header");
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          sawHost: req.headers.host,
          method: req.method,
          contentLength: req.headers["content-length"] ?? null,
          body: Buffer.concat(chunks).toString("utf8") || null,
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(() => server.close());

test("without override, connecting by IP is rejected (the bug)", async () => {
  const res = await rawRequest(`${base}/api/v1/health`);
  assert.equal(res.status, 400);
  assert.match(res.body, /Invalid host header/);
});

test("with override, the request is accepted while still hitting the IP (the fix)", async () => {
  const res = await rawRequest(`${base}/api/v1/health`, {}, TRUSTED_HOST);
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  // The stub saw the trusted Host even though we dialed 127.0.0.1.
  assert.equal(data.sawHost.split(":")[0], TRUSTED_HOST);
});

test("POST body round-trips with a correct Content-Length", async () => {
  const body = JSON.stringify({ email: "mcp@example.com", password: "secret" });
  const res = await rawRequest(
    `${base}/api/v1/auth/login`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    TRUSTED_HOST
  );
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.method, "POST");
  assert.equal(data.body, body);
  assert.equal(data.contentLength, String(Buffer.byteLength(body)));
});
