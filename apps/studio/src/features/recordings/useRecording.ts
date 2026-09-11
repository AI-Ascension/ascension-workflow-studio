import { useEffect, useRef, useState } from "react";
import type { ImportDiagnostic, RecordingInspection } from "../../../../../packages/recording/src/model";
import { limits } from "../../../../../packages/recording/src/primitives";
import { catalogEntries, catalogUrl, type RecordingCatalogEntry } from "./catalog";

export function useRecording() {
  const worker = useRef<Worker | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingInspection>();
  const [pending, setPending] = useState<RecordingInspection>();
  const [diagnostic, setDiagnostic] = useState<ImportDiagnostic>();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string>();
  const [catalog, setCatalog] = useState<RecordingCatalogEntry[]>([]);
  const [catalogMessage, setCatalogMessage] = useState<string>();
  const cancel = () => { worker.current?.terminate(); worker.current = undefined; setImporting(false); };
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    let current = true;
    void fetch("/recordings/index.json", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("The shared recording catalog is unavailable.");
        return catalogEntries(await response.json());
      })
      .then(entries => { if (current) setCatalog(entries); })
      .catch(() => { if (current) setCatalogMessage("The shared recording catalog is unavailable. You can still choose a local bundle."); });
    return () => { current = false; };
  }, []);
  const onImport = (file: Blob) => {
    cancel(); setDiagnostic(undefined); setMessage(undefined); setPending(undefined);
    if (file.size > limits.archive) { setDiagnostic({ code: "resource_limit", message: "Archive exceeds the 16 MiB browser limit." }); return; }
    const current = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
    worker.current = current; setImporting(true);
    current.onmessage = (event: MessageEvent<{ recording?: RecordingInspection; diagnostic?: ImportDiagnostic }>) => {
      if (worker.current !== current) return;
      const next = event.data.recording;
      if (next) {
        if (recording && recording.digest !== next.digest) {
          setPending(next); setMessage("A different validated recording or revision is ready. Choose Replace recording to inspect it.");
        } else {
          setMessage(recording ? "This recording is already imported; no records were duplicated." : "Recording validated and imported.");
          setRecording(next);
        }
      } else setDiagnostic(event.data.diagnostic);
      cancel();
    };
    current.onerror = () => { if (worker.current !== current) return; setDiagnostic({ code: "worker_failed", message: "The import worker could not complete validation." }); cancel(); };
    current.postMessage(file);
  };
  const onOpenCatalog = async (entry: RecordingCatalogEntry): Promise<void> => {
    try {
      setCatalogMessage(undefined);
      const response = await fetch(catalogUrl(entry), { cache: "no-store" });
      if (!response.ok) throw new Error("The selected recording is unavailable.");
      const blob = await response.blob();
      if (blob.size > limits.archive) throw new Error("The selected recording exceeds the browser limit.");
      const bytes = await blob.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== entry.bundle_sha256) throw new Error("The selected recording failed its catalog digest check.");
      onImport(new File([bytes], entry.file, { type: "application/zip" }));
    } catch (error) {
      setCatalogMessage(error instanceof Error ? error.message : "The selected recording could not be opened.");
    }
  };
  return { recording, pending, diagnostic, importing, message, catalog, catalogMessage, onImport, onOpenCatalog,
    onReplace: () => { setRecording(pending); setPending(undefined); setMessage("Replaced the selected recording. Evidence was not merged."); },
    onDiscard: () => { setPending(undefined); setMessage("Kept the current recording."); },
    onCancel: () => { cancel(); setMessage("Import cancelled. No new records were admitted."); },
    onClear: () => { cancel(); setRecording(undefined); setPending(undefined); setDiagnostic(undefined); setMessage(undefined); },
  };
}
