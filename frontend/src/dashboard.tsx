import "~style.css";

import { VestiDashboard as VestiDashboardShell } from "@vesti/ui";
import { LOGO_BASE64 } from "~lib/ui/logo";
import {
  getConversations,
  getTopics,
  runGardener,
  getRelatedConversations,
  getMessages,
} from "~lib/services/storageService";

export default function VestiDashboardPage() {
  return (
    <VestiDashboardShell
      logoSrc={LOGO_BASE64}
      rootClassName="vesti-options"
      storage={{ getConversations, getTopics, runGardener, getRelatedConversations, getMessages }}
    />
  );
}
