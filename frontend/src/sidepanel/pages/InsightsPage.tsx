import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, FileText, Loader2, Network } from "lucide-react";
import type {
  AsyncStatus,
  Conversation,
  Platform,
  SummaryRecord,
  WeeklyReportRecord,
} from "~lib/types";
import {
  generateConversationSummary,
  generateWeeklyReport,
  getConversationSummary,
  getConversations,
  getWeeklyReport,
} from "~lib/services/storageService";
import { resolveTurnCount } from "~lib/capture/turn-metrics";
import {
  toChatSummaryData,
  toWeeklySummaryData,
} from "~lib/services/insightAdapter";
import type { WeeklySummaryData } from "~lib/types/insightsPresentation";
import { InsightsAccordionItem } from "../components/InsightsAccordionItem";
import { InsightsWandIcon } from "../components/InsightsWandIcon";

const COLLAPSE_AT = 3;

type WeeklyDigestUiState =
  | "idle"
  | "generating"
  | "ready"
  | "sparse_week"
  | "error";

type WeeklyStableUiState = "idle" | "ready" | "sparse_week";

type WeeklyGenerationPhase =
  | "ready_to_compile"
  | "loading_thread_summaries"
  | "pattern_detection"
  | "cross_domain_mapping"
  | "composing_and_persisting";

type ThreadSummaryUiState =
  | "no_thread"
  | "selected_idle"
  | "selected_loading"
  | "selected_error"
  | "ready"
  | "ready_loading"
  | "ready_error";

interface WeeklyPhaseDefinition {
  phase: Exclude<WeeklyGenerationPhase, "ready_to_compile">;
  status: string;
  label: string;
  sublabel: string;
  minDurationMs: number;
  hint: string;
}

const WEEKLY_PHASES: WeeklyPhaseDefinition[] = [
  {
    phase: "loading_thread_summaries",
    status: "Loading this week's thread summaries...",
    label: "Loading thread summaries",
    sublabel: "Reading stored summaries for the selected week",
    minDurationMs: 900,
    hint: "~1s",
  },
  {
    phase: "pattern_detection",
    status: "Scanning for recurring patterns...",
    label: "Pattern detection",
    sublabel: "Cross-thread frequency and recurrence analysis",
    minDurationMs: 1800,
    hint: "~2s",
  },
  {
    phase: "cross_domain_mapping",
    status: "Mapping cross-domain echoes...",
    label: "Cross-domain mapping",
    sublabel: "Structural isomorphism detection",
    minDurationMs: 2500,
    hint: "~2.5s",
  },
  {
    phase: "composing_and_persisting",
    status: "Composing and writing digest...",
    label: "Composing and persisting",
    sublabel: "Digest composition and persistence",
    minDurationMs: 1300,
    hint: "~1s",
  },
];

interface ThreadPhaseDefinition {
  status: string;
  label: string;
  sublabel: string;
  hint: string;
  maxElapsedMs: number;
}

const THREAD_PHASES: ThreadPhaseDefinition[] = [
  {
    status: "Preparing conversation context...",
    label: "Initialising pipeline",
    sublabel: "Checking cache and waking context window",
    hint: "~1s",
    maxElapsedMs: 1200,
  },
  {
    status: "Distilling core logic...",
    label: "Distilling logic",
    sublabel: "Tracing what changed across turns",
    hint: "~2s",
    maxElapsedMs: 3600,
  },
  {
    status: "Curating structured summary...",
    label: "Curating summary",
    sublabel: "Building journey steps and insight glossary",
    hint: "~2s",
    maxElapsedMs: 6200,
  },
  {
    status: "Finalising and persisting...",
    label: "Finalising artefacts",
    sublabel: "Writing storage record and refreshing card",
    hint: "~1s",
    maxElapsedMs: Number.POSITIVE_INFINITY,
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("STORAGE_HARD_LIMIT_REACHED")) {
      return "Storage limit reached (1GB). Export or clear data in the Data tab.";
    }
    return error.message;
  }
  return String(error);
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPreviousNaturalWeekRangeLocal(referenceDate = new Date()): {
  rangeStart: number;
  rangeEnd: number;
} {
  const cursor = new Date(referenceDate);
  const localDay = cursor.getDay();
  const daysSinceMonday = (localDay + 6) % 7;

  const currentWeekMonday = new Date(cursor);
  currentWeekMonday.setHours(0, 0, 0, 0);
  currentWeekMonday.setDate(currentWeekMonday.getDate() - daysSinceMonday);

  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(previousWeekMonday.getDate() - 7);

  const previousWeekSunday = new Date(previousWeekMonday);
  previousWeekSunday.setDate(previousWeekSunday.getDate() + 6);
  previousWeekSunday.setHours(23, 59, 59, 999);

  return {
    rangeStart: previousWeekMonday.getTime(),
    rangeEnd: previousWeekSunday.getTime(),
  };
}

