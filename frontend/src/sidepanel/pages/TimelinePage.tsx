import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import type { Conversation, DashboardStats, Platform } from "~lib/types";
import { getDashboardStats } from "~lib/services/storageService";
import { PLATFORM_TONE } from "../components/platformTone";
import { ConversationList } from "../containers/ConversationList";
import {
  DATE_PRESET_OPTIONS,
  PLATFORM_OPTIONS,
  type DatePreset,
  type HeaderMode,
} from "../types/timelineFilters";

interface TimelinePageProps {
  onSelectConversation: (conversation: Conversation) => void;
  refreshToken: number;
}

function toggleSetMember<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
    return next;
  }
  next.add(value);
  return next;
}

export function TimelinePage({ onSelectConversation, refreshToken }: TimelinePageProps) {
  const [headerMode, setHeaderMode] = useState<HeaderMode>("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all_time");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set());
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDashboardStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const todayCount = stats?.todayCount ?? 0;
  const platformDistribution = stats?.platformDistribution ?? null;

  const handleOpenSearch = () => {
    setHeaderMode("search");
  };

  const handleToggleFilter = () => {
    setHeaderMode((prev) => (prev === "filter" ? "default" : "filter"));
  };

  const handleCancelSearch = () => {
    setSearchQuery("");
    setHeaderMode("default");
  };

  return (
    <div className="flex h-full flex-col bg-bg-app">
      {headerMode === "search" ? (
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
          <div className="threads-search-surface flex h-9 flex-1 items-center gap-2 rounded-lg px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-text-secondary" strokeWidth={1.8} />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  handleCancelSearch();
                }
              }}
              placeholder="Search conversations"
              className="h-full w-full bg-transparent text-vesti-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
          <button
            type="button"
            onClick={handleCancelSearch}
            className="rounded-sm px-1 py-1 text-vesti-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
        </header>
      ) : (
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-4">
          <span className="vesti-brand-wordmark vesti-page-title text-text-primary">
            Vesti
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-vesti-xs font-medium text-success/90">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {todayCount} captured today
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Search conversations"
                onClick={handleOpenSearch}
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-bg-secondary hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label="Filter conversations"
                onClick={handleToggleFilter}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                  headerMode === "filter"
                    ? "bg-bg-secondary text-text-primary"
                    : "text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </header>
      )}

      {headerMode === "filter" && (
        <div className="shrink-0 border-b border-border-subtle bg-bg-secondary/40 px-4 py-3">
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-text-secondary">
              Date
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {DATE_PRESET_OPTIONS.map((preset) => {
                const isActive = datePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDatePreset(preset.id)}
                    className={`rounded-full border px-3 py-1 text-vesti-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                      isActive
                        ? "border-border-default bg-bg-primary text-text-primary"
                        : "border-border-subtle text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-3 border-t border-border-subtle pt-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-text-secondary">
              Source
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((platform) => {
                const tone = PLATFORM_TONE[platform];
                const isActive = selectedPlatforms.has(platform);
                const hasData =
                  platformDistribution === null
                    ? true
                    : (platformDistribution[platform] ?? 0) > 0;

                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => {
                      setSelectedPlatforms((prev) => toggleSetMember(prev, platform));
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-vesti-xs font-semibold tracking-[0.02em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                      isActive
                        ? `${tone.bg} ${tone.border} ${tone.text}`
                        : `border-border-subtle bg-transparent text-text-tertiary hover:bg-bg-primary hover:text-text-secondary ${!hasData ? "opacity-45" : ""}`
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {platform}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          headerMode === "search" ? "pt-3" : ""
        }`}
      >
        <ConversationList
          searchQuery={searchQuery}
          datePreset={datePreset}
          selectedPlatforms={selectedPlatforms}
          onSelect={onSelectConversation}
          refreshToken={refreshToken}
        />
      </div>
    </div>
  );
}
