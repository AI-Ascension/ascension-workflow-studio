import { useEffect, useRef, useState } from "react";
import type { ImportDiagnostic, RecordingInspection } from "../../../../../packages/recording/src/model";
import { limits } from "../../../../../packages/recording/src/primitives";

export function useRecording() {
  const worker = useRef<Worker | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingInspection>();
  const [pending, setPending] = useState<RecordingInspection>();
  const [diagnostic, setDiagnostic] = useState<ImportDiagnostic>();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string>();
  const cancel = () => { worker.current?.terminate(); worker.current = undefined; setImporting(false); };
  useEffect(() => () => worker.current?.terminate(), []);
  const onImport = (file: File) => {
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
  return { recording, pending, diagnostic, importing, message, onImport,
    onReplace: () => { setRecording(pending); setPending(undefined); setMessage("Replaced the selected recording. Evidence was not merged."); },
    onDiscard: () => { setPending(undefined); setMessage("Kept the current recording."); },
    onCancel: () => { cancel(); setMessage("Import cancelled. No new records were admitted."); },
    onClear: () => { cancel(); setRecording(undefined); setPending(undefined); setDiagnostic(undefined); setMessage(undefined); },
  };
}
