import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { onlineState } from "../../lib/online";
import { useApp } from "../../lib/store";
import { sentenceBounds } from "../../lib/tokenize";
import type { Explanation, LangCode, Term, Token, WordAnswer } from "../../lib/types";

export function pageWordKey(selection: string, sentence: string) {
  return JSON.stringify([selection.trim(), sentence]);
}

export function selectionContext(text: string, tokens: Token[], first: number, last: number) {
  const [start, end] = sentenceBounds(tokens, first);
  const sentenceStart = tokens[start]?.s ?? 0;
  const sentenceEnd = tokens[Math.max(end, sentenceBounds(tokens, last)[1]) - 1]?.e ?? 0;
  return { sentenceStart, sentenceEnd, sentence: text.slice(sentenceStart, sentenceEnd).replace(/\s+/g, " ").trim() };
}

const pending = new Map<string, Promise<Explanation>>();

export function requestExplanation(lang: LangCode, selection: string, sentence: string) {
  const settings = useApp.getState().settings;
  const key = JSON.stringify([lang, pageWordKey(selection, sentence), settings.online_explain_engine,
    settings.online_model_chatgpt_explain, settings.online_model_chatgpt, settings.llm_model, settings.ui_lang]);
  const current = pending.get(key);
  if (current) return current;
  const request = api().explainSelection(lang, selection, sentence).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function translationSettingsKey(settings: Record<string, string>) {
  const online = onlineState(settings);
  return JSON.stringify([settings.ui_lang, settings.llm_model, online.words, online.provider.id, online.model, online.ready]);
}

const pendingTranslations = new Map<string, Promise<WordAnswer>>();
function translationKey(lang: LangCode, word: string, sentence: string) {
  return JSON.stringify([lang, pageWordKey(word, sentence), translationSettingsKey(useApp.getState().settings)]);
}

export function pendingTranslation(lang: LangCode, word: string, sentence: string) {
  return pendingTranslations.get(translationKey(lang, word, sentence));
}

export function requestWordPreload(lang: LangCode, word: string, sentence: string) {
  const key = translationKey(lang, word, sentence);
  const current = pendingTranslations.get(key);
  if (current) return current;
  const request = api().aiWord(lang, word, sentence, () => {}, true).finally(() => pendingTranslations.delete(key));
  pendingTranslations.set(key, request);
  return request;
}

export function usePagePreload<T>(scopeKey: string, load: (lang: LangCode, selection: string, sentence: string) => Promise<T>) {
  const active = useRef<AbortController | null>(null);
  const cached = useRef(new Set<string>());
  const [progress, setProgress] = useState<{ done: number; total: number; running: boolean; stopping?: boolean } | null>(null);
  const [answers, setAnswers] = useState<Record<string, T>>({});
  const toast = useApp((s) => s.toast);

  useLayoutEffect(() => {
    cached.current.clear();
    setProgress(null);
    setAnswers({});
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [scopeKey]);

  function stop() {
    if (!active.current) return;
    active.current?.abort();
    setProgress((previous) => previous && { ...previous, stopping: true });
  }

  const prepare = useCallback(async (lang: LangCode, text: string, tokens: Token[], start: number, end: number, terms: Record<string, Term>) => {
    if (active.current) return;
    const targets = new Map<string, { selection: string; sentence: string }>();
    for (let index = start; index < end; index++) {
      const token = tokens[index];
      if (!token?.w || (terms[token.k]?.status ?? 0) >= 4) continue;
      const selection = text.slice(token.s, token.e).replace(/\s+/g, " ");
      const { sentence } = selectionContext(text, tokens, index, index);
      const key = pageWordKey(selection, sentence);
      if (!cached.current.has(key)) targets.set(key, { selection, sentence });
    }
    if (!targets.size) {
      setProgress(null);
      return true;
    }
    const batch = new AbortController();
    active.current = batch;
    let done = 0;
    setProgress({ done, total: targets.size, running: true });
    try {
      for (const [key, { selection, sentence }] of targets) {
        if (batch.signal.aborted) break;
        const answer = await load(lang, selection, sentence);
        if (batch.signal.aborted) break;
        done++;
        cached.current.add(key);
        setAnswers((previous) => ({ ...previous, [key]: answer }));
        setProgress({ done, total: targets.size, running: true });
      }
      return true;
    } catch (error) {
      if (!batch.signal.aborted) toast(errorText(error), "error");
      return batch.signal.aborted;
    } finally {
      if (active.current === batch) {
        active.current = null;
        setProgress({ done, total: targets.size, running: false });
      }
    }
  }, [load, toast]);

  return { answers, progress, prepare, stop };
}

export function useTranslationLookahead({ scope, lang, text, tokens, terms, pages, page, blocked }: {
  scope: string;
  lang: LangCode;
  text: string | undefined;
  tokens: Token[];
  terms: Record<string, Term>;
  pages: { start: number; end: number }[];
  page: number;
  blocked: boolean;
}) {
  const job = usePagePreload(scope, requestWordPreload);
  const [plan, setPlan] = useState<{ scope: string; count: number } | null>(null);
  const ahead = plan?.scope === scope ? plan.count : null;
  const attempted = useRef<string | null>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    setPlan(null);
    attempted.current = null;
    return () => { generation.current++; };
  }, [scope]);

  const start = pages[page]?.start;
  const end = pages[Math.min(page + (ahead ?? 0), pages.length - 1)]?.end;
  useEffect(() => {
    if (ahead === null || blocked || job.progress?.running || text === undefined ||
        start === undefined || end === undefined || start >= end) return;
    const window = `${start}:${end}`;
    if (attempted.current === window) return;
    attempted.current = window;
    const current = generation.current;
    void job.prepare(lang, text, tokens, start, end, terms).then((ok) => {
      if (ok === false && generation.current === current) setPlan(null);
    });
  }, [ahead, blocked, job.progress?.running, job.prepare, lang, text, tokens, terms, start, end]);

  return {
    answers: job.answers,
    progress: job.progress,
    enabled: ahead !== null,
    start: (count: number) => {
      attempted.current = null;
      setPlan({ scope, count });
    },
    stop: () => {
      generation.current++;
      setPlan(null);
      job.stop();
    },
  };
}
