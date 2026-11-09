import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { isTauri } from "./api";
import { isMobile, isWindows } from "./platform";

export const canUpdate = isTauri && !isMobile && !isWindows;
type Phase = "idle" | "checking" | "available" | "installing" | "ready" | "current" | "error";

interface UpdateState {
  phase: Phase;
  version: string;
  error: string;
  check(): Promise<void>;
  install(): Promise<void>;
}

let pending: Update | null = null;

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: "idle",
  version: "",
  error: "",
  async check() {
    if (!canUpdate || ["checking", "installing", "ready"].includes(get().phase)) return;
    set({ phase: "checking", error: "" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      await pending?.close();
      pending = null;
      pending = await check({ timeout: 15000 });
      set({ phase: pending ? "available" : "current", version: pending?.version ?? "" });
    } catch (error) {
      set({ phase: "error", error: String(error) });
    }
  },
  async install() {
    if (!pending || get().phase !== "available") return;
    set({ phase: "installing", error: "" });
    try {
      // The short manifest timeout should not carry over to the app archive.
      await pending.downloadAndInstall(undefined, { timeout: 600000 });
      set({ phase: "ready" });
    } catch (error) {
      set({ phase: "error", error: String(error) });
    }
  },
}));
