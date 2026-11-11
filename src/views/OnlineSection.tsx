import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/Icon";
import { Orb, Sheet } from "../components/ui";
import { api, errorText } from "../lib/api";
import { openSource } from "../lib/discover";
import { t } from "../lib/i18n";
import { latency, onlineProviders, useChatGpt, useOnline, type OnlineProvider } from "../lib/online";
import { isIOS } from "../lib/platform";
import { useApp } from "../lib/store";
import type { OnlineCheck } from "../lib/types";

/* Réglages › IA : où travaille l'IA (sur ce Mac ou en ligne), et l'IA en ligne :
   fournisseur, clé vérifiée, modèle, ce qu'elle prend en charge. */

const TILE = { type: "spring", stiffness: 520, damping: 40 } as const;
const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 }, transition: { type: "spring" as const, stiffness: 320, damping: 30 } };

/** Liste des modèles gardée à la dernière vérification (réglage `online_models_<id>`). */
function savedModels(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** Clé (et adresse, pour un serveur choisi) : collée, vérifiée, gardée sur ce Mac ; puis le modèle. */
function OnlineKey({ provider: p }: { provider: OnlineProvider }) {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const custom = p.id === "custom";
  const savedKey = settings[p.keySetting] ?? "";
  const savedUrl = settings.online_url ?? "";
  const modelKey = `online_model_${p.id}`;
  const listKey = `online_models_${p.id}`;
  const model = settings[modelKey] ?? "";
  const models = savedModels(settings[listKey]);
  const [key, setKey] = useState(savedKey);
  const [url, setUrl] = useState(savedUrl);
  const [typed, setTyped] = useState(model);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OnlineCheck | null>(null);

  const saved = custom ? !!savedUrl.trim() : !!savedKey.trim();
  const dirty = key.trim() !== savedKey.trim() || (custom && url.trim() !== savedUrl.trim());
  const can = custom ? !!url.trim() : !!key.trim();

  const check = async (wanted = model, previous?: string) => {
    if (busy || !can) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api().onlineCheck(p.id, key.trim(), custom ? url.trim() : undefined, wanted || undefined);
      void setSetting(p.keySetting, key.trim());
      if (custom) void setSetting("online_url", url.trim());
      void setSetting(modelKey, r.model);
      void setSetting(listKey, JSON.stringify(r.models));
      setTyped(r.model);
      setDone(r);
    } catch (e) {
      // le modèle choisi ne répond pas (file d'attente, modèle retiré) : on garde celui d'avant
      if (previous) {
        void setSetting(modelKey, previous);
        setTyped(previous);
        setError(`${errorText(e)} ${t(`Umbra garde ${previous}.`, `Umbra keeps ${previous}.`)}`);
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // un autre modèle : il sert aussitôt, et une petite question dit s'il répond (et en combien de temps)
  const choose = (m: string) => {
    if (!m || m === model) return;
    void setSetting(modelKey, m);
    void check(m, model || undefined);
  };

  const options = model && !models.includes(model) ? [model, ...models] : models;

  return (
    <div className="gemini-key online-key">
      {custom && (
        <div className="online-url">
          <input
            className="input"
            value={url}
            placeholder={t("Adresse du serveur, par exemple http://localhost:11434/v1", "Server address, for example http://localhost:11434/v1")}
            aria-label={t("Adresse du serveur", "Server address")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => {
              setUrl(e.target.value);
              setDone(null);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void check()}
          />
        </div>
      )}
      <div className="key-row">
        <div className="key-field">
          <input
            className="input"
            type={show ? "text" : "password"}
            value={key}
            placeholder={custom ? t("Clé, si le serveur en demande une", "Key, if the server asks for one") : t(`Collez votre clé ${p.name} ici`, `Paste your ${p.name} key here`)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => {
              setKey(e.target.value);
              setDone(null);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void check()}
            aria-label={t(`Clé ${p.name}`, `${p.name} key`)}
          />
          <button className={`icon-btn ${show ? "on" : ""}`} onClick={() => setShow(!show)} aria-label={show ? t("Masquer la clé", "Hide the key") : t("Afficher la clé", "Show the key")}>
            <Icon name="eye" size={15} />
          </button>
        </div>
        <button className="btn sm primary" disabled={!can || busy} onClick={() => void check()}>
          {busy ? t("Vérification…", "Checking…") : saved && !dirty && !error ? t("Vérifier à nouveau", "Check again") : t("Vérifier et garder", "Check and keep")}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {busy && (
          <motion.div key="busy" className="key-note" {...enter}>
            <Orb size={16} />
            <span>{custom ? t("Umbra pose une petite question au serveur…", "Umbra is asking the server a little question…") : t(`Umbra pose une petite question à ${p.name}…`, `Umbra is asking ${p.name} a little question…`)}</span>
          </motion.div>
        )}
        {error && (
          <motion.div key="err" className="key-note error" {...enter}>
            <Icon name="ban" size={15} />
            <span>{error}</span>
          </motion.div>
        )}
        {done && (
          <motion.div key="ok" className="key-note ok" {...enter}>
            <span className="key-check">
              <Icon name="check" size={13} stroke={2.4} />
            </span>
            <span>{t(`Prêt. ${done.model} a répondu en ${latency(done.ms)}.`, `Ready. ${done.model} answered in ${latency(done.ms)}.`)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {saved && (options.length > 0 || custom) && (
        <div className="online-model">
          <span>{t("Modèle", "Model")}</span>
          {options.length > 0 ? (
            <select className="select" value={model} onChange={(e) => choose(e.target.value)} aria-label={t("Modèle", "Model")} disabled={busy}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={typed}
              placeholder={t("Nom du modèle, par exemple qwen3:8b", "Model name, for example qwen3:8b")}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => typed.trim() && choose(typed.trim())}
              onKeyDown={(e) => e.key === "Enter" && typed.trim() && choose(typed.trim())}
            />
          )}
        </div>
      )}

      <span className="import-hint">
        {p.keyUrl ? (
          <>
            {saved
              ? p.id === "nvidia"
                ? t("Votre compte et vos clés :", "Your account and your keys:")
                : t("Votre compte, son crédit et vos clés :", "Your account, its credit and your keys:")
              : t("Pas encore de clé ? Créez-la sur", "No key yet? Create one at")}{" "}
            <a
              className="link"
              href={p.keyUrl}
              onClick={(e) => {
                e.preventDefault();
                void openSource(p.keyUrl);
              }}
            >
              {hostOf(p.keyUrl)} <Icon name="external" size={12} stroke={2} />
            </a>
            {p.id === "gemini"
              ? t(". C'est la même clé que pour les podcasts ; elle reste sur ce Mac.", ". It's the same key as for podcasts; it stays on this Mac.")
              : t(". Elle reste sur ce Mac, jamais dans la sauvegarde.", ". It stays on this Mac, never in the backup.")}
          </>
        ) : (
          t("Ollama : http://localhost:11434/v1 · LM Studio : http://localhost:1234/v1", "Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1")
        )}
      </span>
    </div>
  );
}

/** Sign in with ChatGPT : connexion dans le navigateur, forfait, modèle, rythme des demandes. */
function ChatGptAccount({ explain, words, chat }: { explain: boolean; words: boolean; chat: boolean }) {
  const { status, set } = useChatGpt();
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const model = settings.online_model_chatgpt ?? "";
  const models = savedModels(settings.online_models_chatgpt);
  const [busy, setBusy] = useState<"in" | "out" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OnlineCheck | null>(null);
  const [welcome, setWelcome] = useState(false);
  const ready = !!status?.signed_in && status.plan && !status.expired;

  const check = async () => {
    setBusy("check");
    setError(null);
    setDone(null);
    try {
      const r = await api().onlineCheck("chatgpt", "", undefined, model || undefined);
      void setSetting("online_models_chatgpt", JSON.stringify(r.models));
      await setSetting("online_model_chatgpt", r.model);
      setDone(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const signIn = async () => {
    setBusy("in");
    setError(null);
    setDone(null);
    try {
      const s = await api().chatgptSignIn();
      set(s);
      setBusy(null);
      if (!s.plan) {
        setError(t(
          "Connecté, mais ce compte n'a pas accordé l'usage de son forfait : il faut un abonnement Plus ou Pro, et accepter « Utiliser votre forfait » dans la fenêtre de ChatGPT.",
          "Signed in, but this account didn't grant use of its plan: it takes a Plus or Pro subscription, and accepting “Use your plan” in ChatGPT's window.",
        ));
        return;
      }
      // une seule fois : ce que cela veut dire pour le forfait
      if (settings.online_chatgpt_welcomed !== "1") setWelcome(true);
      await check();
    } catch (e) {
      const m = errorText(e);
      if (m !== "annulé") setError(m);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("out");
    setError(null);
    setDone(null);
    try {
      set(await api().chatgptSignOut());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const modelFields = [
    { enabled: explain, key: "online_model_chatgpt_explain", label: t("Modèle pour Expliquer", "Explain model") },
    { enabled: words, key: "online_model_chatgpt", label: t("Modèle de traduction", "Translation model") },
    { enabled: chat, key: "online_model_chatgpt_chat", label: t("Modèle pour Chat et Simplifier", "Chat and Simplify model") },
  ];
  const manage = (e: React.MouseEvent) => {
    e.preventDefault();
    void openSource(status?.manage_url || "https://chatgpt.com/#settings/Usage");
  };

  return (
    <div className="gemini-key online-key chatgpt-account">
      {!status?.signed_in || status.expired ? (
        <div className="key-row">
          <span className="grow muted">
            {status?.expired
              ? t(`La connexion de ${status.email || "votre compte"} a expiré.`, `The connection of ${status.email || "your account"} has expired.`)
              : isIOS
                ? t("Connectez-vous à ChatGPT dans la page qui s'ouvre et acceptez : aucune clé à copier.", "Sign in to ChatGPT on the page that opens and accept: no key to copy.")
                : t("Ouvrez ChatGPT dans le navigateur, acceptez, et revenez : aucune clé à copier.", "Open ChatGPT in the browser, accept, and come back: no key to copy.")}
          </span>
          {busy === "in" ? (
            <button className="btn sm ghost" onClick={() => void api().modelCancel("chatgpt")}>
              {t("Annuler", "Cancel")}
            </button>
          ) : (
            <button className="btn sm primary" disabled={!!busy} onClick={() => void signIn()}>
              {status?.expired ? t("Se reconnecter", "Sign in again") : t("Continuer avec ChatGPT", "Continue with ChatGPT")}
            </button>
          )}
        </div>
      ) : (
        <div className="key-row">
          <span className="grow">
            <strong>{status.email || t("Compte ChatGPT", "ChatGPT account")}</strong>
            {/* deux lignes (`.set-row .grow`) : le compte, puis ce qu'il permet */}
            <span className="muted">{status.plan ? t("Forfait connecté", "Plan connected") : t("Forfait non accordé", "Plan not granted")}</span>
          </span>
          <button className="btn sm ghost" disabled={!!busy} onClick={() => void signOut()}>
            {t("Se déconnecter", "Sign out")}
          </button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {busy === "in" && (
          <motion.div key="in" className="key-note" {...enter}>
            <Orb size={16} />
            <span>{isIOS ? t("Terminez la connexion dans la page de ChatGPT…", "Finish signing in on the ChatGPT page…") : t("Terminez la connexion dans votre navigateur…", "Finish signing in in your browser…")}</span>
          </motion.div>
        )}
        {busy === "check" && (
          <motion.div key="check" className="key-note" {...enter}>
            <Orb size={16} />
            <span>{t("Umbra pose une petite question à ChatGPT…", "Umbra is asking ChatGPT a little question…")}</span>
          </motion.div>
        )}
        {error && (
          <motion.div key="err" className="key-note error" {...enter}>
            <Icon name="ban" size={15} />
            <span>{error}</span>
          </motion.div>
        )}
        {done && (
          <motion.div key="ok" className="key-note ok" {...enter}>
            <span className="key-check">
              <Icon name="check" size={13} stroke={2.4} />
            </span>
            <span>{t(`Prêt. ${done.model} a répondu en ${latency(done.ms)}.`, `Ready. ${done.model} answered in ${latency(done.ms)}.`)}</span>
          </motion.div>
        )}
        {ready && words && status?.paused_minutes != null && (
          <motion.div key="pause" className="key-note error" {...enter}>
            <Icon name="clock" size={15} />
            <span>
              {t(
                `Traduction ChatGPT en pause pendant encore ${status.paused_minutes} min.`,
                `ChatGPT translation is paused for ${status.paused_minutes} more min.`,
              )}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {ready && modelFields.filter((field) => field.enabled).map(({ key, label }) => {
        const value = settings[key] ?? "";
        const options = [...new Set([...models, value, model].filter(Boolean))];
        return (
          <label className="online-model" key={key}>
            <span>{label}</span>
            <select className="select" value={value} disabled={!!busy} onChange={(e) => void setSetting(key, e.target.value)}>
              {key !== "online_model_chatgpt" && (
                <option value="">{model ? t(`Par défaut (${model})`, `Default (${model})`) : t("Modèle par défaut", "Default model")}</option>
              )}
              {!model && key === "online_model_chatgpt" && <option value="" disabled>{t("Choisir un modèle", "Choose a model")}</option>}
              {options.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        );
      })}
      {ready && modelFields.some((field) => field.enabled) && (
        <div className="key-row">
          <button className="btn sm ghost" disabled={!!busy} onClick={() => void check()}>
            {t("Actualiser les modèles", "Refresh models")}
          </button>
        </div>
      )}

      <span className="import-hint">
        {ready && (
          <>
            {status.requests_today > 0 && (
              <>
                {t(`${status.requests_today} demande${status.requests_today > 1 ? "s" : ""} à ChatGPT aujourd'hui. `, `${status.requests_today} request${status.requests_today > 1 ? "s" : ""} to ChatGPT today. `)}
              </>
            )}
            <a className="link" href={status.manage_url} onClick={manage}>
              {t("Gérer l'utilisation", "Manage usage")} <Icon name="external" size={12} stroke={2} />
            </a>
          </>
        )}
      </span>

      {/* dans le document : la page des Réglages garde un filtre de son entrée, qui
          calerait la fenêtre sur la page déroulée et non sur l'écran */}
      {createPortal(
        <Sheet
          open={welcome}
          onClose={() => {
            setWelcome(false);
            void setSetting("online_chatgpt_welcomed", "1");
          }}
          title={t("Vous utilisez votre forfait ChatGPT", "You're using your ChatGPT plan")}
          width={460}
          footer={
            <button
              className="btn primary"
              onClick={() => {
                setWelcome(false);
                void setSetting("online_chatgpt_welcomed", "1");
              }}
            >
              {t("Compris", "Got it")}
            </button>
          }
        >
          <p>
            {t(
              "Les fonctions configurées pour ChatGPT utilisent votre forfait. Vous pouvez suivre l’utilisation depuis ChatGPT.",
              "Features set to ChatGPT use your plan. You can track usage in ChatGPT.",
            )}{" "}
            <a className="link" href={status?.manage_url} onClick={manage}>
              {t("Gérer l'utilisation", "Manage usage")}
            </a>
          </p>
        </Sheet>,
        document.body,
      )}
    </div>
  );
}

export function OnlineSection() {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const st = useOnline();
  const p = st.provider;
  const chatgptProvider = st.on && p.id === "chatgpt";
  const showAccount = st.explain || chatgptProvider || !!settings.online_key_chatgpt;
  const saved = p.id === "custom" ? !!settings.online_url?.trim() : !!settings[p.keySetting]?.trim();
  const local = t("Modèle local", "Local model");
  const provider = t(`Fournisseur · ${p.name}`, `Provider · ${p.name}`);
  const roles = [
    {
      key: "online_translation_engine",
      title: t("Traduction instantanée", "Instant AI translation"),
      description: t("Sens des mots et traduction des phrases pendant la lecture.", "Word meanings and sentence translations as you read."),
      value: st.words ? "provider" : "local",
      remote: "provider",
      label: provider,
    },
    {
      key: "online_explain_engine",
      title: t("Expliquer", "Explain"),
      description: t("Explication, analyse et exemples à la demande dans le panneau de lecture.", "On-demand tutor breakdowns and examples in the reader."),
      value: st.explain ? "chatgpt" : "local",
      remote: "chatgpt",
      label: "ChatGPT",
    },
    {
      key: "online_chat_engine",
      title: t("Chat et Simplifier", "Chat and Simplify"),
      description: t("Conversations et réécriture des leçons.", "Conversations and lesson rewrites."),
      value: st.chat ? "provider" : "local",
      remote: "provider",
      label: provider,
    },
  ];

  return (
    <>
      <section className="set-section">
        <h3>{t("Modèle par fonction", "AI by feature")}</h3>
        <div className="set-card">
          {roles.map(({ key, title, description, value, remote, label }) => (
            <label className="set-row ai-route" key={key}>
              <span className="grow">
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <select className="select" value={value} onChange={(e) => void setSetting(key, e.target.value)}>
                <option value="local">{local}</option>
                <option value={remote}>{label}</option>
              </select>
            </label>
          ))}
        </div>
      </section>

      {showAccount && (
        <section className="set-section">
          <h3>{t("Compte ChatGPT", "ChatGPT account")}</h3>
          {st.explain && (
            <p>{t(
              "Quand vous cliquez sur Expliquer, ChatGPT reçoit la sélection et sa phrase de contexte.",
              "When you click Explain, ChatGPT receives the selection and its surrounding sentence.",
            )}</p>
          )}
          <div className="set-card">
            <div className="set-row">
              <ChatGptAccount explain={st.explain} words={chatgptProvider && st.words} chat={chatgptProvider && st.chat} />
            </div>
          </div>
        </section>
      )}

      {st.on && (
        <section className="set-section">
          <h3>{t("Fournisseur en ligne", "Online provider")}</h3>
          <p>{t("Utilisé par la traduction ou le chat lorsque vous choisissez Fournisseur.", "Used for translation or chat when you select Provider.")}</p>
          <div className="places online-places" role="radiogroup" aria-label={t("Fournisseur en ligne", "Online provider")}>
            {onlineProviders().map((x) => {
              const on = x.id === p.id;
              const has = x.id === "custom" ? !!settings.online_url?.trim() : !!settings[x.keySetting]?.trim();
              return (
                <button key={x.id} role="radio" aria-checked={on} className={`place ${on ? "on" : ""}`} onClick={() => void setSetting("online_provider", x.id)} title={x.name}>
                  {on && <motion.span layoutId="online-provider" className="look-ring" transition={TILE} />}
                  <span className={`place-glyph ${x.mark ? "mono" : ""}`}>{x.mark || <Icon name="link" size={18} />}</span>
                  <strong>{x.name}</strong>
                  <span className="place-note">
                    {has ? (x.id === "custom" ? t("Adresse enregistrée", "Address saved") : x.id === "chatgpt" ? t("Connecté", "Connected") : t("Clé enregistrée", "Key saved")) : x.note}
                  </span>
                </button>
              );
            })}
          </div>
          {!chatgptProvider && (
            <div className="set-card">
              <div className="set-row">
                <div className="grow">
                  <strong>{p.name}</strong>
                  <span>{p.about}</span>
                </div>
                {saved && p.id !== "gemini" && (
                  <button className="btn sm ghost" onClick={() => {
                    void setSetting(p.keySetting, "");
                    if (p.id === "custom") void setSetting("online_url", "");
                  }}>
                    {p.id === "custom" ? t("Oublier ce serveur", "Forget this server") : t("Retirer la clé", "Remove the key")}
                  </button>
                )}
              </div>
              <div className="set-row">
                <OnlineKey key={p.id} provider={p} />
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
