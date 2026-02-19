import type { Conversation, GardenerResult, Platform, Topic } from './types';

type ConversationFilters = {
  platform?: Platform;
  search?: string;
  dateRange?: { start: number; end: number };
};

type RequestMessage =
  | {
      type: 'GET_CONVERSATIONS';
      target?: 'offscreen';
      requestId?: string;
      payload?: ConversationFilters;
    }
  | {
      type: 'GET_TOPICS';
      target?: 'offscreen';
      requestId?: string;
    }
  | {
      type: 'CREATE_TOPIC';
      target?: 'offscreen';
      requestId?: string;
      payload: { name: string; parent_id?: number | null };
    }
  | {
      type: 'UPDATE_CONVERSATION_TOPIC';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number; topic_id: number | null };
    }
  | {
      type: 'RUN_GARDENER';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    };

type ResponseDataMap = {
  GET_CONVERSATIONS: Conversation[];
  GET_TOPICS: Topic[];
  CREATE_TOPIC: { topic: Topic };
  UPDATE_CONVERSATION_TOPIC: { updated: boolean; conversation: Conversation };
  RUN_GARDENER: { updated: boolean; conversation: Conversation; result: GardenerResult };
};

type ResponseMessage<T extends keyof ResponseDataMap = keyof ResponseDataMap> =
  | {
      ok: true;
      type: T;
      requestId?: string;
      data: ResponseDataMap[T];
    }
  | {
      ok: false;
      type: T;
      requestId?: string;
      error: string;
    };

const DEFAULT_TIMEOUT_MS = 4000;

function assertChromeRuntime(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('CHROME_RUNTIME_UNAVAILABLE');
  }
}

function sendMessageWithTimeout<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ResponseMessage<T>> {
  assertChromeRuntime();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response: ResponseMessage<T>) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function sendRequest<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs?: number
): Promise<ResponseDataMap[T]> {
  const response = await sendMessageWithTimeout<T>(message, timeoutMs);
  if (!response.ok) {
    const failure = response as Extract<ResponseMessage<T>, { ok: false }>;
    throw new Error(failure.error || 'Request failed');
  }
  return response.data;
}

export async function getConversations(
  filters?: ConversationFilters
): Promise<Conversation[]> {
  return sendRequest({
    type: 'GET_CONVERSATIONS',
    target: 'offscreen',
    payload: filters,
  }) as Promise<Conversation[]>;
}

export async function getTopics(): Promise<Topic[]> {
  return sendRequest({
    type: 'GET_TOPICS',
    target: 'offscreen',
  }) as Promise<Topic[]>;
}

export async function createTopic(
  name: string,
  parent_id?: number | null
): Promise<Topic> {
  const result = (await sendRequest({
    type: 'CREATE_TOPIC',
    target: 'offscreen',
    payload: { name, parent_id },
  })) as { topic: Topic };
  return result.topic;
}

export async function updateConversationTopic(
  id: number,
  topic_id: number | null
): Promise<Conversation> {
  const result = (await sendRequest({
    type: 'UPDATE_CONVERSATION_TOPIC',
    target: 'offscreen',
    payload: { id, topic_id },
  })) as { updated: boolean; conversation: Conversation };
  return result.conversation;
}

export async function runGardener(
  conversationId: number
): Promise<{ updated: boolean; conversation: Conversation; result: GardenerResult }> {
  const result = (await sendRequest({
    type: 'RUN_GARDENER',
    target: 'offscreen',
    payload: { conversationId },
  })) as { updated: boolean; conversation: Conversation; result: GardenerResult };

  if (result.updated && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result;
}
