'use client';

import { VestiDashboard } from '@vesti/ui';
import {
  getConversations,
  getTopics,
  runGardener,
  getRelatedConversations,
  getMessages,
} from '@/lib/storageService';

export default function VestiDashboardPage() {
  return (
    <VestiDashboard
      logoSrc="/favicon.svg"
      storage={{ getConversations, getTopics, runGardener, getRelatedConversations, getMessages }}
    />
  );
}