function formatWeekRangeLabel(rangeStart: number, rangeEnd: number): string {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const sameYear = start.getFullYear() === end.getFullYear();

  const startText = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const endText = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (sameYear) {
    return `${startText} - ${endText}, ${end.getFullYear()}`;
  }

  const startWithYear = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const endWithYear = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startWithYear} - ${endWithYear}`;
}

function formatTimer(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function parsePlainTextLines(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getThreadPhaseIndex(elapsedMs: number): number {
  for (let index = 0; index < THREAD_PHASES.length; index += 1) {
    if (elapsedMs <= THREAD_PHASES[index].maxElapsedMs) {
      return index;
    }
  }
  return THREAD_PHASES.length - 1;
}

function toDepthLabel(depth: "superficial" | "moderate" | "deep"): string {
  if (depth === "deep") return "深度拆解";
  if (depth === "moderate") return "逐步深挖";
  return "轻量梳理";
}

function getPlatformBadgeClass(platform: Platform): string {
  switch (platform) {
    case "Gemini":
      return "ins-platform-badge-gemini";
    case "Claude":
      return "ins-platform-badge-claude";
    default:
      return "ins-platform-badge-gpt";
  }
}

function formatConversationWeekday(conversation: Conversation): string {
  const ts = conversation.source_created_at ?? conversation.updated_at;
  return new Date(ts).toLocaleDateString("en-US", { weekday: "short" });
}

function toThreadSummaryUiState(
  conversation: Conversation | null,
  summaryStatus: AsyncStatus,
  summaryData: ReturnType<typeof toChatSummaryData> | null
): ThreadSummaryUiState {
  if (!conversation) return "no_thread";

  if (summaryData) {
    if (summaryStatus === "loading") return "ready_loading";
    if (summaryStatus === "error") return "ready_error";
    return "ready";
  }

  if (summaryStatus === "loading") return "selected_loading";
  if (summaryStatus === "error") return "selected_error";
  return "selected_idle";
}

function toWeeklyStableState(data: WeeklySummaryData | null): WeeklyStableUiState {
  if (!data) return "idle";
  return data.insufficient_data ? "sparse_week" : "ready";
}

interface InsightsPageProps {
  conversation: Conversation | null;
  refreshToken: number;
}

export function InsightsPage({ conversation, refreshToken }: InsightsPageProps) {
  const [summary, setSummary] = useState<SummaryRecord | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<AsyncStatus>("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportRecord | null>(null);
  const [weeklyUiState, setWeeklyUiState] = useState<WeeklyDigestUiState>("idle");
  const [weeklyStableState, setWeeklyStableState] = useState<WeeklyStableUiState>("idle");
  const [weeklyError, setWeeklyError] = useState<string | null>(null);

  const [weeklyConversations, setWeeklyConversations] = useState<Conversation[]>([]);
  const [isWeeklyListExpanded, setIsWeeklyListExpanded] = useState(false);

  const [weeklyPhase, setWeeklyPhase] =
    useState<WeeklyGenerationPhase>("ready_to_compile");
  const [weeklyGenerationStartedAt, setWeeklyGenerationStartedAt] =
    useState<number | null>(null);
  const [weeklyElapsedMs, setWeeklyElapsedMs] = useState(0);
  const [threadGenerationStartedAt, setThreadGenerationStartedAt] =
    useState<number | null>(null);
  const [threadElapsedMs, setThreadElapsedMs] = useState(0);

  const [threadSummaryOpen, setThreadSummaryOpen] = useState(true);
  const [weeklyDigestOpen, setWeeklyDigestOpen] = useState(true);

  const weeklyStableRef = useRef<WeeklyStableUiState>("idle");
  const weeklyUiStateRef = useRef<WeeklyDigestUiState>("idle");
  const weeklyHasReportRef = useRef(false);
  const weeklyGenerationRunRef = useRef(0);

  const weekAnchorKey = new Date().toDateString();
  const weeklyRange = useMemo(
    () => getPreviousNaturalWeekRangeLocal(new Date()),
    [weekAnchorKey]
  );

  const summaryData = useMemo(
    () =>
      summary
        ? toChatSummaryData(summary, {
            conversationTitle: conversation?.title,
          })
        : null,
    [summary, conversation?.title]
  );

  const weeklyData = useMemo(
    () => (weeklyReport ? toWeeklySummaryData(weeklyReport) : null),
    [weeklyReport]
  );

  const threadSummaryUiState = toThreadSummaryUiState(
    conversation,
    summaryStatus,
    summaryData
  );
  const threadJourneySteps = summaryData?.thinking_journey ?? [];
  const threadInsightItems = summaryData?.key_insights ?? [];
  const threadUnresolvedItems = summaryData?.unresolved_threads ?? [];
  const threadNextStepItems = summaryData?.actionable_next_steps ?? [];
  const threadRealWorldAnchors = threadJourneySteps
    .map((step) => step.real_world_anchor)
    .filter((anchor): anchor is string => Boolean(anchor && anchor.trim().length > 0));
  const threadPhaseIndex =
    summaryStatus === "loading"
      ? getThreadPhaseIndex(threadElapsedMs)
      : threadGenerationStartedAt
        ? getThreadPhaseIndex(threadElapsedMs)
        : -1;
  const threadStatusText =
    threadPhaseIndex >= 0
      ? THREAD_PHASES[threadPhaseIndex]?.status ?? "Generating summary..."
      : "Ready to generate.";

  const weeklyRangeLabel =
    weeklyData?.meta.range_label ??
    formatWeekRangeLabel(weeklyRange.rangeStart, weeklyRange.rangeEnd);

  const weeklyThreadCount = weeklyConversations.length;
  const weeklyCountLabel = `${weeklyThreadCount} thread${
    weeklyThreadCount === 1 ? "" : "s"
  }`;

  const sortedWeeklyConversations = useMemo(() => {
    return [...weeklyConversations].sort((a, b) => {
      const left = a.source_created_at ?? a.updated_at;
      const right = b.source_created_at ?? b.updated_at;
      return right - left;
    });
  }, [weeklyConversations]);

  const visibleWeeklyConversations = isWeeklyListExpanded
    ? sortedWeeklyConversations
    : sortedWeeklyConversations.slice(0, COLLAPSE_AT);

  const hiddenWeeklyConversationCount = Math.max(
    sortedWeeklyConversations.length - COLLAPSE_AT,
    0
  );

  const turnCount = conversation
    ? resolveTurnCount(conversation.turn_count, conversation.message_count)
    : 0;

  const weeklyPhaseIndex = WEEKLY_PHASES.findIndex(
    (phase) => phase.phase === weeklyPhase
  );

  const weeklyStatusText =
    weeklyPhase === "ready_to_compile"
      ? "Ready to compile weekly digest."
      : WEEKLY_PHASES.find((phase) => phase.phase === weeklyPhase)?.status ??
        "Generating digest...";

  const weeklyHighlightItems =
    weeklyData?.highlights && weeklyData.highlights.length > 0
      ? weeklyData.highlights
      : parsePlainTextLines(weeklyData?.plain_text).slice(0, 3);

  const weeklyRecurringItems = weeklyData?.recurring_questions ?? [];
  const weeklyCrossDomainEchoes = weeklyData?.cross_domain_echoes ?? [];
  const weeklyUnresolvedItems = weeklyData?.unresolved_threads ?? [];
  const weeklyNextWeekItems = weeklyData?.suggested_focus ?? [];
  const weeklyQualityDegraded =
    Boolean(weeklyData?.insufficient_data) && weeklyReport?.status === "fallback";

  useEffect(() => {
    weeklyStableRef.current = weeklyStableState;
  }, [weeklyStableState]);

  useEffect(() => {
    weeklyUiStateRef.current = weeklyUiState;
  }, [weeklyUiState]);

  useEffect(() => {
    weeklyHasReportRef.current = Boolean(weeklyReport);
  }, [weeklyReport]);

  useEffect(() => {
    return () => {
      weeklyGenerationRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!weeklyGenerationStartedAt) {
      setWeeklyElapsedMs(0);
      return;
    }

    const tick = () => {
      setWeeklyElapsedMs(Date.now() - weeklyGenerationStartedAt);
    };

    tick();
    const timerId = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [weeklyGenerationStartedAt]);

  useEffect(() => {
    if (summaryStatus === "loading") {
      setThreadGenerationStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setThreadGenerationStartedAt(null);
    setThreadElapsedMs(0);
  }, [summaryStatus]);

  useEffect(() => {
    if (!threadGenerationStartedAt) {
      setThreadElapsedMs(0);
      return;
    }

    const tick = () => {
      setThreadElapsedMs(Date.now() - threadGenerationStartedAt);
    };

    tick();
    const timerId = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [threadGenerationStartedAt]);

  useEffect(() => {
    if (!conversation) {
      setSummary(null);
      setSummaryStatus("idle");
      setSummaryError(null);
      return;
    }

    let active = true;
    setSummaryStatus("loading");
    setSummaryError(null);

    getConversationSummary(conversation.id)
      .then((data) => {
        if (!active) return;
        setSummary(data);
        setSummaryStatus(data ? "ready" : "idle");
      })
      .catch((error) => {
        if (!active) return;
        setSummary(null);
        setSummaryStatus("error");
        setSummaryError(getErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, [conversation?.id, refreshToken]);

  useEffect(() => {
    let active = true;

    getConversations({
      dateRange: {
        start: weeklyRange.rangeStart,
        end: weeklyRange.rangeEnd,
      },
    })
      .then((items) => {
        if (!active) return;
        setWeeklyConversations(items.filter((item) => !item.is_trash));
        setIsWeeklyListExpanded(false);
      })
      .catch(() => {
        if (!active) return;
        setWeeklyConversations([]);
        setIsWeeklyListExpanded(false);
      });

    return () => {
      active = false;
    };
  }, [refreshToken, weeklyRange.rangeStart, weeklyRange.rangeEnd]);

  useEffect(() => {
    if (weeklyUiStateRef.current === "generating") {
      return;
    }

    let active = true;
    setWeeklyError(null);

    getWeeklyReport(weeklyRange.rangeStart, weeklyRange.rangeEnd)
      .then((data) => {
        if (!active) return;
        setWeeklyReport(data);
        const nextData = data ? toWeeklySummaryData(data) : null;
        const nextStableState = toWeeklyStableState(nextData);
        setWeeklyStableState(nextStableState);
        setWeeklyUiState(nextStableState);
        setWeeklyPhase("ready_to_compile");
      })
      .catch((error) => {
        if (!active) return;
        setWeeklyError(getErrorMessage(error));
        setWeeklyUiState(weeklyHasReportRef.current ? weeklyStableRef.current : "error");
      });

    return () => {
      active = false;
    };
  }, [refreshToken, weeklyRange.rangeStart, weeklyRange.rangeEnd]);

  const handleGenerateSummary = async () => {
    if (!conversation) return;

    setThreadSummaryOpen(true);
    setThreadGenerationStartedAt(Date.now());
    setThreadElapsedMs(0);
    setSummaryStatus("loading");
    setSummaryError(null);

    try {
      const data = await generateConversationSummary(conversation.id);
      setSummary(data);
      setSummaryStatus("ready");
    } catch (error) {
      setSummaryStatus("error");
      setSummaryError(getErrorMessage(error));
    }
  };

  const handleGenerateWeekly = async () => {
    const runId = weeklyGenerationRunRef.current + 1;
    weeklyGenerationRunRef.current = runId;

    setWeeklyDigestOpen(true);
    setWeeklyUiState("generating");
    setWeeklyError(null);
    setWeeklyPhase("ready_to_compile");
    setWeeklyGenerationStartedAt(Date.now());

    const requestPromise = generateWeeklyReport(
      weeklyRange.rangeStart,
      weeklyRange.rangeEnd
    )
      .then((data) => ({ ok: true as const, data }))
      .catch((error) => ({ ok: false as const, error }));

    for (const phase of WEEKLY_PHASES) {
      if (weeklyGenerationRunRef.current !== runId) {
        return;
      }
      setWeeklyPhase(phase.phase);
      await sleep(phase.minDurationMs);
    }

    if (weeklyGenerationRunRef.current !== runId) {
      return;
    }

    const result = await requestPromise;

    if (weeklyGenerationRunRef.current !== runId) {
      return;
    }

    setWeeklyGenerationStartedAt(null);
    setWeeklyPhase("ready_to_compile");

    if (result.ok) {
      setWeeklyReport(result.data);
      const nextData = toWeeklySummaryData(result.data);
      const nextStableState = toWeeklyStableState(nextData);
      setWeeklyStableState(nextStableState);
      setWeeklyUiState(nextStableState);
      setWeeklyError(null);
      return;
    }

    const nextError = getErrorMessage(result.error);
    setWeeklyError(nextError);

    if (weeklyData) {
      setWeeklyUiState(weeklyStableState);
    } else {
      setWeeklyUiState("error");
    }
  };

  const renderThreadContext = () => {
    if (!conversation) return null;

    return (
      <div className="ins-thread-ctx">
        <span className="ins-thread-platform">{conversation.platform}</span>
        <div className="min-w-0 flex-1">
          <p className="ins-thread-title line-clamp-2">{conversation.title}</p>
          <p className="ins-thread-meta">
            {conversation.message_count} messages - {turnCount} turns
          </p>
        </div>
      </div>
    );
  };

  const renderThreadSummaryBody = () => {
    if (threadSummaryUiState === "no_thread") {
      return (
        <p className="ins-empty">
          Select a thread from Threads to generate a summary.
        </p>
      );
    }

    const showGeneratingShell =
      threadSummaryUiState === "selected_loading" ||
      threadSummaryUiState === "ready_loading";
    const showReadyShell =
      threadSummaryUiState === "ready" ||
      threadSummaryUiState === "ready_loading" ||
      threadSummaryUiState === "ready_error";

    return (
      <div className="flex flex-col gap-2">
        {renderThreadContext()}

        {showGeneratingShell && (
          <div className="ins-thread-gen-shell">
            <div className="ins-thread-gen-header">
              <span className="ins-thread-wand-wrap" aria-hidden="true">
                <span className="ins-thread-wand-ring" />
                <span className="ins-thread-wand-chip">
                  <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="ins-thread-status-copy">{threadStatusText}</p>
              </div>

              <span className="ins-thread-timer">{formatTimer(threadElapsedMs)}</span>
            </div>

            <div className="ins-thread-phase-track">
              {THREAD_PHASES.map((phase, index) => {
                const rowState =
                  threadPhaseIndex > index
                    ? "ins-thread-phase-done"
                    : threadPhaseIndex === index
                      ? "ins-thread-phase-active"
                      : "ins-thread-phase-idle";
                return (
                  <div key={phase.label} className={`ins-thread-phase-row ${rowState}`}>
                    <span className="ins-thread-phase-dot" />
                    <span className="min-w-0 flex-1">
                      <span className="ins-thread-phase-label">{phase.label}</span>
                      <span className="ins-thread-phase-sublabel">{phase.sublabel}</span>
                    </span>
                    <span className="ins-thread-phase-time">{phase.hint}</span>
                    <span className="ins-thread-phase-tick">OK</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showReadyShell && summaryData && (
          <div className="ins-thread-ready-shell">
            <section className="ins-thread-core-card">
              <p className="ins-thread-core-label">{"\u6838\u5fc3\u95ee\u9898"}</p>
              <p className="ins-thread-core-text">{summaryData.core_question}</p>
            </section>

            {threadJourneySteps.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{"\u601d\u8003\u8f68\u8ff9"}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadJourneySteps.length}</span>
                </div>
                <div className="ins-thread-journey-list">
                  {threadJourneySteps.map((step) => (
                    <article
                      key={`${step.step}-${step.speaker}-${step.assertion}`}
                      className={`ins-thread-step-card ${
                        step.speaker === "User" ? "ins-thread-step-user" : "ins-thread-step-ai"
                      }`}
                    >
                      <div className="ins-thread-step-head">
                        <span className="ins-thread-step-num">
                          {String(step.step).padStart(2, "0")}
                        </span>
                        <span
                          className={`ins-thread-speaker-chip ${
                            step.speaker === "User"
                              ? "ins-thread-speaker-user"
                              : "ins-thread-speaker-ai"
                          }`}
                        >
                          {step.speaker === "User" ? "\u4f60" : "\u52a9\u624b"}
                        </span>
                      </div>
                      <p className="ins-thread-step-assertion">{step.assertion}</p>

                      {step.real_world_anchor && (
                        <div className="ins-thread-anchor-card">
                          <p className="ins-thread-anchor-label">{"\u5b9e\u8bc1\u6848\u4f8b"}</p>
                          <p className="ins-thread-anchor-text">{step.real_world_anchor}</p>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadInsightItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{"\u5173\u952e\u6d1e\u5bdf"}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadInsightItems.length}</span>
                </div>
                <div className="ins-thread-insight-list">
                  {threadInsightItems.map((item, index) => (
                    <article className="ins-thread-insight-card" key={`${item.term}-${index}`}>
                      <p className="ins-thread-insight-term">{item.term}</p>
                      <p className="ins-thread-insight-def">{item.definition}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadUnresolvedItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{"\u672a\u89e3\u95ee\u9898"}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadUnresolvedItems.length}</span>
                </div>
                <div className="ins-thread-unresolved-list">
                  {threadUnresolvedItems.map((item, index) => (
                    <article className="ins-thread-unresolved-item" key={`${item}-${index}`}>
                      <span className="ins-thread-unresolved-dot" />
                      <p className="ins-thread-unresolved-text">{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadNextStepItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{"\u4e0b\u4e00\u6b65\u5efa\u8bae"}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadNextStepItems.length}</span>
                </div>
                <div className="ins-thread-next-list">
                  {threadNextStepItems.map((item, index) => (
                    <article className="ins-thread-next-item" key={`${item}-${index}`}>
                      <span className="ins-thread-next-arrow">-&gt;</span>
                      <p className="ins-thread-next-text">{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="ins-thread-sec-head">
                <span className="ins-thread-sec-label">{"\u601d\u7ef4\u4fa7\u5199"}</span>
                <span className="ins-thread-sec-line" />
              </div>
              <div className="ins-thread-meta-row">
                <span className="ins-thread-meta-chip ins-thread-meta-chip-depth">
                  {toDepthLabel(summaryData.meta_observations.depth_level)}
                </span>
                <span className="ins-thread-meta-chip">
                  {summaryData.meta_observations.thinking_style}
                </span>
                <span className="ins-thread-meta-chip">
                  {summaryData.meta_observations.emotional_tone}
                </span>
              </div>
            </section>

            {threadRealWorldAnchors.length > 0 && (
              <p className="ins-meta-line">
                {"\u5b9e\u8bc1\u6848\u4f8b\u8986\u76d6 "}
                {threadRealWorldAnchors.length}
                {" \u4e2a\u63a8\u7406\u8282\u70b9\u3002"}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerateSummary}
          disabled={summaryStatus === "loading"}
          className="ins-generate-btn"
        >
          {summaryStatus === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-primary" />
          ) : (
            <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          )}
          {summaryData ? "Regenerate" : "Generate Summary"}
        </button>

        {(threadSummaryUiState === "selected_idle" ||
          threadSummaryUiState === "selected_error") && (
          <p className="ins-empty ins-empty-left">
            No summary yet. Click Generate Summary to begin.
          </p>
        )}

        {(threadSummaryUiState === "selected_error" ||
          threadSummaryUiState === "ready_error") && (
          <p className="ins-status-row ins-status-error">
            Failed to generate summary. {summaryError}
            <button
              type="button"
              onClick={handleGenerateSummary}
              className="ins-inline-link"
            >
              Retry
            </button>
          </p>
        )}

        {summary && (
          <p className="ins-meta-line">
            Model: {summary.modelId} - Generated: {formatDateTime(summary.createdAt)}
          </p>
        )}
      </div>
    );
  };

  const renderWeeklyIdle = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">{weeklyCountLabel}</span>
        </div>

        <div className="ins-week-thread-list">
          {visibleWeeklyConversations.map((item) => (
            <div className="ins-week-thread-row" key={item.id}>
              <span
                className={`ins-platform-badge ${getPlatformBadgeClass(
                  item.platform
                )}`}
              >
                {item.platform}
              </span>
              <p className="ins-week-thread-title">{item.title}</p>
              <span className="ins-week-thread-day">
                {formatConversationWeekday(item)}
              </span>
            </div>
          ))}

          {hiddenWeeklyConversationCount > 0 && (
            <button
              type="button"
              onClick={() => setIsWeeklyListExpanded((prev) => !prev)}
              className="ins-week-toggle"
            >
              <span className="ins-week-toggle-line" />
              <span className="ins-week-toggle-label">
                {isWeeklyListExpanded
                  ? "Collapse"
                  : `${hiddenWeeklyConversationCount} more`}
              </span>
              <span className="ins-week-toggle-line" />
            </button>
          )}

          {sortedWeeklyConversations.length === 0 && (
            <p className="ins-empty">No captured threads in this week yet.</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-week-generate-trigger"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 ins-week-generate-trigger-icon" />
          <span className="ins-week-generate-trigger-text">
            Generate digest for this week
          </span>
        </button>
      </>
    );
  };

  const renderWeeklyGenerating = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">{weeklyCountLabel}</span>
        </div>

        <div className="ins-week-gen-shell">
          <div className="ins-week-gen-header">
            <span className="ins-week-wand-wrap" aria-hidden="true">
              <span className="ins-week-wand-ring" />
              <span className="ins-week-wand-chip">
                <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
              </span>
            </span>

            <div className="min-w-0 flex-1">
              <p className="ins-week-status-copy">{weeklyStatusText}</p>
            </div>

            <span className="ins-week-timer">{formatTimer(weeklyElapsedMs)}</span>
          </div>

          <div className="ins-week-phase-track">
            {WEEKLY_PHASES.map((phase, index) => {
              const rowState =
                weeklyPhaseIndex > index
                  ? "ins-week-phase-done"
                  : weeklyPhaseIndex === index
                    ? "ins-week-phase-active"
                    : "ins-week-phase-idle";

              return (
                <div key={phase.phase} className={`ins-week-phase-row ${rowState}`}>
                  <span className="ins-week-phase-dot" />
                  <span className="min-w-0 flex-1">
                    <span className="ins-week-phase-label">{phase.label}</span>
                    <span className="ins-week-phase-sublabel">{phase.sublabel}</span>
                  </span>
                  <span className="ins-week-phase-time">{phase.hint}</span>
                  <span className="ins-week-phase-tick">OK</span>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  const renderWeeklyReady = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">{weeklyCountLabel}</span>
        </div>

        {weeklyError && (
          <p className="ins-status-row ins-status-error ins-week-inline-gap">
            Latest regeneration failed. {weeklyError}
            <button
              type="button"
              onClick={handleGenerateWeekly}
              className="ins-inline-link"
            >
              Retry
            </button>
          </p>
        )}

        <div className="ins-week-ready-shell">
          {weeklyHighlightItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">Highlights</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-highlight-list">
                {weeklyHighlightItems.map((item, index) => (
                  <article className="ins-week-highlight-item" key={`${item}-${index}`}>
                    <p className="ins-week-highlight-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyRecurringItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">Recurring Questions</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-recurring-list">
                {weeklyRecurringItems.map((item, index) => (
                  <article className="ins-week-recurring-item" key={`${item}-${index}`}>
                    <span className="ins-week-recurring-mark">"</span>
                    <p className="ins-week-recurring-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyCrossDomainEchoes.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">Cross-Domain Echo</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-echo-list">
                {weeklyCrossDomainEchoes.map((echo, index) => (
                  <article className="ins-week-echo-card" key={`${echo.domain_a}-${index}`}>
                    <div className="ins-week-echo-domains">
                      <span className="ins-week-echo-domain-tag">{echo.domain_a}</span>
                      <span className="ins-week-echo-arrow">&lt;-&gt;</span>
                      <span className="ins-week-echo-domain-tag">{echo.domain_b}</span>
                    </div>
                    <p className="ins-week-echo-label">Shared logic</p>
                    <p className="ins-week-echo-text">{echo.shared_logic}</p>
                    {echo.evidence_ids.length > 0 && (
                      <div className="ins-week-ref-list">
                        {echo.evidence_ids.map((id) => (
                          <span key={id} className="ins-week-ref-chip">
                            Thread {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyUnresolvedItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">Unresolved</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-unresolved-list">
                {weeklyUnresolvedItems.map((item, index) => (
                  <article className="ins-week-unresolved-item" key={`${item}-${index}`}>
                    <span className="ins-week-unresolved-dot" />
                    <p className="ins-week-unresolved-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyNextWeekItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">Next Week</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-focus-list">
                {weeklyNextWeekItems.map((item, index) => (
                  <article className="ins-week-focus-item" key={`${item}-${index}`}>
                    <span className="ins-week-focus-arrow">-&gt;</span>
                    <p className="ins-week-focus-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-generate-btn"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          Regenerate
        </button>

        {weeklyReport && (
          <p className="ins-meta-line">
            Model: {weeklyReport.modelId} - Generated: {formatDateTime(weeklyReport.createdAt)}
          </p>
        )}
      </>
    );
  };

  const renderWeeklySparse = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">{weeklyCountLabel}</span>
        </div>

        {weeklyError && (
          <p className="ins-status-row ins-status-error ins-week-inline-gap">
            Latest regeneration failed. {weeklyError}
            <button
              type="button"
              onClick={handleGenerateWeekly}
              className="ins-inline-link"
            >
              Retry
            </button>
          </p>
        )}

        <div className="ins-week-sparse-card">
          <p className="ins-week-sparse-title">
            Not enough data to generate this week&apos;s digest
          </p>
          <p className="ins-week-sparse-body">
            This week has fewer than 3 substantial threads. Weekly Digest will resume
            automatically when enough data is captured.
          </p>
          {weeklyQualityDegraded && (
            <p className="ins-week-quality-note">
              Structured output was downgraded by semantic quality gate to avoid
              low-signal fragments.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-generate-btn"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          Regenerate
        </button>
      </>
    );
  };

  const renderWeeklyError = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">{weeklyCountLabel}</span>
        </div>

        <div className="ins-summary-result">
          <p className="ins-status-row ins-status-error">
            Failed to generate weekly digest. {weeklyError ?? "Unknown error."}
          </p>
          <button
            type="button"
            onClick={handleGenerateWeekly}
            className="ins-generate-btn ins-week-inline-gap"
          >
            <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
            Retry
          </button>
        </div>
      </>
    );
  };

  const renderWeeklyBody = () => {
    if (weeklyUiState === "generating") {
      return renderWeeklyGenerating();
    }

    if (weeklyUiState === "ready") {
      return renderWeeklyReady();
    }

    if (weeklyUiState === "sparse_week") {
      return renderWeeklySparse();
    }

    if (weeklyUiState === "error") {
      return renderWeeklyError();
    }

    return renderWeeklyIdle();
  };

  return (
    <div className="vesti-shell flex h-full flex-col overflow-y-auto vesti-scroll bg-bg-app">
      <header className="border-b border-border-subtle px-4 py-3">
        <h1 className="vesti-page-title text-text-primary">Insights</h1>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <p className="ins-group-label">On-demand</p>

        <InsightsAccordionItem
          title="Thread Summary"
          description="AI-generated digest of the active thread"
          open={threadSummaryOpen}
          onToggle={() => setThreadSummaryOpen((prev) => !prev)}
          icon={
            <span className="relative inline-flex h-4 w-4 items-center justify-center">
              <FileText className="h-4 w-4" strokeWidth={1.5} />
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            </span>
          }
        >
          {renderThreadSummaryBody()}
        </InsightsAccordionItem>

        <p className="ins-group-label">Scheduled</p>

        <InsightsAccordionItem
          title="Weekly Digest"
          description="Highlights from the past seven days"
          open={weeklyDigestOpen}
          onToggle={() => setWeeklyDigestOpen((prev) => !prev)}
          icon={<CalendarDays className="h-4 w-4" strokeWidth={1.5} />}
        >
          {renderWeeklyBody()}
        </InsightsAccordionItem>

        <p className="ins-group-label">Discovery</p>

        <InsightsAccordionItem
          title="Explore & Network"
          description="Knowledge graph and thread connections"
          icon={<Network className="h-4 w-4" strokeWidth={1.5} />}
          disabled
          soonTag="Soon"
        />
      </div>
    </div>
  );
}
