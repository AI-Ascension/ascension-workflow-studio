import { useMemo, useState } from "react";
import type { JsonObject } from "@studio/contracts";
import type { ImportDiagnostic, InspectionRecord, RecordingInspection } from "../../../../../packages/recording/src/model";
import { Notice } from "../../components/Notice";
import type { RecordingCatalogEntry } from "./catalog";

export interface RecordingsProps {
  recording?: RecordingInspection;
  pending?: RecordingInspection;
  diagnostic?: ImportDiagnostic;
  importing: boolean;
  message?: string;
  onImport: (file: Blob) => void;
  catalog: RecordingCatalogEntry[];
  catalogMessage?: string;
  onOpenCatalog: (entry: RecordingCatalogEntry) => Promise<void>;
  onCancel: () => void;
  onClear: () => void;
  onReplace: () => void;
  onDiscard: () => void;
}
export function RecordingsView({ recording, pending, diagnostic, importing, message, catalog, catalogMessage, onImport, onOpenCatalog, onCancel, onClear, onReplace, onDiscard }: RecordingsProps): JSX.Element {
  return <div className="recorded-workspace">
    <div className="page-heading"><div><p className="eyebrow">Imported recording · inspection only</p><h1>Recorded runs</h1><p>Inspect an exported recording locally. Imported evidence grants no execution or recovery capability.</p></div></div>
    <section className="panel-card recording-import" aria-label="Import recording">
      <label className="field-label">Choose recorded-run bundle<input type="file" accept=".zip,application/zip,application/vnd.ai-ascension.recorded-run+zip" disabled={importing} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file) onImport(file);
      }} /></label>
      <p>Up to 16 MiB ZIP, 32 MiB extracted and 25,000 records. All entries are validated before inspection. Files stay in this tab.</p>
      <div className="control-grid">{importing ? <button className="button button-secondary" onClick={onCancel}>Cancel import</button> : null}{recording ? <button className="button button-quiet" onClick={onClear}>Clear recording</button> : null}</div>
      {importing ? <p role="status">Validating recording…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {pending ? <div className="recording-replacement"><h2>Validated replacement</h2><p className="recording-identity">{pending.bundleIdentity}<br /><code>{pending.digest}</code></p><p>Replacing discards the current in-tab inspection. No evidence or identities are merged.</p><div className="control-grid"><button className="button button-secondary" onClick={onReplace}>Replace recording</button><button className="button button-quiet" onClick={onDiscard}>Keep current recording</button></div></div> : null}
    </section>
    <section className="panel-card recording-catalog" aria-label="Shared recording catalog"><h2>Shared Train recordings</h2><p>Sanitized exports hosted on this private LAN service. Opening one validates its catalog digest before inspection; it grants no execution capability.</p>
      {catalogMessage ? <p role="status">{catalogMessage}</p> : null}
      {catalog.length ? <ul>{catalog.map(entry => <li key={entry.semantic_digest}><div><strong>{entry.id}</strong><span>{entry.event_records} timeline records · {entry.accounting_records} accounting record{entry.accounting_records === 1 ? "" : "s"}</span><code>{entry.semantic_digest}</code></div><button className="button button-secondary" disabled={importing} onClick={() => void onOpenCatalog(entry)}>Open inspection</button></li>)}</ul> : <p>Loading shared recordings…</p>}
    </section>
    {diagnostic ? <Notice tone="danger" title="Recording import failed">{`${diagnostic.code} — ${diagnostic.message}${recording ? " The previous validated recording is still displayed." : " No records were admitted."}`}</Notice> : null}
    {recording ? <RecordingDetails key={recording.digest} recording={recording} /> : <section className="panel-card"><h2>No recording imported</h2><p>Select a portable bundle from the harness exporter. Workflow definition files belong in the designer.</p></section>}
  </div>;
}
function RecordingDetails({ recording }: { recording: RecordingInspection }): JSX.Element {
  return <>
    <section className="panel-card"><p className="eyebrow">Validated integrity · authenticity not established</p><h2>Recording identity</h2><p className="recording-identity">{recording.bundleIdentity}</p><p className="recording-identity">Semantic SHA-256: <code>{recording.digest}</code></p><JsonDetails title="Source identities" value={recording.identities} /><JsonDetails title="Provenance and versions" value={recording.provenance} /></section>
    <section className="panel-card"><h2>Completeness and evidence</h2><p>Process or provider completion does not imply settled actions or completed gameplay. Unknown outcomes remain unknown. Episode failure is not an authoritative game defeat.</p><dl className="recording-evidence">{Object.entries(recording.evidence).map(([name, value]) => <div key={name}><dt>{name.replaceAll("_", " ")}</dt><dd>{String(value).replaceAll("_", " ")}</dd></div>)}</dl><JsonDetails title="Recording evidence" value={recording.evidence} /><JsonDetails title="Stream completeness" value={recording.completeness} /><JsonDetails title="Omissions and source count reconciliation" value={recording.omissions} /></section>
    {recording.diagnostics.length ? <Notice tone="warning" title="Compatibility diagnostics">{recording.diagnostics.join(" · ")}</Notice> : null}
    <RecordList title="Recorded timeline" records={recording.records} />
    <RecordList title="Provider accounting" records={recording.accounting} accounting />
  </>;
}
export function RecordList({ title, records, accounting = false }: { title: string; records: InspectionRecord[]; accounting?: boolean }): JSX.Element {
  const [page, setPage] = useState(0);
  const [stream, setStream] = useState("");
  const [selected, setSelected] = useState<string>();
  const streams = useMemo(() => [...new Set(records.map(record => record.stream))].sort(), [records]);
  const filtered = useMemo(() => stream ? records.filter(record => record.stream === stream) : records, [records, stream]);
  const pages = Math.max(1, Math.ceil(filtered.length / 100));
  const visible = filtered.slice(page * 100, (page + 1) * 100);
  return <section className="panel-card recording-list" aria-label={title}>
    <h2>{title}</h2>
    <p>{accounting ? "Usage is shown with its reported status. Missing usage is not zero; event and turn counts are not token measurements. Model-execution identities remain in their source namespaces." : "Presentation order: source stream and ordinal. Across streams this does not establish causality. Timestamps are displayed as exact decimal nanoseconds."}</p>
    <label className="field-label">{title} stream<select value={stream} onChange={event => { setStream(event.target.value); setPage(0); setSelected(undefined); }}><option value="">All streams</option>{streams.map(value => <option key={value}>{value}</option>)}</select></label>
    <p>{filtered.length} records · Page {page + 1} of {pages}</p>
    {!records.length ? <p>{accounting ? "No accounting records were supplied. Consult stream completeness for the reason." : "No timeline records were supplied. This is not evidence of success."}</p> : null}
    <ol className="recording-rows">{visible.map(record => <li key={record.key}>
      <button className="recording-row" aria-expanded={selected === record.key} onClick={() => setSelected(selected === record.key ? undefined : record.key)}>
        <strong>{record.kind}{record.unsupported ? " · unsupported profile" : ""}</strong><span>{record.stream} · source ordinal {record.ordinal}{record.sequence !== undefined ? ` · sequence ${record.sequence}` : ""}</span><span>{record.timestamp !== undefined ? `${record.timestamp} ns` : "Timestamp unavailable"}</span><span>{record.kind === "action_outcome" ? `Action outcome: ${String((record.payload.value as JsonObject).status)}` : record.kind === "diagnostic" ? String((record.payload.value as JsonObject).code) : record.kind === "accounting" ? `Provider execution: ${String((record.payload.value as JsonObject).provider_execution_status)}` : ""}</span>
      </button>
      {selected === record.key ? <div className="recording-detail">{accounting ? <Usage value={record.payload.value as JsonObject} /> : null}<Observation record={record} /><JsonDetails title="Identities" value={record.identities} /><JsonDetails title="Evidence" value={record.evidence} /><JsonDetails title={record.unsupported ? "Unsupported payload (inert)" : "Admitted payload"} value={record.payload} /></div> : null}
    </li>)}</ol>
    <div className="control-grid"><button className="button button-secondary" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(undefined); }}>Previous {accounting ? "accounting" : "timeline"} page</button><button className="button button-secondary" disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); setSelected(undefined); }}>Next {accounting ? "accounting" : "timeline"} page</button></div>
  </section>;
}
function JsonDetails({ title, value }: { title: string; value: JsonObject }): JSX.Element {
  const text = JSON.stringify(value, null, 2);
  return <details className="recording-json"><summary>{title}</summary><pre>{text.slice(0, 16_384)}</pre>{text.length > 16_384 ? <p>Preview capped at 16,384 characters. The complete validated data remains in the import.</p> : null}</details>;
}
function Usage({ value }: { value: JsonObject }): JSX.Element {
  const usage = value.usage as JsonObject;
  return <div><p>{String(value.provider ?? "Provider not supplied")} · {String(value.model ?? "Model not supplied")}</p><table className="recording-usage"><caption>Token usage per model execution</caption><thead><tr><th>Metric</th><th>Value</th><th>Evidence status</th></tr></thead><tbody>{["input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens"].map(name => {
    const metric = usage[name] as JsonObject | undefined;
    return <tr key={name}><th scope="row">{name.replaceAll("_", " ")}</th><td>{metric?.value === null || metric?.value === undefined ? "Not supplied" : String(metric.value)}</td><td>{String(metric?.value_status ?? "not supplied")}</td></tr>;
  })}</tbody></table><JsonDetails title="Event, turn and byte counts (not token usage)" value={value.counts as JsonObject} /></div>;
}
function Observation({ record }: { record: InspectionRecord }): JSX.Element | null {
  const value = record.payload.value as JsonObject;
  const observation = record.kind === "observation_summary" ? value : value.observation as JsonObject | undefined;
  if (!observation || record.unsupported) return null;
  const player = observation.player as JsonObject | undefined;
  return <div><h3>Observed player counters</h3><p>Source observation summary, generation {String(observation.generation)}. No action settlement is inferred.</p><dl className="recording-evidence">{[["HP", player?.hp], ["Maximum HP", player?.max_hp], ["Energy", player?.energy], ["Gold", player?.gold], ["Legal action count", observation.legal_action_count]].map(([name, count]) => <div key={String(name)}><dt>{String(name)}</dt><dd>{count === undefined ? "Not supplied" : String(count)}</dd></div>)}</dl></div>;
}
