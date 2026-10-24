import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";

export function startSyntheticModServer(port, harnessRoot, effectLedger) {
  const goldenRoot = join(harnessRoot, "protocol-artifact");
  const normalObservation = JSON.parse(readFileSync(join(goldenRoot, "runtime-v3-gameplay/golden/state-response.json"), "utf8"));
  const expertObservation = JSON.parse(readFileSync(join(goldenRoot, "runtime-v4-expert/golden/observation.json"), "utf8"));
  const settledAction = JSON.parse(readFileSync(join(goldenRoot, "runtime-v4-expert-action/golden/action-settled.json"), "utf8"));
  return createServer(async (request, response) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 131_072) {
        response.writeHead(413);
        response.end();
        return;
      }
      chunks.push(chunk);
    }
    if (request.headers.authorization !== "Bearer mod-token") {
      response.writeHead(401);
      response.end();
      return;
    }
    let body = {};
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch {
        response.writeHead(400);
        response.end();
        return;
      }
    }
    let status = 200;
    let value;
    const header = (name, fallback) => request.headers[name] ?? fallback;
    const identity = (operationId, generation, stateId, action) => ({
      correlation_id: header("x-sts2-correlation-id", "request"),
      instance_id: header("x-sts2-instance-id", body.instance_id ?? "instance-1"),
      session_id: header("x-sts2-session-id", body.session_id ?? "session-1"),
      lease_id: header("x-sts2-lease-id", body.lease_id ?? "lease-1"),
      lease_epoch: Number(header("x-sts2-lease-epoch", body.lease_epoch ?? 1)),
      generation, state_id: stateId, operation_id: operationId, action,
    });
    if (request.url === "/api/v3/runtime/state") {
      value = v3Response(normalObservation, "state_response", request.headers);
    } else if (request.url === "/api/v3/runtime/legal-actions") {
      value = v3Response(normalObservation, "legal_actions_response", request.headers);
    } else if (request.url === "/api/v4/runtime/expert-state") {
      value = { ...expertObservation, state_id: "live:7", generation: 7 };
    } else if (request.url === "/api/v4/runtime/expert-action") {
      const operationId = body.operation_id;
      effectLedger.dispatches.push({
        operation_id: operationId ?? null,
        action_id: body.action?.action_id ?? null,
      });
      value = {
        ...settledAction,
        ...identity(operationId, body.generation ?? 7, body.state_id ?? "live:7", body.action ?? null),
        status: "unknown", observation: null, transition: null, error_code: "transport_timeout",
      };
    } else if (request.url?.startsWith("/api/v4/runtime/expert-actions/")) {
      const operationId = request.url.slice("/api/v4/runtime/expert-actions/".length);
      effectLedger.settlements.push({ operation_id: operationId });
      value = {
        ...settledAction,
        ...identity(operationId, settledAction.generation, settledAction.state_id, settledAction.action),
        status: "settled",
      };
    } else {
      status = 404;
      value = { error_code: "fixture_route_missing" };
    }
    const encoded = JSON.stringify(value);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(encoded),
      connection: "close",
    });
    response.end(encoded);
  }).listen(port, "127.0.0.1");
}

function v3Response(template, kind, headers) {
  const value = JSON.parse(JSON.stringify(template));
  value.kind = kind;
  value.correlation_id = headers["x-sts2-correlation-id"] ?? "";
  value.instance_id = "instance-1";
  value.session_id = "gateway-session-1";
  value.lease_id = "lease-1";
  value.lease_epoch = 1;
  value.generation = 7;
  value.state_id = "live:7";
  value.observation.state_id = "live:7";
  value.observation.generation = 7;
  value.observation.state = { state: "combat", turn_index: 8, enemies: [] };
  value.legal_actions = [{ action_id: "end:7", action: { kind: "end_turn" } }];
  if (kind === "legal_actions_response") value.observation = null;
  return value;
}
