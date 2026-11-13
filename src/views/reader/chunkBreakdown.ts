import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../lib/store";
import type { PassageChunk } from "../../lib/types";

export function useChunkBreakdown(text: string, auto: boolean) {
  const toast = useApp((s) => s.toast);
  const [result, setResult] = useState<{ text: string; chunks: PassageChunk[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
  const active = useRef(false);
  const current = useRef(text);
  useEffect(() => {
    current.current = text;
    if (!text.trim()) return;
    let stale = false;
    void api().chunkBreakdown(text, true).then((chunks) => {
      if (!stale && chunks) setResult({ text, chunks });
    }).catch(() => {});
    return () => { stale = true; };
  }, [text]);

  const chunks = result?.text === text ? result.chunks : undefined;
  const prepare = useCallback(async (quiet = false) => {
    if (active.current || !text.trim()) return;
    if (chunks) {
      if (!quiet) toast(t("Le découpage est prêt. Cliquez sur un mot de la page.", "Breakdown ready. Click a word on this page."));
      return;
    }
    active.current = true;
    setFailure(null);
    setPending(true);
    try {
      const prepared = await api().chunkBreakdown(text, false);
      if (prepared && current.current === text) {
        setResult({ text, chunks: prepared });
        if (!quiet) toast(t("Le découpage est prêt. Cliquez sur un mot de la page.", "Breakdown ready. Click a word on this page."));
      }
    } catch (error) {
      const message = errorText(error);
      if (current.current === text) setFailure({ text, message });
      if (!quiet) toast(message, "error");
    } finally {
      active.current = false;
      setPending(false);
    }
  }, [chunks, text, toast]);
  const error = failure?.text === text ? failure.message : undefined;
  useEffect(() => {
    if (!auto || !text.trim() || chunks || pending || error) return;
    const timer = window.setTimeout(() => void prepare(true), 450);
    return () => window.clearTimeout(timer);
  }, [auto, chunks, pending, error, text, prepare]);
  return { chunks, pending, error, prepare };
}
