import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Segmented, Switch } from "../components/ui";
import { api, errorText, isTauri } from "../lib/api";
import { t } from "../lib/i18n";
import { naturalVoiceReady, pronounce, stopPronunciation } from "../lib/pronounce";
import { useApp } from "../lib/store";
import { needsTraining, readTrainingDeck, type Difficulty, type TrainingCard, type TrainingTask } from "../lib/training";
import type { LangCode, Term } from "../lib/types";
import "../styles/training.css";

type RecallFilter = "all" | "unchecked" | "checked";

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
  const [resetting, setResetting] = useState(false);
  const delay = useApp((s) => s.settings.training_reveal_delay || "0");
  const revealPicker = (
    <label className="training-shuffle">
      {t("Révélation automatique", "Auto-reveal")}
      <select className="input" value={delay} onChange={(e) => {
        const value = e.currentTarget.value;
        if (drill) e.currentTarget.blur();
        void setSetting("training_reveal_delay", value).catch((error) => toast(errorText(error), "error"));
      }}>
        <option value="0">{t("Désactivée", "Off")}</option>
        {[1, 2, 3, 5].map((seconds) => <option key={seconds} value={seconds}>{seconds} s</option>)}
      </select>
    </label>
  );
  const audioMode = useApp((s) => s.settings.training_audio_mode || "both");
  const audioModePicker = (
    <label className="training-shuffle">
      {t("Contenu audio", "Audio content")}
      <select className="input" value={audioMode} onChange={(e) => {
        const value = e.currentTarget.value;
        e.currentTarget.blur();
        void setSetting("training_audio_mode", value).catch((error) => toast(errorText(error), "error"));
      }}>
        <option value="word">{t("Mot", "Word")}</option>
        <option value="sentence">{t("Phrase", "Sentence")}</option>
        <option value="both">{t("Les deux", "Both")}</option>
      </select>
    </label>
  );
  const autoplayAudio = useApp((s) => s.settings.training_audio_autoplay === "1");
  const installedVoice = useApp((s) => s.models.some((model) => model.kind === "tts" && model.installed));
  const [azureRegion, setAzureRegion] = useState("");
  const [azureKey, setAzureKey] = useState("");
  const [azureSaved, setAzureSaved] = useState<string | null>(null);
  const [azureSaving, setAzureSaving] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const azureEnabled = useApp((s) => s.settings.training_audio_provider === "azure");
  const configuredVoice = useApp((s) => s.settings[`training_azure_voice_${lang}`]);
  const defaultVoice = ({ he: "he-IL-HilaNeural", de: "de-DE-KatjaNeural", en: "en-US-JennyNeural",
    es: "es-ES-ElviraNeural", it: "it-IT-ElsaNeural", fr: "fr-FR-DeniseNeural",
    zh: "zh-CN-XiaoxiaoNeural", ja: "ja-JP-NanamiNeural" } as Partial<Record<LangCode, string>>)[lang] || "";
  const voice = (configuredVoice ?? defaultVoice).trim();
  const player = useRef<HTMLAudioElement | null>(null);
  const playback = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let here = true;
    void api().azureSpeechConfig().then((region) => {
      if (here) {
        setAzureSaved(region);
        setAzureRegion(region ?? "");
      }
    }).catch((error) => { if (here) toast(errorText(error), "error"); });
    return () => { here = false; };
  }, [toast]);
  const canPrepareAudio = azureEnabled ? !!(azureSaved && voice) : installedVoice && naturalVoiceReady(lang);
  const [audioProgress, setAudioProgress] = useState<{ done: number; total: number }>();
  const preparingAudio = useRef(false);
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
    if (job.current || resetting || !targets.length) return;
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
        const updates: [string, TrainingCard][] = answers.flatMap(({ index, value, literal, note, highlight }) => {
          if (!batch[index] || !value) return [];
          const patch: TrainingCard = { [task]: value };
          if (task === "example") Object.assign(patch, { literal, note, highlight });
          if (task === "definition") patch.concise = true;
          return [[batch[index].term, patch]];
        });
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
    { value: "misc", label: t("Divers", "Misc") },
  ] as const;
  // Previously archived cards rejoin the list if their word is still Learning.
  const activeWords = words ?? [];
  const eligible = activeWords.filter(({ term }) => difficulty === "all" || deck[term]?.difficulty === difficulty);
  const matches = eligible.filter(({ term }) => {
    const recalled = deck[term]?.recalled;
    return filter === "all" || (filter === "checked" ? recalled === true : recalled !== true);
  });
  const practice = matches.filter(({ term, translation }) => deck[term]?.definition?.trim() || translation.trim());
  const card = drill?.[position];
  const entry = card ? deck[card.term] : undefined;
  const example = entry?.example?.trim();
  const audioTexts = (term: string, sentence?: string) =>
    [audioMode !== "sentence" ? term : "", audioMode !== "word" ? sentence?.trim() || "" : ""].filter(Boolean);

  const stopAudio = () => {
    playback.current?.abort();
    player.current?.pause();
    stopPronunciation();
  };

  const playAudio = async (texts: string[], cachedOnly = false) => {
    stopAudio();
    if (!texts.length) return;
    const run = new AbortController();
    playback.current = run;
    if (!azureEnabled && !canPrepareAudio) {
      await pronounce(texts.join(". "), lang);
      return;
    }
    if (azureEnabled && !voice) {
      if (!cachedOnly) toast(t("Choisissez une voix Azure.", "Choose an Azure voice in Audio settings."), "error");
      return;
    }
    try {
      for (const text of texts) {
        if (run.signal.aborted) break;
        const path = azureEnabled
          ? await api().azureSpeechClip(lang, text, voice, cachedOnly)
          : await api().ttsSay(lang, text, false);
        if (run.signal.aborted) break;
        if (!path) continue;
        const audio = new Audio(api().mediaUrl(path));
        player.current = audio;
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            run.signal.removeEventListener("abort", done);
            resolve();
          };
          run.signal.addEventListener("abort", done, { once: true });
          audio.onended = done;
          audio.onerror = () => { reject(new Error(t("Lecture audio impossible.", "Couldn’t play audio."))); done(); };
          void audio.play().catch((error) => { reject(error); done(); });
        });
      }
    } catch (error) {
      if (!run.signal.aborted && !cachedOnly) toast(errorText(error), "error");
    }
  };
  useEffect(() => {
    if (card && autoplayAudio) void playAudio(audioTexts(card.term, example), true);
    return () => { if (card) stopAudio(); };
  }, [card, lang, autoplayAudio, audioMode, example, azureEnabled, voice, canPrepareAudio]);

  const saveAzure = async () => {
    if (azureSaving) return;
    setAzureSaving(true);
    try {
      const region = await api().azureSpeechConfig(azureRegion, azureKey);
      setAzureSaved(region);
      setAzureKey("");
      await setSetting("training_audio_provider", "azure");
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setAzureSaving(false);
    }
  };
  const prepareAudio = async (items: Term[]) => {
    if (preparingAudio.current || !canPrepareAudio) return;
    const texts = [...new Set(items.flatMap(({ term }) => audioTexts(term, deck[term]?.example)))];
    if (!texts.length) {
      toast(t("Créez d’abord des exemples.", "Generate example sentences first."));
      return;
    }
    preparingAudio.current = true;
    setAudioProgress({ done: 0, total: texts.length });
    try {
      for (let i = 0; i < texts.length; i++) {
        if (azureEnabled) await api().azureSpeechClip(lang, texts[i], voice, false);
        else await api().ttsSay(lang, texts[i], false);
        setAudioProgress({ done: i + 1, total: texts.length });
      }
      toast(t("Audio prêt", "Audio ready"));
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      preparingAudio.current = false;
      setAudioProgress(undefined);
    }
  };
  const resetWord = async (term: string) => {
    if (job.current || grading.current) return;
    grading.current = true;
    setResetting(true);
    try {
      await api().termSet({ lang, term, status: 0 });
      setWords((previous) => previous?.filter((word) => word.term !== term));
      if (card?.term === term) {
        setRevealed(false);
        setPosition((n) => n + 1);
      }
      const latest = readTrainingDeck(useApp.getState().settings[key]);
      delete latest[term];
      const app = useApp.getState();
      app.bumpLibrary();
      void app.refreshKnown().catch((error) => toast(errorText(error), "error"));
      await setSetting(key, JSON.stringify(latest));
      toast(t(`« ${term} » est à nouveau nouveau.`, `“${term}” reset to New.`));
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      grading.current = false;
      setResetting(false);
    }
  };
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
  useLayoutEffect(() => {
    if (!card) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
          (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]"))) return;
      if (event.key.toLowerCase() === "q" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void resetWord(card.term);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setRevealed(true);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void grade(event.key === "ArrowRight");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    const seconds = Number(delay);
    if (!card || revealed || ![1, 2, 3, 5].includes(seconds)) return;
    const timer = window.setTimeout(() => setRevealed(true), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [card, position, delay, revealed]);

  const start = () => {
    const cards = [...practice];
    if (shuffle) {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    setRevealed(false);
    setPosition(0);
    setDrill(cards);
  };
  const unsorted = needsTraining(activeWords, deck, "difficulty");
  const labels = {
    difficulty: t("Classer les nouveaux mots", "Sort new words"),
    definition: t("Créer les définitions", "Generate definitions"),
    example: t("Créer les exemples", "Generate examples"),
  };

  return (
    <div className="view training-view">
      <header><h1>{t("Entraînement", "Training")}</h1></header>
      {drill ? (
        <section className="training-drill">
          <div className="training-toolbar">
            <button className="btn ghost" onClick={() => setDrill(null)}>{t("Retour aux mots", "Back to words")}</button>
            {revealPicker}
            <label className="training-shuffle">
              {t("Lecture automatique", "Autoplay audio")}
              <Switch label={t("Lecture automatique", "Autoplay audio")} on={autoplayAudio}
                onChange={(on) => void setSetting("training_audio_autoplay", on ? "1" : "0").catch((error) => toast(errorText(error), "error"))} />
            </label>
            {audioModePicker}
            <span className="muted">{Math.min(position + 1, drill.length)} / {drill.length}</span>
          </div>
          {card ? (
            <>
              <RecallCard key={position} card={card} entry={entry} lang={lang} revealed={revealed} reveal={() => setRevealed(true)} />
              <div className="training-toolbar">
                <button className="btn ghost" onClick={() => void playAudio([card.term])}>
                  <Icon name="speaker" size={16} /> {t("Écouter le mot", "Play word")}
                </button>
                {example && <button className="btn ghost" onClick={() => void playAudio([example])}>
                  <Icon name="speaker" size={16} /> {t("Écouter l’exemple", "Play example")}
                </button>}
                <button className="btn soft" disabled={revealed} onClick={() => setRevealed(true)}>↓ {t("Révéler", "Reveal")}</button>
                <button className="btn ghost" disabled={!!busy || resetting} onClick={() => void resetWord(card.term)}
                  title={t("Supprime le mot du vocabulaire (Q)", "Remove from vocabulary (Q)")}>{t("Rétablir comme nouveau", "Reset to New")} · Q</button>
                <button className="btn soft" onClick={() => void grade(false)}>← {t("Je ne savais pas", "Didn’t know")}</button>
                <button className="btn primary" onClick={() => void grade(true)}>{t("Je savais", "Knew it")} →</button>
              </div>
            </>
          ) : <p role="status">{t("Entraînement terminé.", "Drill complete.")}</p>}
        </section>
      ) : (
        <>
          <div className="training-toolbar">
            <button className="btn soft" disabled={!!busy || resetting || !unsorted.length} onClick={() => void generate("difficulty", unsorted)}>
              {labels.difficulty} · {unsorted.length}
            </button>
            <button className="btn ghost" disabled={!!busy || resetting || !activeWords.some(({ term }) => !!deck[term]?.difficulty)}
              onClick={() => void generate("difficulty", activeWords.filter(({ term }) => !!deck[term]?.difficulty))}>
              {t("Revérifier les catégories", "Recheck categories")}
            </button>
            {isTauri && <button className="btn ghost" onClick={() => setShowAudioSettings((value) => !value)}
              aria-expanded={showAudioSettings}>{t("Réglages audio", "Audio settings")}</button>}
            {audioProgress && <span role="status">{t("Audio", "Audio")} · {audioProgress.done}/{audioProgress.total}</span>}
            {busy && <span className="muted" role="status">ChatGPT · {labels[busy.task]} · {busy.done}/{busy.total}</span>}
          </div>
          {showAudioSettings && (
            <div className="training-list"><section>
              <h2>{t("Audio des cartes", "Card audio")}</h2>
              {audioModePicker}
              <h2>Azure Speech</h2>
              <div className="training-toolbar">
                <Switch label="Azure Speech" on={azureEnabled}
                  onChange={(on) => void setSetting("training_audio_provider", on ? "azure" : "local").catch((error) => toast(errorText(error), "error"))} />
                <span>{t("Utiliser Azure", "Use Azure")}</span>
                <span className="muted">{azureSaved ? t("Clé enregistrée", "Key saved") : t("Non configuré", "Not configured")}</span>
              </div>
              <div className="training-toolbar">
                <label>{t("Région Azure", "Azure region")} <input className="input" placeholder="westeurope" value={azureRegion} onChange={(e) => setAzureRegion(e.target.value)} /></label>
                <label>{t("Clé Speech", "Speech key")} <input className="input" type="password" autoComplete="off" value={azureKey} onChange={(e) => setAzureKey(e.target.value)} /></label>
                <button className="btn primary" disabled={azureSaving || !azureRegion.trim() || !azureKey.trim()} onClick={() => void saveAzure()}>{t("Enregistrer", "Save")}</button>
              </div>
              <label>{t("Voix pour cette langue", "Voice for this language")} <input className="input" value={configuredVoice ?? defaultVoice}
                onChange={(e) => void setSetting(`training_azure_voice_${lang}`, e.target.value).catch((error) => toast(errorText(error), "error"))} /></label>
              <p className="muted">{t("Préparez l’audio avant l’exercice. La lecture automatique Azure utilise les clips enregistrés.", "Choose Word, Sentence, or Both before preparing audio. Azure autoplay uses saved clips only.")}</p>
            </section></div>
          )}
          <h2 className="training-setup-title">{t("Préparer un exercice", "Set up a drill")}</h2>
          <Segmented id="training-difficulty" label={t("Difficulté", "Difficulty")} value={difficulty}
            onChange={(v) => { setDifficulty(v); setLimit(100); }}
            options={[{ value: "all", label: t("Toutes", "All levels") }, ...tiers]} />
          <div className="training-toolbar">
            <Segmented id="training-recall" label={t("Dernier résultat", "Last result")} value={filter}
              onChange={(v) => { setFilter(v); setLimit(100); }}
              options={[
                { value: "all", label: t("Tous", "All words") },
                { value: "unchecked", label: t("Non cochés", "Unchecked") },
                { value: "checked", label: t("Cochés", "Checked") },
              ]} />
            <div className="training-shuffle">
              <span>{t("Mélanger", "Shuffle")}</span>
              <Switch label={t("Mélanger", "Shuffle")} on={shuffle} onChange={setShuffle} />
            </div>
            {revealPicker}
            <button className="btn primary" disabled={!practice.length} onClick={start}>{t("S’entraîner", "Start drill")} · {practice.length}</button>
          </div>
          {matches.length > practice.length && <p className="muted">{t("Les mots sans définition attendent dans la liste. Créez leurs définitions pour les ajouter à l’exercice.", "Words without a definition stay in the list. Generate definitions to include them in the drill.")}</p>}
          <div className="training-list">
            {[...tiers, { value: "unsorted", label: t("Non classés", "Unsorted") }].map(({ value, label }) => {
              const levelWords = eligible.filter(({ term }) => (deck[term]?.difficulty ?? "unsorted") === value);
              if (!levelWords.length) return null;
              const group = matches.filter(({ term }) => (deck[term]?.difficulty ?? "unsorted") === value);
              group.sort((a, b) => Number(deck[a.term]?.recalled === true) - Number(deck[b.term]?.recalled === true));
              return <section key={value}>
                <div className="training-level-head">
                  <h2>{label} <small>{levelWords.length}</small></h2>
                  {(["definition", "example"] as const).map((task) => {
                    const targets = needsTraining(levelWords, deck, task);
                    return <button key={task} className="btn sm soft" disabled={!!busy || resetting || !targets.length}
                      onClick={() => void generate(task, targets)}>{labels[task]} · {targets.length}</button>;
                  })}
                  {canPrepareAudio && <button className="btn sm soft" disabled={!!audioProgress}
                    onClick={() => void prepareAudio(levelWords)}>{t("Préparer l’audio", "Prepare audio")}</button>}
                </div>
                {group.slice(0, limit).map(({ term, translation }) => {
                  const entry = deck[term];
                  return <motion.div layout="position" key={term} className="training-row">
                    <button type="button" className="training-check" aria-label={term} aria-pressed={entry?.recalled === true}
                      onClick={() => void save([[term, { recalled: entry?.recalled !== true }]]).catch((error) => toast(errorText(error), "error"))}>
                      {entry?.recalled && <Icon name="check" size={12} stroke={2.5} />}
                    </button>
                    <div><strong lang={lang} dir="auto">{term}</strong>
                      {(entry?.definition || translation) && <span>{entry?.definition || translation}</span>}
                      {entry?.example && <small lang={lang} dir="auto">{entry.example}</small>}
                    </div>
                    <button className="btn sm ghost training-reset" disabled={!!busy || resetting} onClick={() => void resetWord(term)}
                      title={t("Supprime le mot du vocabulaire", "Remove from vocabulary")}>{t("Rétablir comme nouveau", "Reset to New")}</button>
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

function RecallCard({ card, entry, lang, revealed, reveal }: {
  card: Term;
  entry?: TrainingCard;
  lang: LangCode;
  revealed: boolean;
  reveal(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const showAnswer = revealed || hovered;

  return (
    <button type="button" className="training-flashcard"
      aria-expanded={showAnswer} onClick={reveal}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}>
      <strong lang={lang} dir="auto">{card.term}</strong>
      {entry?.example && <span className="training-example" lang={lang} dir="auto">
        {highlightExample(entry.example, entry.highlight || card.term)}
      </span>}
      <span className="training-answer" lang="en" aria-hidden={!showAnswer}>
        <b>{entry?.definition?.trim() || card.translation.trim()}</b>
        {entry?.literal && <span>{entry.literal}</span>}
        {entry?.note && <small>{entry.note}</small>}
      </span>
    </button>
  );
}

function highlightExample(example: string, target: string) {
  const index = example.indexOf(target);
  const start = index >= 0 ? index : example.toLowerCase().indexOf(target.toLowerCase());
  if (start < 0) return example;
  return <>{example.slice(0, start)}<mark>{example.slice(start, start + target.length)}</mark>{example.slice(start + target.length)}</>;
}
