import type { ReactNode } from "react";

export interface ReaderPart {
  node: ReactNode;
  known?: boolean;
  space?: boolean;
}

/** Also catches numbers that a tokenizer returns as words. */
export function blurLiteral(text: string): boolean {
  return /^[\p{N}\p{P}\p{S}\s]+$/u.test(text) && /\S/u.test(text);
}

/** A single blur across adjacent known words, with normal inline wrapping. */
export function knownRuns(parts: ReaderPart[], blur: boolean): ReactNode[] {
  if (!blur) return parts.map(({ node }) => node);
  const result: ReactNode[] = [];
  let run: ReactNode[] = [];
  let start = 0;
  const flush = () => {
    if (!run.length) return;
    result.push(<span key={`known-${start}`} className="known-run">{run}</span>);
    run = [];
  };
  parts.forEach(({ node, known, space }, index) => {
    if (known || (space && run.length)) {
      if (!run.length) start = index;
      run.push(node);
    } else {
      flush();
      result.push(node);
    }
  });
  flush();
  return result;
}
