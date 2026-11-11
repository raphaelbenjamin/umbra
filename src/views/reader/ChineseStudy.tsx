import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../lib/store";
import { Switch } from "../../components/ui";
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

export function shortChineseGloss(gloss: string): string {
  const meanings = gloss.replace(/\([^)]*\)|\[[^\]]*\]/g, "").split(/[;,]/);
  const words = meanings.map(meaning => meaning.match(/\p{L}[\p{L}\p{M}]*(?:[-'’]\p{L}[\p{L}\p{M}]*)*/gu) ?? []).filter(part => part.length);
  const primary = words[0] ?? [];
  if (primary.length <= 1) return primary[0] ?? "";
  const synonym = words.find(part => part.length === 1);
  if (synonym) return synonym[0];
  return primary.find(word => !/^(?:a|an|the|to|be|of|in|on|at|for|with|and|or)$/i.test(word)) ?? primary[0];
}

export function ChineseStudyOptions({ compact = false }: { compact?: boolean }) {
  const settings = useApp(s => s.settings);
  const setSetting = useApp(s => s.setSetting);
  const enabled = settings.chinese_beginner === "1";
  const options = [
    { key: "chinese_beginner", label: t("Mode débutant chinois", "Chinese beginner mode"), on: enabled },
    ...(enabled ? [
      { key: "chinese_pinyin", label: t("Pinyin", "Pinyin"), on: settings.chinese_pinyin !== "0" },
      { key: "chinese_gloss", label: t("Traduction", "English gloss"), on: settings.chinese_gloss !== "0" },
    ] : []),
  ];
  return options.map(({ key, label, on }) => (
    <div className={compact ? "look-row" : "set-row"} key={key}>
      <span>{label}</span>
      <Switch label={label} on={on} onChange={value => void setSetting(key, value ? "1" : "0")} />
    </div>
  ));
}

export function ChineseWord({ text, pinyin, gloss }: { text: string; pinyin?: string; gloss?: string }) {
  return <>
    {pinyin && <span className="zh-study-pinyin" aria-hidden="true">{pinyin}</span>}
    <span className="zh-study-hanzi">{text}</span>
    {gloss && <span className="zh-study-gloss" aria-hidden="true">{gloss}</span>}
  </>;
}
