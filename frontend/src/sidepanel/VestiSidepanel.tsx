import { useEffect, useRef, useState } from "react";
import type { Conversation, PageId } from "~lib/types";
import type { InsightPipelineProgressPayload } from "~lib/messaging/protocol";
import { isInsightPipelineProgressMessage } from "~lib/messaging/protocol";
import { Dock } from "./components/Dock";
import { TimelinePage } from "./pages/TimelinePage";
import { InsightsPage } from "./pages/InsightsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReaderView } from "./containers/ReaderView";
import { DataPage } from "./pages/DataPage";

export function VestiSidepanel() {
  const [currentPage, setCurrentPage] = useState<PageId>("timeline");
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pipelineProgressEvent, setPipelineProgressEvent] =
    useState<InsightPipelineProgressPayload | null>(null);
  const latestPipelineSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const handler = (message: unknown) => {
      if (!message || typeof message !== "object") return;

      if (isInsightPipelineProgressMessage(message)) {
        const { pipelineId, seq } = message.payload;
        const lastSeq = latestPipelineSeqRef.current[pipelineId] ?? 0;
        if (seq > lastSeq) {
          latestPipelineSeqRef.current[pipelineId] = seq;
          setPipelineProgressEvent(message.payload);
        }
        return;
      }

      const type = (message as { type?: string }).type;
      if (type === "VESTI_DATA_UPDATED") {
        setRefreshToken(Date.now());
      }
    };
    chrome?.runtime?.onMessage?.addListener(handler);
    return () => {
      chrome?.runtime?.onMessage?.removeListener?.(handler);
    };
  }, []);

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
  };

  const handleBack = () => {
    setSelectedConversation(null);
  };

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page);
  };

  const handleNavigateToData = () => {
    setCurrentPage("data");
  };

  return (
    <div className="flex h-screen w-full bg-bg-tertiary">
      <div className="flex h-full flex-1 overflow-hidden bg-bg-primary">
        <main className="min-w-0 flex-1">
          {currentPage === "timeline" && selectedConversation ? (
            <ReaderView
              conversation={selectedConversation}
              onBack={handleBack}
              refreshToken={refreshToken}
            />
          ) : currentPage === "timeline" ? (
            <TimelinePage
              onSelectConversation={handleSelectConversation}
              refreshToken={refreshToken}
            />
          ) : currentPage === "insights" ? (
            <InsightsPage
              conversation={selectedConversation}
              refreshToken={refreshToken}
              pipelineProgressEvent={pipelineProgressEvent}
            />
          ) : currentPage === "settings" ? (
            <SettingsPage onNavigateToData={handleNavigateToData} />
          ) : currentPage === "data" ? (
            <DataPage />
          ) : null}
        </main>

        <Dock currentPage={currentPage} onNavigate={handleNavigate} />
      </div>
    </div>
  );
}

export default VestiSidepanel;
