import { logger } from "../utils/logger";

export function requestVectorization(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "RUN_VECTORIZATION", target: "background" }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    logger.warn("vectorize", "Failed to request vectorization", {
      error: (error as Error)?.message ?? String(error),
    });
  }
}
