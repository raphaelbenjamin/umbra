import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { api, errorText } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../lib/store";
import type { Explanation, LangCode } from "../../lib/types";
import { requestExplanation } from "./pageExplanations";

export function ReaderExplain({ lang, selection, sentence, prepared }: {
  lang: LangCode; selection: string; sentence: string; prepared?: Explanation;
}) {
  const [loaded, setAnswer] = useState<Explanation | null>(null);
  const answer = prepared ?? loaded;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openSettings = useApp(s => s.openSettings);

  useEffect(() => {
    if (lang !== "zh" || prepared) return;
    let active = true;
    void api().cachedExplanation(lang, selection, sentence).then((cached) => {
      if (active && cached) setAnswer(cached);
    }).catch(() => {});
    return () => { active = false; };
  }, [lang, selection, sentence, prepared]);

  const explain = async () => {
    setBusy(true);
    setError("");
    try {
      setAnswer(await requestExplanation(lang, selection, sentence));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wp-block" aria-label={t("Explication", "Explanation")}>
      {!answer && (
        <button className="btn sm soft wp-explain-button" disabled={busy} onClick={() => void explain()}>
          <Icon name="bulb" size={15} />
          {busy ? t("Explication…", "Explaining…") : t("Expliquer", "Explain")}
        </button>
      )}
      {error && !answer && (
        <div className="wp-note" role="status">
          {error}
          <button className="btn sm soft" onClick={() => openSettings("ai")}>
            {t("Réglages de l’IA", "AI settings")}
          </button>
        </div>
      )}
      {answer && (
        <div className="wp-explanation" aria-live="polite">
          <p className="wp-explanation-meaning">{answer.meaning}</p>
          {answer.parts.length > 0 && (
            <ul className="wp-explanation-parts">
              {answer.parts.map((part, i) => (
                <li key={i}>
                  <strong lang={lang} dir="auto">{part.text}</strong>
                  {part.reading && <span className="muted">{part.reading}</span>}
                  <span>{part.translation}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="wp-explanation-examples">
            {answer.examples.map((example, i) => (
              <div className="wp-explanation-example" key={i}>
                <strong lang={lang} dir="auto">{example.text}</strong>
                {example.reading && <span className="muted">{example.reading}</span>}
                <span>{example.translation}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
