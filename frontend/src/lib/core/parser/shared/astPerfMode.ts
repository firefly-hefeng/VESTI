import type { Platform } from "../../../types";

export type AstPerfMode = "full" | "p0_fallback";

const FULL_BUDGET_MS = 16;
const RECOVERY_BUDGET_MS = 12;
const RECOVERY_WINDOW = 3;

interface PerfModeState {
  mode: AstPerfMode;
  recoverySamples: number[];
}

export interface AstPerfModeUpdate {
  mode: AstPerfMode;
  switched: boolean;
  previousMode: AstPerfMode;
}

export class AstPerfModeController {
  private stateByPlatform = new Map<Platform, PerfModeState>();

  getMode(platform: Platform): AstPerfMode {
    return this.getState(platform).mode;
  }

  record(platform: Platform, parseDurationMs: number): AstPerfModeUpdate {
    const state = this.getState(platform);
    const previousMode = state.mode;

    if (state.mode === "full") {
      if (parseDurationMs > FULL_BUDGET_MS) {
        state.mode = "p0_fallback";
        state.recoverySamples = [];
      }
      return {
        mode: state.mode,
        switched: previousMode !== state.mode,
        previousMode,
      };
    }

    state.recoverySamples.push(parseDurationMs);
    if (state.recoverySamples.length > RECOVERY_WINDOW) {
      state.recoverySamples.shift();
    }

    const canRecover =
      state.recoverySamples.length === RECOVERY_WINDOW &&
      state.recoverySamples.every((sample) => sample <= RECOVERY_BUDGET_MS);

    if (canRecover) {
      state.mode = "full";
      state.recoverySamples = [];
    }

    return {
      mode: state.mode,
      switched: previousMode !== state.mode,
      previousMode,
    };
  }

  private getState(platform: Platform): PerfModeState {
    const existing = this.stateByPlatform.get(platform);
    if (existing) return existing;

    const initial: PerfModeState = {
      mode: "full",
      recoverySamples: [],
    };
    this.stateByPlatform.set(platform, initial);
    return initial;
  }
}

export const astPerfModeController = new AstPerfModeController();
