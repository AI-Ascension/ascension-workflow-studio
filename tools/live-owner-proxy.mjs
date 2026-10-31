import http from "node:http";

export function createProxyHandler({ ownerPort, previewPort, recordProxyDiagnostic }) {
  return (req, res) => {
    const target = req.url?.startsWith("/v1/") ? ownerPort : previewPort;
    const role = target === ownerPort ? "owner" : "preview";
    const startedAt = Date.now();
    let settled = false;
    const record = (outcome, detail, terminal = true) => {
      if (settled) return;
      if (terminal) settled = true;
      recordProxyDiagnostic({
        at: new Date().toISOString(),
        role,
        method: req.method ?? null,
        path: req.url ?? null,
        target_port: target,
        outcome,
        terminal,
        detail,
        duration_ms: Date.now() - startedAt,
      });
    };
    let upstreamResponse;
    const fail = (outcome, detail) => {
      if (settled) return;
      record(outcome, detail);
      upstreamResponse?.unpipe(res);
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) {
        res.writeHead(502);
        res.end();
      }
      upstreamResponse?.destroy();
      proxy.destroy();
    };
    const { origin: _browserOrigin, ...forwardedHeaders } = req.headers;
    const headers = { ...forwardedHeaders, host: `127.0.0.1:${target}` };
    const proxy = http.request({
      host: "127.0.0.1",
      port: target,
      path: req.url,
      method: req.method,
      headers,
    }, (upstream) => {
      upstreamResponse = upstream;
      upstream.once("error", (error) => fail("upstream_stream_error", describeError(error)));
      upstream.once("aborted", () => fail("upstream_aborted", "response aborted"));
      upstream.once("close", () => {
        if (!upstream.complete) fail("upstream_premature_close", "response incomplete");
      });
      upstream.once("end", () => {
        if (upstream.complete) record("upstream_response_complete", `status=${upstream.statusCode}`);
        else fail("upstream_premature_close", "response incomplete");
      });
      if (upstream.statusCode === undefined) {
        // An upstream that completes without producing a response has no status
        // to forward. That is a transport failure, so name it instead of letting
        // it masquerade as an owner refusal.
        fail("upstream_response_without_status", "socket produced no response");
        return;
      }
      record("upstream_response", `status=${upstream.statusCode}`, false);
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on("error", (error) => fail("upstream_transport_error", describeError(error)));
    const cancel = () => {
      if (!settled) record("downstream_aborted", "client disconnected");
      upstreamResponse?.destroy();
      proxy.destroy();
    };
    req.once("aborted", cancel);
    res.once("close", () => {
      if (!res.writableFinished) cancel();
    });
    req.pipe(proxy);
  };
}

function describeError(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  const message = typeof error?.message === "string" ? error.message : null;
  return { code, message };
}

