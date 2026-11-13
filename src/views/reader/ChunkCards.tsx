import type { ReactNode } from "react";
import type { PassageChunk, Token } from "../../lib/types";
import { knownRuns, type ReaderPart } from "./knownRuns";

export function ChunkCards({ chunks, text, tokens, first, last, offset, english, blurEnglish, blur, part }: {
  chunks: PassageChunk[];
  text: string;
  tokens: Token[];
  first: number;
  last: number;
  offset: number;
  english: boolean;
  blurEnglish: boolean;
  blur: boolean;
  part(index: number, text: string): ReaderPart;
}) {
  let index = first;
  const rows: ReactNode[][] = [[]];
  let previousEnd = 0;
  chunks.forEach((chunk, position) => {
    if (position && text.slice(previousEnd, chunk.start).includes("\n")) rows.push([]);
    previousEnd = chunk.end;
    const start = offset + chunk.start;
    const end = offset + chunk.end;
    while (index < last && tokens[index].e <= start) index++;
    const parts: ReaderPart[] = [];
    for (let i = index; i < last && tokens[i].s < end; i++) {
      const token = tokens[i];
      parts.push(part(i, token.t.slice(Math.max(0, start - token.s), end - token.s)));
    }
    rows[rows.length - 1].push(
      <div key={chunk.start} className={`reader-chunk${position % 2 === 0 ? " tinted" : ""}${blurEnglish ? " reveal-english" : ""}`}
        tabIndex={blurEnglish ? 0 : undefined}>
        <div className="reader-chunk-source" dir="auto">{knownRuns(parts, blur)}</div>
        {english && <div className="reader-chunk-english" lang="en" dir="ltr">{chunk.translation}</div>}
      </div>,
    );
  });
  return rows.map((row, i) => <div key={i} className="reader-chunk-row">{row}</div>);
}
