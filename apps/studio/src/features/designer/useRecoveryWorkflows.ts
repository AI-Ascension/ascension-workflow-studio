import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildRecoveryRecord,
  recoverableFor,
  type RecoveryRecord,
  type SemanticDocument,
} from "@studio/document";
import { type LayoutSidecar } from "@studio/contracts";

import { IndexedDbRecoveryStore } from "./recoveryStore";

const RECOVERY_WORKSPACE = "studio";

export interface RecoveryWorkflowsOptions {
  principal: string;
  definitionId: string;
  draftId: string;
  document: SemanticDocument;
  layout: LayoutSidecar;
  rawText: string;
  suspended: boolean;
}

export interface RecoveryWorkflows {
  enabled: boolean;
  toggle: () => void;
  recoverable: RecoveryRecord | undefined;
  principalRecordCount: number;
  notice: string;
  recover: () => RecoveryRecord | undefined;
  exportRecords: () => void;
  clear: () => void;
}

/**
 * Principal-scoped local crash-recovery store and effects. Owns the recovery
 * list, notices and the debounced write, leaving application of a recovered
 * candidate to the caller's commit path.
 */
export function useRecoveryWorkflows({ principal, definitionId, draftId, document, layout, rawText, suspended }: RecoveryWorkflowsOptions): RecoveryWorkflows {
  const store = useRef(new IndexedDbRecoveryStore());
  const [enabled, setEnabled] = useState(false);
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRecords(await store.current.list());
    } catch (error: unknown) {
      setRecords([]);
      setNotice(error instanceof Error ? error.message : "Local recovery storage is unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, principal]);

  useEffect(() => {
    if (suspended || !enabled) return;
    const timer = window.setTimeout(() => {
      let record: RecoveryRecord;
      try {
        record = buildRecoveryRecord({ principal, workspace: RECOVERY_WORKSPACE, definitionId, draftId, document, layout, rawText });
      } catch {
        setNotice("Local recovery rejected the candidate; only bounded authoring data is stored.");
        return;
      }
      void store.current.put(record).then((result) => {
        setNotice(result.prunedForQuota ? "Local recovery storage is full; older records were dropped." : "");
        return refresh();
      }).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Local recovery write failed.");
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [enabled, principal, definitionId, draftId, document, layout, rawText, refresh, suspended]);

  const recoverable = useMemo(() => recoverableFor(records, principal, RECOVERY_WORKSPACE, definitionId), [records, principal, definitionId]);
  const principalRecordCount = records.filter((record) => record.principal === principal).length;

  const recover = useCallback((): RecoveryRecord | undefined => recoverable, [recoverable]);

  const exportRecords = useCallback((): void => {
    const raw = JSON.stringify(records, null, 2);
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `studio-recovery-${principal.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [records, principal]);

  const clear = useCallback((): void => {
    void store.current.clear().then(() => {
      setNotice("Local recovery records cleared.");
      return refresh();
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Local recovery clear failed.");
    });
  }, [refresh]);

  return { enabled, toggle: () => setEnabled((current) => !current), recoverable, principalRecordCount, notice, recover, exportRecords, clear };
}
