import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../lib/store";
import type { PassageChunk } from "../../lib/types";

export function useChunkBreakdown(text: string) {
  const toast = useApp((s) => s.toast);
  const [result, setResult] = useState<{ text: string; chunks: PassageChunk[] } | null>(null);
  const [pending, setPending] = useState(false);
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
  async function prepare() {
    if (active.current || !text.trim()) return;
    if (chunks) {
      toast(t("Le découpage est prêt. Cliquez sur un mot de la page.", "Breakdown ready. Click a word on this page."));
      return;
    }
    active.current = true;
    setPending(true);
    try {
      const prepared = await api().chunkBreakdown(text, false);
      if (prepared && current.current === text) {
        setResult({ text, chunks: prepared });
        toast(t("Le découpage est prêt. Cliquez sur un mot de la page.", "Breakdown ready. Click a word on this page."));
      }
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return { chunks, pending, prepare };
}
