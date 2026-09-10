import { useState } from "react";

import { OwnerApiClient, type ClientMode } from "@studio/client";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";

interface CompatibilityViewProps {
  mode: ClientMode;
  onModeChange: (mode: ClientMode) => void;
  liveClient: OwnerApiClient;
}

const admittedRoutes = [
  ["GET", "/v1/health", "admitted"],
  ["GET", "/v1/capabilities", "admitted"],
  ["POST", "/v1/workflow-definitions/validate", "admitted"],
  ["POST", "/v1/workflow-definitions/inspect", "admitted"],
  ["POST", "/v1/workflow-definitions/diff", "admitted"],
  ["POST", "/v1/workflow-runs", "admitted"],
  ["GET", "/v1/workflow-runs/:id", "admitted"],
  ["GET", "/v1/workflow-runs/:id/events", "admitted"],
  ["POST", "/v1/workflow-runs/:id/commands", "admitted"],
  ["POST", "/v1/workflow-runs/:id/replay", "admitted"],
  ["POST", "/v1/workflow-runs/:id/export", "admitted"],
  ["GET", "/v1/workflow-runs/:id/artifacts/:artifact", "gated"],
  ["GET", "/v1/studio/definitions", "admitted"],
  ["POST", "/v1/studio/drafts", "admitted"],
  ["GET", "/v1/studio/drafts/:id", "admitted"],
  ["PUT", "/v1/studio/drafts/:id", "admitted"],
  ["POST", "/v1/studio/drafts/:id/publish", "admitted"],
];

export function CompatibilityView({ mode, onModeChange, liveClient }: CompatibilityViewProps): JSX.Element {
  const [token, setToken] = useState("");
  const [actorScope, setActorScope] = useState("profile:studio");
  const [connection, setConnection] = useState<"idle" | "checking" | "connected" | "error">("idle");
  const [message, setMessage] = useState("");

  const checkConnection = async (): Promise<void> => {
    setConnection("checking");
    setMessage("");
    liveClient.setToken(token);
    liveClient.setActorScope(actorScope);
    try {
      const health = await liveClient.health();
      setConnection("connected");
      setMessage(`Owner reports ${health.status}. Token and actor subject remain memory-only for this tab.`);
    } catch (error: unknown) {
      setConnection("error");
      setMessage(error instanceof Error ? error.message : "Owner connection failed.");
    }
  };

  return <section className="view-stack" aria-labelledby="compatibility-title">
    <div className="view-heading"><div><p className="eyebrow">Workspace / Compatibility</p><h1 id="compatibility-title">Compatibility & settings</h1><p className="lede">Inspect the admitted contract and choose the active adapter without hiding capability gaps.</p></div><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "fixture mode" : "live mode"}</StatusBadge></div>
    <div className="settings-grid">
      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">Execution source</p><h2>Adapter mode</h2></div><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode}</StatusBadge></div><p className="muted">Fixture mode is explicit and read-only around the owner boundary. Live mode calls same-origin <code>/v1</code> routes and never falls back silently.</p><div className="mode-picker"><button className={mode === "fixture" ? "selected" : ""} onClick={() => onModeChange("fixture")}><strong>Fixture adapter</strong><span>Deterministic catalog and projection evidence.</span></button><button className={mode === "live" ? "selected" : ""} onClick={() => onModeChange("live")}><strong>Live owner API</strong><span>Calls the authenticated loopback management surface.</span></button></div></section>
      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">Session credential</p><h2>Pairing token</h2></div><StatusBadge tone="muted">memory only</StatusBadge></div><label className="field-label">Bearer token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste for this tab only" autoComplete="off" /></label><label className="field-label">Authenticated actor subject<input value={actorScope} onChange={(event) => setActorScope(event.target.value)} placeholder="profile:studio" autoComplete="off" /><span className="field-help">Must match the subject bound to the owner token; it is sent only on control commands.</span></label><div className="control-grid"><button className="button button-secondary" onClick={() => void checkConnection()} disabled={connection === "checking"}>{connection === "checking" ? "Checking…" : "Check owner connection"}</button><button className="button button-quiet" onClick={() => { setToken(""); setActorScope("profile:studio"); liveClient.setToken(undefined); liveClient.setActorScope(undefined); setConnection("idle"); setMessage("Session material cleared from this tab."); }}>Clear session</button></div>{message ? <p className={`connection-message connection-${connection}`}>{message}</p> : null}</section>
    </div>
    <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">Phase 1 admission</p><h2>Owner route matrix</h2></div><span className="muted">source: merged sts2-harness</span></div><div className="route-table" role="table" aria-label="Phase 1 owner routes"><div className="route-row route-header" role="row"><span>Method</span><span>Path</span><span>Studio use</span></div>{admittedRoutes.map(([method, path, state]) => <div className="route-row" role="row" key={`${method}-${path}`}><code>{method}</code><code>{path}</code><StatusBadge tone={state === "admitted" ? "success" : "warning"}>{state}</StatusBadge></div>)}</div></section>
    <Notice tone="warning" title="Native hierarchy status">The available runtime did not expose callable D0→D1→D2→D3 Luna Max child sessions in this environment. The Studio records this as an orchestration limitation and does not claim a fabricated delegation attestation.</Notice>
  </section>;
}
