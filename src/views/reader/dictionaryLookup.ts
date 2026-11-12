import type { DictResult } from "../../lib/types";

/** Follow a dictionary download only while the lookup's selection is still open. */
export function loadReaderDictionary(
  lang: string,
  lookup: () => Promise<DictResult>,
  listen: (onChange: (lang: string) => void) => Promise<() => void>,
  onResult: (result: DictResult) => void,
): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  let retried = false;
  void lookup().then(async (result) => {
    if (!active) return;
    onResult(result);
    if (!result.pending) return;
    const stop = await listen((changed) => {
      if (!active || changed !== lang || retried) return;
      retried = true;
      void lookup().then((ready) => {
        // The notification also fires when the download fails.
        if (active) onResult({ ...ready, pending: false });
      }).catch(() => {});
    });
    if (active) unlisten = stop;
    else stop();
  }).catch(() => {});
  return () => {
    active = false;
    unlisten?.();
  };
}
