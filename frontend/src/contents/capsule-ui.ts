import type { PlasmoCSConfig } from "plasmo";
import { LOGO_BASE64 } from "../lib/ui/logo";

export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://chat.deepseek.com/*",
    "https://www.doubao.com/*",
    "https://chat.qwen.ai/*",
  ],
  run_at: "document_idle",
  all_frames: false,
};

const STYLE_ID = "vesti-floating-style";
const BUTTON_ID = "extension-floating-button";
const FLOATING_BUTTON_DIAMETER = 43.2;
const FLOATING_BUTTON_LOGO_SIZE = 21.6;
const DEFAULT_RIGHT = 24;
const DEFAULT_BOTTOM = 100;
const VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD_PX = 5;

const STYLE_TEXT = `
.floating-button {
  position: fixed;
  right: ${DEFAULT_RIGHT}px;
  bottom: ${DEFAULT_BOTTOM}px;
  z-index: 9999;
  width: ${FLOATING_BUTTON_DIAMETER}px;
  height: ${FLOATING_BUTTON_DIAMETER}px;
  border-radius: 50%;
  background-color: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.floating-button.dragging {
  cursor: grabbing;
  transition: none;
}

.floating-button:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.floating-button:active {
  transform: scale(0.95);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.button-logo {
  width: ${FLOATING_BUTTON_LOGO_SIZE}px;
  height: ${FLOATING_BUTTON_LOGO_SIZE}px;
  object-fit: contain;
}
`;

const clamp = (value: number, min: number, max: number): number => {
  const upperBound = Math.max(min, max);
  return Math.min(Math.max(value, min), upperBound);
};

const getComputedPx = (element: HTMLElement, prop: "right" | "bottom", fallback: number): number => {
  const raw = window.getComputedStyle(element)[prop];
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampButtonPosition = (button: HTMLDivElement) => {
  const currentRight = getComputedPx(button, "right", DEFAULT_RIGHT);
  const currentBottom = getComputedPx(button, "bottom", DEFAULT_BOTTOM);
  const maxRight = window.innerWidth - FLOATING_BUTTON_DIAMETER - VIEWPORT_MARGIN;
  const maxBottom = window.innerHeight - FLOATING_BUTTON_DIAMETER - VIEWPORT_MARGIN;
  const nextRight = clamp(currentRight, VIEWPORT_MARGIN, maxRight);
  const nextBottom = clamp(currentBottom, VIEWPORT_MARGIN, maxBottom);
  button.style.right = `${nextRight}px`;
  button.style.bottom = `${nextBottom}px`;
};

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.appendChild(style);
};

const handleOpen = () => {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }
  chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL", source: "capsule-ui" }, () => {
    void chrome.runtime.lastError;
  });
};

const mount = () => {
  if (window.top !== window.self) {
    return;
  }

  if (document.getElementById(BUTTON_ID)) {
    return;
  }

  ensureStyle();

  const button = document.createElement("div");
  button.id = BUTTON_ID;
  button.className = "floating-button";
  button.setAttribute("role", "button");
  button.setAttribute("aria-label", "Vesti");
  button.tabIndex = 0;

  const logo = document.createElement("img");
  logo.className = "button-logo";
  logo.src = LOGO_BASE64;
  logo.alt = "Extension Logo";

  let isPointerDown = false;
  let isDragging = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startRight = DEFAULT_RIGHT;
  let startBottom = DEFAULT_BOTTOM;

  const resetPointerState = () => {
    isPointerDown = false;
    isDragging = false;
    activePointerId = null;
    button.classList.remove("dragging");
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || activePointerId !== null) {
      return;
    }
    isPointerDown = true;
    isDragging = false;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startRight = getComputedPx(button, "right", DEFAULT_RIGHT);
    startBottom = getComputedPx(button, "bottom", DEFAULT_BOTTOM);
    button.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isPointerDown || activePointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      isDragging = true;
      button.classList.add("dragging");
    }
    if (!isDragging) {
      return;
    }

    const maxRight = window.innerWidth - FLOATING_BUTTON_DIAMETER - VIEWPORT_MARGIN;
    const maxBottom = window.innerHeight - FLOATING_BUTTON_DIAMETER - VIEWPORT_MARGIN;
    const nextRight = clamp(startRight - dx, VIEWPORT_MARGIN, maxRight);
    const nextBottom = clamp(startBottom - dy, VIEWPORT_MARGIN, maxBottom);
    button.style.right = `${nextRight}px`;
    button.style.bottom = `${nextBottom}px`;
    event.preventDefault();
  };

  const completePointerInteraction = (event: PointerEvent, triggerOpenOnTap: boolean) => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    const shouldOpen = triggerOpenOnTap && isPointerDown && !isDragging;
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    resetPointerState();
    clampButtonPosition(button);
    if (shouldOpen) {
      handleOpen();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    completePointerInteraction(event, true);
  };

  const onPointerCancel = (event: PointerEvent) => {
    completePointerInteraction(event, false);
  };

  button.appendChild(logo);
  button.addEventListener("pointerdown", onPointerDown);
  button.addEventListener("pointermove", onPointerMove);
  button.addEventListener("pointerup", onPointerUp);
  button.addEventListener("pointercancel", onPointerCancel);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpen();
    }
  });

  document.body.appendChild(button);
  clampButtonPosition(button);
  window.addEventListener("resize", () => {
    clampButtonPosition(button);
  });
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
