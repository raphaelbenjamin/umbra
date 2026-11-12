import { useLayoutEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { useApp } from "../../lib/store";
import { sentenceBounds } from "../../lib/tokenize";
import type { Explanation, LangCode, Term, Token } from "../../lib/types";

export function explanationKey(selection: string, sentence: string) {
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
  const key = JSON.stringify([lang, explanationKey(selection, sentence), settings.online_explain_engine,
    settings.online_model_chatgpt_explain, settings.online_model_chatgpt, settings.llm_model, settings.ui_lang]);
  const current = pending.get(key);
  if (current) return current;
  const request = api().explainSelection(lang, selection, sentence).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function usePageExplanations(pageKey: string) {
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; running: boolean; stopping?: boolean } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Explanation>>({});
  const toast = useApp((s) => s.toast);

  useLayoutEffect(() => {
    setProgress(null);
    setAnswers({});
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [pageKey]);

  function stop() {
    active.current?.abort();
    setProgress((previous) => previous && { ...previous, stopping: true });
  }

  async function prepare(text: string, tokens: Token[], start: number, end: number, terms: Record<string, Term>) {
    if (active.current) return;
    const targets = new Map<string, { selection: string; sentence: string }>();
    for (let index = start; index < end; index++) {
      const token = tokens[index];
      if (!token?.w || (terms[token.k]?.status ?? 0) >= 4) continue;
      const selection = text.slice(token.s, token.e).replace(/\s+/g, " ");
      const { sentence } = selectionContext(text, tokens, index, index);
      targets.set(explanationKey(selection, sentence), { selection, sentence });
    }
    if (!targets.size) return;
    const batch = new AbortController();
    active.current = batch;
    let done = 0;
    setProgress({ done, total: targets.size, running: true });
    try {
      for (const [key, { selection, sentence }] of targets) {
        if (batch.signal.aborted) break;
        const answer = await requestExplanation("zh", selection, sentence);
        if (batch.signal.aborted) break;
        done++;
        setAnswers((previous) => ({ ...previous, [key]: answer }));
        setProgress({ done, total: targets.size, running: true });
      }
    } catch (error) {
      if (!batch.signal.aborted) toast(errorText(error), "error");
    } finally {
      if (active.current === batch) {
        active.current = null;
        setProgress({ done, total: targets.size, running: false });
      }
    }
  }

  return { answers, progress, prepare, stop };
}
