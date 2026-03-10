import { resolveCurrentApiConfig } from './claudeSettings';
import { coworkLog } from './coworkLogger';

const COMPACT_TIMEOUT_MS = 30000;
const SUMMARY_MAX_TOKENS = 2048;

const SUMMARIZE_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a concise summary of the conversation history that preserves essential context for continuing the work.`;

const SUMMARIZE_USER_PROMPT = `Please summarize the following conversation history concisely. Preserve:
1. The user's core goals and requirements
2. Completed work (which files were modified, what changes were made)
3. Current in-progress tasks
4. Important technical decisions and constraints
5. Key file paths and code locations
6. Any errors or issues encountered

Keep the summary under 2000 characters. Output the summary directly without any preamble.

<conversation>
{CONVERSATION}
</conversation>`;

interface CompactResult {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensFreed: number;
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/messages';
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function extractTextFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const block = item as Record<string, unknown>;
        return typeof block.text === 'string' ? block.text : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof content === 'string') return content.trim();
  return '';
}

export interface CoworkMessageLike {
  type: string;
  content: string;
}

function formatMessagesForSummary(messages: CoworkMessageLike[]): string {
  const MAX_CONTENT_CHARS = 120000;
  const USER_MAX_CHARS = 4000;
  const ASSISTANT_MAX_CHARS = 2000;
  let totalChars = 0;
  const parts: string[] = [];

  // Iterate from newest to oldest to prioritize recent context
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg.content?.trim()) continue;
    const role = msg.type === 'user' ? 'User' : msg.type === 'assistant' ? 'Assistant' : msg.type;
    const maxChars = msg.type === 'assistant' ? ASSISTANT_MAX_CHARS : USER_MAX_CHARS;
    const content = msg.content.length > maxChars ? msg.content.slice(0, maxChars) + '...[truncated]' : msg.content;
    const part = `[${role}]: ${content}`;
    if (totalChars + part.length > MAX_CONTENT_CHARS) break;
    parts.push(part);
    totalChars += part.length;
  }

  // Reverse to maintain chronological order for the LLM
  return parts.reverse().join('\n\n');
}

export async function summarizeConversation(messages: CoworkMessageLike[]): Promise<CompactResult> {
  // Calculate original total chars before truncation for accurate token estimation
  const originalTotalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const conversationText = formatMessagesForSummary(messages);
  if (!conversationText) {
    throw new Error('No conversation content to summarize');
  }

  const { config, error } = resolveCurrentApiConfig();
  if (!config) {
    throw new Error(`Cannot summarize: API config not available${error ? ` (${error})` : ''}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMPACT_TIMEOUT_MS);

  try {
    const url = buildAnthropicMessagesUrl(config.baseURL);
    const userPrompt = SUMMARIZE_USER_PROMPT.replace('{CONVERSATION}', conversationText);

    coworkLog('INFO', 'contextCompact', 'Starting conversation summarization', {
      messageCount: messages.length,
      conversationChars: conversationText.length,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: 0,
        system: SUMMARIZE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Summarization API failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const payload = await response.json();
    const summary = extractTextFromResponse(payload);

    if (!summary) {
      throw new Error('Summarization returned empty result');
    }

    // Estimate tokens from original message chars (not truncated text)
    const tokensBefore = Math.round(originalTotalChars / 4);
    const tokensAfter = Math.round(summary.length / 4);
    const tokensFreed = Math.max(0, tokensBefore - tokensAfter);

    coworkLog('INFO', 'contextCompact', 'Conversation summarized', {
      tokensBefore,
      tokensAfter,
      tokensFreed,
      summaryLength: summary.length,
    });

    return { summary, tokensBefore, tokensAfter, tokensFreed };
  } finally {
    clearTimeout(timeoutId);
  }
}
