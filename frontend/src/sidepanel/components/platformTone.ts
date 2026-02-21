import type { Platform } from "~lib/types";

interface PlatformToneClassSet {
  bg: string;
  text: string;
  border: string;
}

export const PLATFORM_TONE: Record<Platform, PlatformToneClassSet> = {
  ChatGPT: {
    bg: "bg-chatgpt-bg",
    text: "text-chatgpt-text",
    border: "border-chatgpt-border",
  },
  Claude: {
    bg: "bg-claude-bg",
    text: "text-claude-text",
    border: "border-claude-border",
  },
  Gemini: {
    bg: "bg-gemini-bg",
    text: "text-gemini-text",
    border: "border-gemini-border",
  },
  DeepSeek: {
    bg: "bg-deepseek-bg",
    text: "text-deepseek-text",
    border: "border-deepseek-border",
  },
  Qwen: {
    bg: "bg-qwen-bg",
    text: "text-qwen-text",
    border: "border-qwen-border",
  },
  Doubao: {
    bg: "bg-doubao-bg",
    text: "text-doubao-text",
    border: "border-doubao-border",
  },
};
