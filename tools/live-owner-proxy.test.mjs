import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createProxyHandler } from "./live-owner-proxy.mjs";

async function fixture(t, serve) {
  const entries = [];
  const sockets = new Set();
  const owner = http.createServer(serve);
  const listen = async (server) => {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
  };
  const ownerPort = await listen(owner);
  const proxy = http.createServer(createProxyHandler({
    ownerPort, previewPort: ownerPort,
    recordProxyDiagnostic: (entry) => entries.push(entry),
  }));
  const port = await listen(proxy);
  t.after(async () => {
    const closed = [owner, proxy].filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve)));
    for (const socket of sockets) socket.destroy();
    await Promise.all(closed);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sockets.size, 0, "all fixture sockets close");
  });
  return { owner, entries, port };
}

function request(port, onChunk = () => {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/v1/health", agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; onChunk(res); });
      res.on("error", () => {});
      res.once("close", () => resolve({ status: res.statusCode, body, complete: res.complete }));
    });
    req.on("error", reject);
    req.setTimeout(2_000, () => req.destroy(new Error("loopback request hung")));
  });
}

function terminal(entries, expected) {
  const outcomes = entries.filter((entry) => entry.terminal);
  assert.equal(outcomes.length, 1, JSON.stringify(entries));
  assert.equal(outcomes[0].outcome, expected);
}

for (const status of [200, 403, 503]) {
  test(`preserves complete upstream ${status}`, { timeout: 5_000 }, async (t) => {
    const f = await fixture(t, (_req, res) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end("authoritative body");
    });
    assert.deepEqual(await request(f.port), { status, body: "authoritative body", complete: true });
    assert.equal(f.entries[0].outcome, "upstream_response");
    assert.equal(f.entries[0].terminal, false);
    terminal(f.entries, "upstream_response_complete");
  });
}

for (const length of [undefined, 100]) {
  test(`reset after downstream receives partial body (${length ? "content-length" : "chunked"}) fails`, { timeout: 5_000 }, async (t) => {
    let upstream;
    const f = await fixture(t, (_req, res) => {
      upstream = res;
      res.writeHead(200, length ? { "content-length": length } : {});
      res.write("partial");
    });
    const response = await request(f.port, () => upstream.destroy());
    assert.deepEqual(response, { status: 200, body: "partial", complete: false });
    terminal(f.entries, "upstream_aborted");
    assert.equal(f.entries.length, 2, "headers plus exactly one terminal failure");
  });
}

test("pre-header reset follows the 502 transport path", { timeout: 5_000 }, async (t) => {
  const f = await fixture(t, (req) => req.socket.destroy());
  assert.deepEqual(await request(f.port), { status: 502, body: "", complete: true });
  terminal(f.entries, "upstream_transport_error");
  assert.equal(f.entries[0].detail.code, "ECONNRESET");
});

test("connection refusal follows the 502 transport path", { timeout: 5_000 }, async (t) => {
  const f = await fixture(t, () => {});
  await new Promise((resolve) => f.owner.close(resolve));
  assert.deepEqual(await request(f.port), { status: 502, body: "", complete: true });
  terminal(f.entries, "upstream_transport_error");
  assert.equal(f.entries[0].detail.code, "ECONNREFUSED");
});

test("downstream cancellation closes the unfinished upstream", { timeout: 5_000 }, async (t) => {
  let upstreamClosed;
  const f = await fixture(t, (_req, res) => {
    upstreamClosed = once(res, "close");
    res.write("partial");
  });
  await request(f.port, (res) => res.destroy());
  await upstreamClosed;
  terminal(f.entries, "downstream_aborted");
});

for (const event of ["error", "close"]) {
  test(`injected ${event} fallback on a real loopback response terminates once`, { timeout: 5_000 }, async (t) => {
    // TCP resets naturally emit aborted first. Isolate the other listeners to
    // cover fallback events without claiming these are natural TCP sequences.
    const originalRequest = http.request;
    let upstream;
    t.mock.method(http, "request", function (options, callback) {
      return originalRequest.call(this, options, (response) => {
        upstream = response;
        callback(response);
      });
    });
    const f = await fixture(t, (_req, res) => res.write("partial"));
    const response = await request(f.port, () => {
      upstream.emit(event, new Error("injected stream failure"));
    });
    assert.deepEqual(response, { status: 200, body: "partial", complete: false });
    terminal(f.entries, event === "error" ? "upstream_stream_error" : "upstream_premature_close");
    assert.equal(f.entries.length, 2);
  });
}
