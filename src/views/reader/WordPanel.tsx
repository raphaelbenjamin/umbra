import { ChineseExplain } from "./ChineseExplain";
import { displayText } from "../../lib/tokenize";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { api, errorText, isNoModel } from "../../lib/api";
import { useOnline } from "../../lib/online";
import { t } from "../../lib/i18n";
import { preparePronunciation, pronounce } from "../../lib/pronounce";
import { useApp } from "../../lib/store";
import type { DictResult, LangCode, Status, Term } from "../../lib/types";

export interface Selection {
  /** texte affiché (mot ou expression) */
  surface: string;
  /** clé du terme */
  key: string;
  /** phrase de contexte */
  sentence: string;
  /** bornes de la sélection dans la phrase (pour la surligner) */
  before: string;
  after: string;
  isPhrase: boolean;
  /** nombre de mots sélectionnés */
  words: number;
  /** indice du premier jeton (pour lire depuis ce mot) */
  tokenIndex: number;
  /** expression enregistrée qui contient ce mot, s'il y en a une */
  phrase?: { key: string; a: number; b: number; surface: string; translation: string } | null;
}

/** Une expression compte 8 mots au plus ; au-delà, la sélection est un passage : traduit, pas enregistré. */
export const EXPR_MAX_WORDS = 8;
/** Jusqu'à 5 mots, l'IA donne le sens en contexte ; au-delà, elle traduit le passage entier. */
const SENSE_MAX_WORDS = 5;

/** Une sélection de quelques mots peut être une entrée du dictionnaire (« zum Beispiel »,
 *  « học sinh ») ; en japonais, découpé caractère par caractère, un mot entier. */
const dictLookable = (lang: LangCode, sel: Selection) => !sel.isPhrase || sel.words <= (lang === "ja" ? 10 : lang === "zh" ? 6 : 4);

const statusOpts = (): { s: Status; label: string; sw: string }[] => [
  { s: 1, label: "1", sw: "var(--w-l1)" },
  { s: 2, label: "2", sw: "var(--w-l2)" },
  { s: 3, label: "3", sw: "var(--w-l3)" },
  { s: 4, label: t("Connu", "Known"), sw: "var(--ok)" },
];

interface Props {
  lang: LangCode;
  sel: Selection | null;
  term: Term | undefined;
  onStatus(key: string, status: number): void;
  onTranslation(key: string, translation: string, note: string, sentence: string): void;
  /** ouvre l'expression enregistrée [a, b] */
  onSelectPhrase(a: number, b: number): void;
  onClose(): void;
}

