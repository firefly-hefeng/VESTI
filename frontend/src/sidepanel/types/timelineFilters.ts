import type { Platform } from "~lib/types";

export type HeaderMode = "default" | "search" | "filter";
export type DatePreset = "all_time" | "today" | "this_week" | "this_month";

export const DATE_PRESET_OPTIONS: ReadonlyArray<{
  id: DatePreset;
  label: string;
}> = [
  { id: "all_time", label: "All time" },
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "this_month", label: "This month" },
];

export const PLATFORM_OPTIONS: ReadonlyArray<Platform> = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "DeepSeek",
  "Qwen",
  "Doubao",
];
