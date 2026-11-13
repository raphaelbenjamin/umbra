import type { Term } from "./types";

export type Difficulty = "beginner" | "intermediate" | "advanced";
export type TrainingTask = "difficulty" | "definition" | "example";
export type TrainingCard = Partial<Record<TrainingTask, string>> & { recalled?: boolean };
export type TrainingDeck = Record<string, TrainingCard>;

export function readTrainingDeck(raw: string | undefined): TrainingDeck {
  try {
    const data = JSON.parse(raw ?? "{}");
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return Object.assign(Object.create(null), data);
    }
  } catch {
    // A missing or unreadable deck starts empty.
  }
  return Object.create(null);
}

export function needsTraining(words: Term[], deck: TrainingDeck, task: TrainingTask) {
  return words.filter(({ term }) => !deck[term]?.[task]);
}