export function WordPanel({ lang, sel, term, onStatus, onTranslation, onSelectPhrase, onClose }: Props) {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const openGuide = useApp((s) => s.openGuide);
  const guideSeen = settings.guide_seen === "1";
  const openSettings = useApp((s) => s.openSettings);
  const llmReady = useApp((s) => s.models.some((m) => m.kind === "llm" && m.installed));
  const llmDownloading = useApp((s) => s.models.some((m) => m.kind === "llm" && !!s.downloads[m.id] && !s.downloads[m.id].error));
  // traduction confiée à l'IA en ligne (Réglages › IA) : fournisseur et modèle font partie de la demande
  const online = useOnline();
  const onlineKey = online.words ? `${online.provider.id}:${online.model}:${online.ready}` : "";
  const [dict, setDict] = useState<DictResult | null>(null);
  const [ai, setAi] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [aiState, setAiState] = useState<"idle" | "loading" | "stream" | "done" | "nomodel" | "error">("idle");
  const [aiError, setAiError] = useState("");
  const [slow, setSlow] = useState(false);
  const reqId = useRef(0);
  const termRef = useRef(term);
  termRef.current = term;

  const key = sel?.key ?? "";
  const sentence = sel?.sentence ?? "";

  // dictionnaire + IA à chaque nouvelle sélection
  useLayoutEffect(() => {
    if (!sel) return;
    const id = ++reqId.current;
    setDict(null);
    setAi("");
    setAiNote("");
    setAiError("");
    setAiState("loading");
    setSlow(false);
    const slowTimer = window.setTimeout(() => id === reqId.current && setSlow(true), 2500);

    if (dictLookable(lang, sel)) {
      // la suite de la phrase : le mot japonais ou vietnamien qui commence ici
      api()
        .dictLookup(lang, sel.surface, sel.after)
        .then((d) => id === reqId.current && setDict(d))
        .catch(() => {});
    }

    const t = window.setTimeout(async () => {
      let raw = "";
      try {
        // passage de plus de quelques mots : une traduction globale
        if (sel.words > SENSE_MAX_WORDS) {
          const res = await api().aiSentence(lang, sel.surface, (piece) => {
            if (id !== reqId.current) return;
            raw += piece;
            setAi(raw);
            setAiState("stream");
          });
          if (id !== reqId.current) return;
          setAi(res);
          setAiState("done");
          // expression déjà enregistrée sans traduction : on la complète
          if (res && termRef.current && !termRef.current.translation) {
            onTranslation(sel.key, res, "", sel.sentence);
          }
          return;
        }
        const res = await api().aiWord(lang, sel.surface, sel.sentence, (piece) => {
          if (id !== reqId.current) return;
          raw += piece;
          // « Sens : … » (français) ou « Meaning: … » (anglais)
          const line = raw.split("\n").find((l) => /^\s*(sens|meaning)/i.test(l)) ?? raw.split("\n")[0];
          setAi(line.replace(/^\s*(sens|meaning)\s*[:：]\s*/i, ""));
          setAiState("stream");
        });
        if (id !== reqId.current) return;
        setAi(res.translation);
        setAiNote(res.note);
        setAiState("done");
        // une sélection de plusieurs mots ne devient une expression que sur demande
        if (res.translation && !termRef.current?.translation && (!sel.isPhrase || termRef.current)) {
          onTranslation(sel.key, res.translation, res.note, sel.sentence);
        }
      } catch (e) {
        if (id !== reqId.current) return;
        if (isNoModel(e)) setAiState("nomodel");
        else if (String(e).includes("interrompu")) return;
        else {
          setAiState("error");
          setAiError(errorText(e));
        }
      }
    }, online.words && online.provider.id === "chatgpt" ? 0 : 90);
    return () => {
      reqId.current++;
      window.clearTimeout(t);
      window.clearTimeout(slowTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sentence, lang, llmReady, onlineKey]);

  // dictionnaire en téléchargement : le mot s'affiche dès qu'il arrive (une seule relecture)
  const pending = !!dict?.pending;
  useEffect(() => {
    if (!pending || !sel) return;
    const id = reqId.current;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void api()
      .dictListen((l) => {
        if (l !== lang || id !== reqId.current) return;
        api()
          .dictLookup(lang, sel.surface, sel.after)
          .then((d) => id === reqId.current && setDict({ ...d, pending: false }))
          .catch(() => {});
      })
      .then((u) => (alive ? (unlisten = u) : u()));
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, key, lang]);

  // la prononciation se prépare dès le toucher : le haut-parleur répond aussitôt
  const surface = sel?.surface ?? "";
  useEffect(() => {
    if (!surface) return;
    const t = window.setTimeout(() => preparePronunciation(surface, lang), 220);
    return () => window.clearTimeout(t);
  }, [surface, lang]);

  if (!sel) {
    return (
      <div className="wp-pane" aria-label={t("Détail du mot", "Word details")}>
        <div className="wp-scroll">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
            <h2 className="display" style={{ fontSize: 28 }}>
              {t("Touchez un mot", "Tap a word")}
            </h2>
            <p className="muted" style={{ lineHeight: 1.55 }}>
              {t(
                "Sa traduction dans cette phrase précise s'affiche ici, calculée sur votre Mac. Glissez sur plusieurs mots pour traduire tout un passage ou créer une expression.",
                "Its translation in this exact sentence appears here, computed on your Mac. Drag across several words to translate a whole passage or create a phrase.",
              )}
            </p>
          </motion.div>
          {/* première visite : le petit guide se propose, une seule fois */}
          <AnimatePresence>
            {!guideSeen && (
              <motion.div
                className="guide-invite"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.5 }}
              >
                <div className="update-head">
                  <span className="update-dot" />
                  <strong>{t("Nouveau dans Lumen ?", "New to Lumen?")}</strong>
                </div>
                <button className="icon-btn close" onClick={() => void setSetting("guide_seen", "1")} aria-label={t("Plus tard", "Later")}>
                  <Icon name="close" size={12} />
                </button>
                <p>{t("Le principe, la lanterne et les modèles d'IA en quatre images, le temps d'un café.", "The idea, the lantern and the AI models in four pictures, over a coffee.")}</p>
                <button className="btn sm primary glow" onClick={() => openGuide()}>
                  <Icon name="bulb" size={14} /> {t("Ouvrir le petit guide", "Open the short guide")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="wp-block" style={{ marginTop: "auto" }}>
            <span className="eyebrow">{t("Légende", "Legend")}</span>
            <div className="wp-legend">
              <div>
                <span className="sw" style={{ background: "var(--w-new)" }} />
                {t("Nouveau", "New")}
              </div>
              <div>
                <span className="sw" style={{ background: "linear-gradient(90deg, var(--w-l1), var(--w-l3))" }} />
                {t("En apprentissage (1 à 3)", "Learning (1 to 3)")}
              </div>
              <div>
                <span className="sw" style={{ boxShadow: "inset 0 0 0 1px var(--border-strong)" }} />
                {t("Connu", "Known")}
              </div>
            </div>
          </div>
          <div className="wp-block">
            <span className="eyebrow">{t("Raccourcis", "Shortcuts")}</span>
            <div className="shortcuts">
              <span>
                <span className="kbd">←</span>
                <span className="kbd">→</span>
              </span>
              <span>{t("Mot précédent, suivant", "Previous, next word")}</span>
              <span>
                <span className="kbd">{t("Maj", "Shift")}</span>
                <span className="kbd">←</span>
                <span className="kbd">→</span>
              </span>
              <span>{t("Étendre la sélection", "Extend the selection")}</span>
              <span>
                <span className="kbd">1</span>
                <span className="kbd">2</span>
                <span className="kbd">3</span>
                <span className="kbd">K</span>
              </span>
              <span>{t("Statut du mot (K : connu)", "Word status (K: known)")}</span>
              <span>
                <span className="kbd">X</span>
              </span>
              <span>{t("Ignorer (nom propre…)", "Ignore (proper name…)")}</span>
              <span>
                <span className="kbd">{t("Espace", "Space")}</span>
              </span>
              <span>{t("Lecture, pause", "Play, pause")}</span>
              <span>
                <span className="kbd">↵</span>
              </span>
              <span>{t("Terminer la page", "Finish the page")}</span>
              <span>
                <span className="kbd">C</span>
              </span>
              <span>{t("Discuter de la leçon", "Chat about the lesson")}</span>
            </div>
          </div>
          {guideSeen && (
            <button className="guide-link" onClick={() => openGuide()}>
              <Icon name="bulb" size={14} /> {t("Comment marche Lumen ?", "How does Lumen work?")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const status = term?.status ?? 0;
  const entries = dict?.entries ?? [];

  return (
    <div className="wp-pane" aria-label={t("Détail du mot", "Word details")}>
      <div key={key} className="wp-scroll wp-lookup">
        <div>
          <div className="wp-word">
            <h2 className={sel.surface.length > 36 ? "long" : ""} dir="auto">
              {displayText(sel.surface, lang)}
            </h2>
            <div style={{ display: "flex", gap: 2 }}>
              <button className="icon-btn" onClick={() => void pronounce(sel.surface, lang, settings[`voice_${lang}`])} aria-label={t("Prononcer", "Pronounce")}>
                <Icon name="speaker" size={18} />
              </button>
              <button className="icon-btn" onClick={onClose} aria-label={t("Fermer", "Close")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        </div>

        {sel.phrase && (
          <button className="wp-expr" onClick={() => onSelectPhrase(sel.phrase!.a, sel.phrase!.b)} title={t("Ouvrir l'expression", "Open the phrase")}>
            <span className="eyebrow">{t("Fait partie de l'expression", "Part of the phrase")}</span>
            <strong>{displayText(sel.phrase.surface, lang)}</strong>
            {sel.phrase.translation && <span className="wp-expr-tr">{sel.phrase.translation}</span>}
          </button>
        )}

        <div className="wp-block wp-sense">
          {aiState === "nomodel" ? (
            <div className="wp-note" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              {llmDownloading
                ? t(
                    "Le modèle de traduction se télécharge. La traduction en contexte apparaîtra ici dès qu'il sera prêt.",
                    "The translation model is downloading. The translation in context will appear here as soon as it's ready.",
                  )
                : t(
                    "La traduction en contexte demande une IA : un modèle sur ce Mac, ou une IA en ligne dans les réglages.",
                    "Translation in context needs an AI: a model on this Mac, or an online AI in Settings.",
                  )}
              {!llmDownloading && (
                <button className="btn sm soft" onClick={() => openSettings("ai")}>
                  {t("Installer un modèle", "Install a model")}
                </button>
              )}
            </div>
          ) : aiState === "error" ? (
            <div className="wp-note" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              {aiError}
              {online.words && (
                <button className="btn sm soft" onClick={() => openSettings("ai")}>
                  {t("Réglages de l'IA", "AI settings")}
                </button>
              )}
            </div>
          ) : aiState === "loading" ? (
            <>
              <div className="skeleton" style={{ height: 28, width: "60%" }} />
              {slow && (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {online.words
                    ? t(`${online.provider.name} réfléchit… La réponse arrive d'Internet.`, `${online.provider.name} is thinking… The answer is coming over the Internet.`)
                    : t("L'IA locale s'éveille… La toute première fois, cela prend quelques secondes.", "The local AI is waking up… The very first time, it takes a few seconds.")}
                </span>
              )}
            </>
          ) : (
            <div className={`wp-ai ${aiState === "stream" ? "stream" : ""} ${sel.words > SENSE_MAX_WORDS ? "passage" : ""}`}>{ai || "—"}</div>
          )}
        </div>

        {lang === "zh" && (
          <ChineseExplain key={JSON.stringify([sel.surface, sel.sentence])} selection={sel.surface} sentence={sel.sentence} />
        )}

        {sel.isPhrase &&
          !term &&
          (sel.words <= EXPR_MAX_WORDS ? (
            <div className="wp-block">
              <button className="btn primary glow" style={{ alignSelf: "flex-start" }} onClick={() => onTranslation(sel.key, aiState === "done" ? ai : "", aiNote, sel.sentence)}>
                <Icon name="layers" size={15} /> {t("Créer l'expression", "Create the phrase")}
              </button>
              <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {t("Elle sera repérée dans toutes vos leçons, avec son niveau d'apprentissage.", "It will be spotted in all your lessons, with its learning level.")}
              </span>
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              {t(
                `Au-delà de ${EXPR_MAX_WORDS} mots, la sélection est traduite sans devenir une expression.`,
                `Beyond ${EXPR_MAX_WORDS} words, the selection is translated without becoming a phrase.`,
              )}
            </span>
          ))}

        {dict?.pending && (
          <div className="wp-block">
            <span className="eyebrow">{t("Dictionnaire", "Dictionary")}</span>
            <span className="muted shimmer" style={{ fontSize: 12.5 }}>
              {t("Téléchargement du dictionnaire…", "Downloading the dictionary… it will be ready in a moment.")}
            </span>
          </div>
        )}

        {entries.length > 0 && (
          <div className="wp-block">
            <span className="eyebrow">{t("Dictionnaire", "Dictionary")}</span>
            <div className="wp-gloss">
              {entries.slice(0, 2).map((e, i) => (
                <div key={i}>
                  {(entries.length > 1 || e.word !== sel.surface.toLowerCase()) && (
                    <div className="pos">
                      {displayText(e.word, lang)}
                      {lang === "ja" && e.ipa && e.ipa !== e.word ? `【${e.ipa}】` : ""}
                      {lang === "zh" && e.ipa ? ` ${e.ipa}` : ""}
                      {e.pos && ` · ${e.pos}`}
                    </div>
                  )}
                  {e.glosses.slice(0, 3).map((g, j) => (
                    <button key={j} onClick={() => onTranslation(sel.key, g, term?.note ?? aiNote, sel.sentence)} title={t("Utiliser comme ma traduction", "Use as my translation")}>
                      <span className="n">{j + 1}</span>
                      <span>{g}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="wp-foot">
        <div className="wp-source">
          <span className={`dot ${online.words ? "online" : "ok"}`} />
          {aiState === "nomodel"
            ? t("Dictionnaire hors ligne", "Offline dictionary")
            : online.words
              ? t(`Traduit en ligne par ${online.provider.name} · la phrase lui est envoyée`, `Translated online by ${online.provider.name} · the sentence is sent to it`)
              : t("Traduit sur votre Mac · aucune donnée envoyée", "Translated on your Mac · no data sent")}
        </div>
        {(!sel.isPhrase || term) && (
          <div className="status-bar" data-tour="status">
            <div className="status-levels" role="radiogroup" aria-label={t("Statut du mot", "Word status")}>
              {statusOpts().map((o) => (
                <button key={o.s} role="radio" aria-checked={status === o.s} className={status === o.s ? "on" : ""} onClick={() => onStatus(sel.key, o.s)}>
                  {status === o.s && <motion.span layoutId="st-pill" className="st-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                  <span className="sw" style={{ background: o.sw }} />
                  {o.label}
                </button>
              ))}
            </div>
            <div className="status-actions">
              <button aria-label={t("Ignorer", "Ignore")} title={t("Ignorer", "Ignore")} aria-pressed={status === 5} onClick={() => onStatus(sel.key, 5)}>
                <Icon name="ban" size={13} />
              </button>
              <button aria-label={t("Redevenir nouveau", "Make new again")} title={t("Redevenir nouveau", "Make new again")} disabled={status === 0} onClick={() => onStatus(sel.key, 0)}>
                <Icon name="refresh" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
