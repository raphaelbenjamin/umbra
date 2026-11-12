import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../lib/i18n";

type Job = {
  progress: { done: number; total: number; running: boolean; stopping?: boolean } | null;
  start: () => void;
  stop: () => void;
};

export function PagePreloadMenu({ translations, explanations, eligible, savedCount }: {
  translations: Omit<Job, "start"> & { enabled: boolean; start: (count: number) => void };
  explanations?: Job;
  eligible: boolean;
  savedCount: string;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(savedCount);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const running = !!(translations.progress?.running || explanations?.progress?.running);
  const label = t("Précharger", "Preload");
  const validCount = /^\d+$/.test(count) && Number.isSafeInteger(Number(count));
  const progress = translations.progress;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div ref={anchor} className="look-anchor no-drag" data-page-ai={open ? "" : undefined}>
      <button ref={trigger} type="button" className={`icon-btn look-btn ${open || translations.enabled ? "on" : ""}`}
        onKeyDown={(event) => { if (event.key === " ") event.stopPropagation(); }}
        aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}
      >
        <Icon name="layers" size={17} />
        {running && <span className="page-ai-busy" aria-hidden="true" />}
      </button>
      {open && (
        <div className="look-pop page-ai-pop" role="group" aria-label={label}>
          <form className="page-ai-translations" onSubmit={(event) => {
            event.preventDefault();
            if (translations.enabled) translations.stop();
            else if (validCount && !running) {
              translations.start(Number(count));
              setOpen(false);
              trigger.current?.focus();
            }
          }}>
            <label className="page-ai-count">
              {t("Pages d’avance", "Pages ahead")}
              <input type="number" min="0" step="1" required value={count}
                disabled={translations.enabled} onChange={(event) => setCount(event.target.value)} />
            </label>
            <p>{t("Inclut la page actuelle et suit votre lecture.", "Includes the current page and follows you as you read.")}</p>
            <button type="submit" className="page-ai-action"
              disabled={!translations.enabled && (!validCount || running)}>
              <Icon name="layers" size={15} />
              <span>{translations.enabled ? t("Arrêter le préchargement", "Stop preloading") : t("Précharger les traductions", "Preload translations")}</span>
              {(progress?.running || translations.enabled) && (
                <small>
                  {progress?.stopping ? t("Arrêt…", "Stopping…")
                    : progress?.running ? `${progress.done}/${progress.total}`
                    : t("À jour", "Caught up")}
                </small>
              )}
            </button>
          </form>
          {explanations && (
            <button type="button" className="page-ai-action"
              disabled={explanations.progress?.stopping || (!explanations.progress?.running && (!eligible || running))}
              onClick={explanations.progress?.running ? explanations.stop : explanations.start}
            >
              <Icon name="bulb" size={15} />
              <span>{explanations.progress?.running ? t("Arrêter les explications", "Stop explanations") : t("Précharger les explications", "Preload explanations")}</span>
              {explanations.progress && <small>{explanations.progress.done}/{explanations.progress.total}</small>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
