import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { ChineseAnnotation, Token } from "../../lib/types";

type Annotations = Record<string, ChineseAnnotation>;

export function useChineseAnnotations(enabled: boolean, tokens: Token[], start: number, end: number) {
  const words = useMemo(() => enabled
    ? [...new Set(tokens.slice(start, end).filter(token => token.w && /\p{Script=Han}/u.test(token.t)).map(token => token.t))]
    : [], [enabled, tokens, start, end]);
  const [annotations, setAnnotations] = useState<Annotations>({});

  useEffect(() => {
    setAnnotations({});
    if (!words.length) return;
    let active = true;
    let retried = false;
    let unlisten: (() => void) | undefined;
    let request = 0;
    const load = async () => {
      const id = ++request;
      try {
        const entries: Annotations = {};
        for (let i = 0; active && id === request && i < words.length; i += 256) {
          const batch = await api().chineseAnnotations(words.slice(i, i + 256));
          if (!batch) return;
          Object.assign(entries, batch);
        }
        if (active && id === request) setAnnotations(entries);
      } catch {
        // The original text remains readable if the offline dictionary is unavailable.
      }
    };
    void api().dictListen(lang => {
      if (active && lang === "zh" && !retried) {
        retried = true;
        void load();
      }
    }).then(stop => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => {}).finally(() => {
      if (active && !request) void load();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [words]);

  return annotations;
}

export function ChineseWord({ text, annotation }: { text: string; annotation?: ChineseAnnotation }) {
  return <>
    {annotation?.pinyin && <span className="zh-study-pinyin" aria-hidden="true">{annotation.pinyin}</span>}
    <span className="zh-study-hanzi">{text}</span>
    {annotation?.gloss && <span className="zh-study-gloss" aria-hidden="true">{annotation.gloss}</span>}
  </>;
}
