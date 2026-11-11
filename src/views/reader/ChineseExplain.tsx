import { useState } from "react";
import { Icon } from "../../components/Icon";
import { api, errorText, isNoModel } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../lib/store";
import type { ChineseExplanation } from "../../lib/types";

export function ChineseExplain({ selection, sentence }: { selection: string; sentence: string }) {
  const [answer, setAnswer] = useState<ChineseExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsModel, setNeedsModel] = useState(false);
  const openSettings = useApp(s => s.openSettings);

  const explain = async () => {
    setBusy(true);
    setError("");
    setNeedsModel(false);
    try {
      setAnswer(await api().explainChinese(selection, sentence));
    } catch (e) {
      setError(errorText(e));
      setNeedsModel(isNoModel(e));
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
      {error && (
        <div className="wp-note" role="status">
          {error}
          {needsModel && (
            <button className="btn sm soft" onClick={() => openSettings("ai")}>
              {t("Réglages de l’IA", "AI settings")}
            </button>
          )}
        </div>
      )}
      {answer && (
        <div className="wp-explanation" aria-live="polite">
          <p className="wp-explanation-meaning">{answer.meaning}</p>
          {answer.parts.length > 0 && (
            <ul className="wp-explanation-parts">
              {answer.parts.map((part, i) => (
                <li key={i}>
                  <strong lang="zh">{part.hanzi}</strong>
                  <span className="muted">{part.pinyin}</span>
                  <span>{part.english}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="wp-explanation-examples">
            {answer.examples.map((example, i) => (
              <div className="wp-explanation-example" key={i}>
                <strong lang="zh">{example.hanzi}</strong>
                <span className="muted">{example.pinyin}</span>
                <span lang="en">{example.english}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
