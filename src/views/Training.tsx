import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Segmented, Switch } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t } from "../lib/i18n";
import { useApp } from "../lib/store";
import { needsTraining, readTrainingDeck, type Difficulty, type TrainingCard, type TrainingTask } from "../lib/training";
import type { LangCode, Term } from "../lib/types";
import "../styles/training.css";

type RecallFilter = "all" | "missed" | "correct" | "new";

export function Training() {
  const lang = useApp((s) => s.lang)();
  return <TrainingDeckView key={lang} lang={lang} />;
}

function TrainingDeckView({ lang }: { lang: LangCode }) {
  const key = `training_deck_${lang}`;
  const saved = useApp((s) => s.settings[key]);
  const setSetting = useApp((s) => s.setSetting);
  const toast = useApp((s) => s.toast);
  const deck = useMemo(() => readTrainingDeck(saved), [saved]);
  const [words, setWords] = useState<Term[]>();
  const [difficulty, setDifficulty] = useState<Difficulty | "all">("all");
  const [filter, setFilter] = useState<RecallFilter>("all");
  const [shuffle, setShuffle] = useState(false);
  const [drill, setDrill] = useState<Term[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState<{ task: TrainingTask; done: number; total: number }>();
  const job = useRef<AbortController | null>(null);
  const grading = useRef(false);
  useEffect(() => {
    let stale = false;
    void api().termsList({ lang, filter: "learning", limit: -1, offset: 0 }).then(({ items }) => {
      if (!stale) setWords(items);
    }).catch((error) => { if (!stale) toast(errorText(error), "error"); });
    return () => { stale = true; job.current?.abort(); };
  }, [lang, toast]);

  const save = async (updates: [string, TrainingCard][]) => {
    const latest = readTrainingDeck(useApp.getState().settings[key]);
    for (const [term, patch] of updates) latest[term] = { ...latest[term], ...patch };
    await setSetting(key, JSON.stringify(latest));
  };

  const generate = async (task: TrainingTask, targets: Term[]) => {
    if (job.current || !targets.length) return;
    const run = new AbortController();
    job.current = run;
    let done = 0;
    let omitted = 0;
    setBusy({ task, done, total: targets.length });
    try {
      for (let start = 0; start < targets.length && !run.signal.aborted; start += 24) {
        const batch = targets.slice(start, start + 24);
        const answers = await api().trainingGenerate(lang, task, batch.map(({ term, context }) => ({ term, context })));
        if (run.signal.aborted) break;
        const updates: [string, TrainingCard][] = answers.flatMap(({ index, value }) =>
          batch[index] && value ? [[batch[index].term, { [task]: value }]] : []);
        await save(updates);
        omitted += batch.length - updates.length;
        done += updates.length;
        setBusy({ task, done, total: targets.length });
      }
      if (omitted && !run.signal.aborted) toast(t(`${omitted} mots restent à préparer. Relancez pour les compléter.`, `${omitted} words still need preparation. Run again to fill them in.`));
    } catch (error) {
      if (!run.signal.aborted) toast(errorText(error), "error");
    } finally {
      job.current = null;
      if (!run.signal.aborted) setBusy(undefined);
    }
  };

  const tiers = [
    { value: "beginner", label: t("Débutant · A1–A2", "Beginner · A1–A2") },
    { value: "intermediate", label: t("Intermédiaire · B1–B2", "Intermediate · B1–B2") },
    { value: "advanced", label: t("Avancé · C1+", "Advanced · C1+") },
  ] as const;
  const eligible = (words ?? []).filter(({ term }) => difficulty === "all" || deck[term]?.difficulty === difficulty);
  const matches = eligible.filter(({ term }) => {
    const recalled = deck[term]?.recalled;
    return filter === "all" || (filter === "new" && recalled === undefined) ||
      (filter === "missed" && recalled === false) || (filter === "correct" && recalled === true);
  });
  const practice = matches.filter(({ term, translation }) => deck[term]?.definition || translation);
  const card = drill?.[position];
  const grade = async (correct: boolean) => {
    if (!card || grading.current) return;
    grading.current = true;
    try {
      await save([[card.term, { recalled: correct }]]);
      setRevealed(false);
      setPosition((n) => n + 1);
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      grading.current = false;
    }
  };
  useEffect(() => {
    if (!card) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
          (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]"))) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        void grade(event.key === "ArrowRight");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const start = () => {
    const cards = [...practice];
    if (shuffle) {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    setPosition(0);
    setRevealed(false);
    setDrill(cards);
  };
  const actions: { task: TrainingTask; label: string; targets: Term[] }[] = [
    { task: "difficulty", label: t("Classer les nouveaux mots", "Sort new words"), targets: needsTraining(words ?? [], deck, "difficulty") },
    { task: "definition", label: t("Créer les définitions", "Generate definitions"), targets: needsTraining(eligible, deck, "definition") },
    { task: "example", label: t("Créer les exemples", "Generate examples"), targets: needsTraining(eligible, deck, "example") },
  ];

  return (
    <div className="view training-view">
      <header><h1>{t("Entraînement", "Training")}</h1></header>
      {drill ? (
        <section className="training-drill">
          <div className="training-toolbar">
            <button className="btn ghost" onClick={() => setDrill(null)}>{t("Retour aux mots", "Back to words")}</button>
            <span className="muted">{Math.min(position + 1, drill.length)} / {drill.length}</span>
          </div>
          {card ? (
            <>
              <button type="button" key={card.term} className={`training-flashcard${revealed ? " revealed" : ""}`}
                aria-expanded={revealed} onClick={() => setRevealed((v) => !v)}>
                <strong lang={lang} dir="auto">{card.term}</strong>
                <span className="training-answer">
                  <span lang="en">{deck[card.term]?.definition || card.translation}</span>
                  {deck[card.term]?.example && <small lang={lang} dir="auto">{deck[card.term].example}</small>}
                </span>
              </button>
              <div className="training-toolbar">
                <button className="btn soft" onClick={() => void grade(false)}>← {t("Je ne savais pas", "Didn’t know")}</button>
                <button className="btn primary" onClick={() => void grade(true)}>{t("Je savais", "Knew it")} →</button>
              </div>
            </>
          ) : <p role="status">{t("Entraînement terminé.", "Drill complete.")}</p>}
        </section>
      ) : (
        <>
          <div className="training-toolbar">
            {actions.map(({ task, label, targets }) => (
              <button key={task} className="btn soft" disabled={!!busy || !targets.length} onClick={() => void generate(task, targets)}>
                {label} · {targets.length}
              </button>
            ))}
            {busy && <span className="muted" role="status">ChatGPT · {actions.find(({ task }) => task === busy.task)?.label} · {busy.done}/{busy.total}</span>}
          </div>
          <Segmented id="training-difficulty" label={t("Difficulté", "Difficulty")} value={difficulty}
            onChange={(v) => { setDifficulty(v); setLimit(100); }}
            options={[{ value: "all", label: t("Toutes", "All levels") }, ...tiers]} />
          <div className="training-toolbar">
            <Segmented id="training-recall" label={t("Dernier résultat", "Last result")} value={filter}
              onChange={(v) => { setFilter(v); setLimit(100); }}
              options={[
                { value: "all", label: t("Tous", "All words") },
                { value: "new", label: t("À découvrir", "Unreviewed") },
                { value: "missed", label: t("Ratés", "Missed") },
                { value: "correct", label: t("Réussis", "Correct") },
              ]} />
            <div className="training-shuffle">
              <span>{t("Mélanger", "Shuffle")}</span>
              <Switch label={t("Mélanger", "Shuffle")} on={shuffle} onChange={setShuffle} />
            </div>
            <button className="btn primary" disabled={!practice.length} onClick={start}>{t("S’entraîner", "Start drill")} · {practice.length}</button>
          </div>
          {matches.length > practice.length && <p className="muted">{t("Les mots sans définition attendent dans la liste. Créez leurs définitions pour les ajouter à l’exercice.", "Words without a definition stay in the list. Generate definitions to include them in the drill.")}</p>}
          <div className="training-list">
            {[...tiers, { value: "unsorted", label: t("Non classés", "Unsorted") }].map(({ value, label }) => {
              const group = matches.filter(({ term }) => (deck[term]?.difficulty ?? "unsorted") === value);
              if (!group.length) return null;
              group.sort((a, b) => Number(deck[a.term]?.recalled === true) - Number(deck[b.term]?.recalled === true));
              return <section key={value}>
                <h2>{label} <small>{group.length}</small></h2>
                {group.slice(0, limit).map(({ term, translation }) => {
                  const entry = deck[term];
                  return <motion.div layout="position" key={term} className="training-row">
                    <button type="button" className="training-check" aria-label={term} aria-pressed={entry?.recalled === true}
                      onClick={() => void save([[term, { recalled: entry?.recalled !== true }]]).catch((error) => toast(errorText(error), "error"))}>
                      {entry?.recalled && <Icon name="check" size={15} />}
                    </button>
                    <div><strong lang={lang} dir="auto">{term}</strong>
                      {(entry?.definition || translation) && <span>{entry?.definition || translation}</span>}
                      {entry?.example && <small lang={lang} dir="auto">{entry.example}</small>}
                    </div>
                  </motion.div>;
                })}
                {group.length > limit && <button className="btn ghost" onClick={() => setLimit((n) => n + 100)}>{t("Voir plus", "Show more")}</button>}
              </section>;
            })}
            {words && !matches.length && <p className="muted">{t("Aucun mot dans cette sélection.", "No words match this selection.")}</p>}
          </div>
        </>
      )}
    </div>
  );
}
