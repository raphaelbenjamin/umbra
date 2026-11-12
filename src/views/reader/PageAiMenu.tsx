import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../lib/i18n";

type Job = {
  progress: { done: number; total: number; running: boolean; stopping?: boolean } | null;
  start: () => void;
  stop: () => void;
};

export function PageAiMenu({ translations, explanations, eligible, onSimplify }: {
  translations: Job;
  explanations?: Job;
  eligible: boolean;
  onSimplify: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const running = !!(translations.progress?.running || explanations?.progress?.running);
  const label = t("Outils IA", "AI tools");

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

  const preload = (job: Job, name: string, icon: "sparkle" | "bulb") => {
    const progress = job.progress;
    return (
      <button type="button" className="page-ai-action"
        disabled={progress?.stopping || (!progress?.running && (!eligible || running))}
        onClick={progress?.running ? job.stop : job.start}
      >
        <Icon name={icon} size={15} />
        <span>{name}</span>
        {progress && (
          <small aria-live="polite">
            {progress.stopping ? t("Arrêt…", "Stopping…")
              : progress.running ? t(`Arrêter · ${progress.done}/${progress.total}`, `Stop · ${progress.done}/${progress.total}`)
              : `${progress.done}/${progress.total}`}
          </small>
        )}
      </button>
    );
  };

  return (
    <div ref={anchor} className="look-anchor no-drag" data-page-ai>
      <button ref={trigger} type="button" className={`icon-btn look-btn ${open ? "on" : ""}`}
        aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}
      >
        <Icon name="sparkle" size={17} />
        {running && <span className="page-ai-busy" aria-hidden="true" />}
      </button>
      {open && (
        <div className="look-pop page-ai-pop" role="group" aria-label={label}>
          {preload(translations, t("Précharger les traductions", "Preload translations"), "sparkle")}
          {explanations && preload(explanations, t("Précharger les explications", "Preload explanations"), "bulb")}
          <button type="button" className="page-ai-action page-ai-simplify" onClick={() => { setOpen(false); onSimplify(); }}>
            <Icon name="sparkle" size={15} />
            <span>{t("Simplifier le texte", "Simplify text")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
