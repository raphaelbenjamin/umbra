import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { PassageChunk } from "../../lib/types";

export function useChunkBreakdown(text: string, auto: boolean, scope: number | null) {
  const toast = useApp((s) => s.toast);
  const [saved, setSaved] = useState<{ text: string; chunks: PassageChunk[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; running: boolean; error?: string } | null>(null);
  const [failure, setFailure] = useState<string>();
  const [stoppedPage, setStoppedPage] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, [scope]);

  useEffect(() => {
    if (!text.trim()) return;
    let stale = false;
    void api().chunkBreakdown(text, true).then((chunks) => {
      if (!stale && chunks) setSaved((previous) => previous?.text === text ? previous : { text, chunks });
    }).catch(() => {});
    return () => { stale = true; };
  }, [text, progress?.done]);

  const chunks = saved?.text === text ? saved.chunks : undefined;
  const prepare = useCallback(async (pages: string[], quiet = false) => {
    if (active.current || !pages.length) return;
    const batch = new AbortController();
    active.current = batch;
    const total = pages.length;
    let done = 0;
    let error: string | undefined;
    setProgress({ done, total, running: true });
    setFailure(undefined);
    setStoppedPage(undefined);
    try {
      for (const page of pages) {
        if (batch.signal.aborted) break;
        const result = await api().chunkBreakdown(page, false);
        if (batch.signal.aborted) break;
        if (page === text && result) setSaved({ text, chunks: result });
        setProgress({ done: ++done, total, running: true });
      }
    } catch (cause) {
      if (!batch.signal.aborted) {
        error = errorText(cause);
        setFailure(pages[done]);
        if (!quiet) toast(error, "error");
      }
    } finally {
      if (active.current === batch) {
        active.current = null;
        setProgress({ done, total, running: false, error });
      }
    }
  }, [text, toast]);

  useEffect(() => {
    setProgress(null);
    setFailure(undefined);
    setStoppedPage(undefined);
  }, [scope]);

  const error = failure === text ? progress?.error : undefined;
  const pending = progress?.running ?? false;
  useEffect(() => {
    if (!auto || !text.trim() || chunks || pending || error || stoppedPage === text) return;
    const timer = window.setTimeout(() => void prepare([text], true), 450);
    return () => window.clearTimeout(timer);
  }, [auto, chunks, pending, error, stoppedPage, text, prepare]);

  return {
    chunks, pending, progress, error, prepare,
    stopped: stoppedPage === text,
    stop: () => {
      active.current?.abort();
      setStoppedPage(text);
    },
  };
}
