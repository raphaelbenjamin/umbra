import { useEffect, useId, useRef, useState } from "react";
import { formatNumber, t } from "../lib/i18n";
import { stageText, useImports } from "../lib/imports";
import { Icon } from "./Icon";

export function ImportQueueCard() {
  const jobs = useImports((s) => s.jobs);
  const retry = useImports((s) => s.retry);
  const dismiss = useImports((s) => s.dismiss);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const visible = jobs.filter((job) => job.status !== "done");
  const hasErrors = visible.some((job) => job.status === "error");
  const label = t("File d’import", "Import queue");

  useEffect(() => {
    if (!visible.length) setOpen(false);
  }, [visible.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (e: PointerEvent) => {
      if (e.target instanceof Node && !anchor.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (!visible.length) return null;
  return (
    <div ref={anchor} className="import-queue" onKeyDown={(e) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    }}>
      <button
        ref={button}
        type="button"
        className={`import-queue-toggle ${hasErrors ? "has-errors" : ""}`}
        aria-label={`${label} (${formatNumber(visible.length)})`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <Icon name="download" size={16} />
        <span className="num">{formatNumber(visible.length)}</span>
      </button>
      {open && (
        <section id={panelId} className="import-queue-panel" aria-label={label}>
          <header><strong>{label}</strong></header>
          <ul>
            {visible.map(({ spec, status, stage, progress, error }) => (
              <li key={spec.key}>
                <strong dir="auto">{spec.title}</strong>
                <span className={status === "error" ? "import-queue-error" : "muted"}>
                  {status === "error"
                    ? error
                    : status === "model"
                      ? t("En attente du modèle de transcription", "Waiting for the transcription model")
                      : `${stageText(stage)}${progress === null ? "" : ` · ${Math.round(progress)}%`}`}
                </span>
                {status === "running" && (
                  <div className={`bar live ${progress === null ? "indeterminate" : ""}`} aria-hidden="true">
                    <i style={{ width: `${progress ?? 30}%` }} />
                  </div>
                )}
                {status === "error" && (
                  <div className="import-queue-actions">
                    <button className="btn sm soft" onClick={() => retry(spec.key)}>{t("Réessayer", "Retry")}</button>
                    <button className="btn sm ghost" onClick={() => dismiss(spec.key)}>{t("Retirer", "Dismiss")}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
