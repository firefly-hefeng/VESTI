import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getPrompt } from "../frontend/src/lib/prompts";
import type { WeeklyLiteReportV1 } from "../frontend/src/lib/types";

type Mode = "auto" | "live" | "mock";
type Variant = "current" | "experimental";

type Cli = { mode: Mode; variant: Variant; updateBaseline: boolean; strict: boolean; debugRaw: boolean; throttleMs: number; caseFilter: string; limit: number; caseDelayMs: number };

const STRICT_JSON =
  "Output must be valid JSON only. Do not include markdown, code fences, or extra text.";

const args = process.argv.slice(2);
const cli: Cli = {
  mode: (args.find((a) => a.startsWith("--mode="))?.split("=")[1] as Mode) || "auto",
  variant:
    (args.find((a) => a.startsWith("--variant="))?.split("=")[1] as Variant) || "current",
  updateBaseline: args.includes("--update-baseline"),
  strict: args.includes("--strict"),
  debugRaw: args.includes("--debug-raw"),
  throttleMs: Number(args.find((a) => a.startsWith("--throttle-ms="))?.split("=")[1] || "0"),
  caseFilter: args.find((a) => a.startsWith("--case="))?.split("=")[1] || "",
  limit: Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0"),
  caseDelayMs: Number(args.find((a) => a.startsWith("--case-delay-ms="))?.split("=")[1] || "0"),
};

function rootDir(): string {
  if (process.env.VESTI_ROOT) return path.resolve(process.env.VESTI_ROOT);
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "frontend", "package.json"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "frontend", "package.json"))) return parent;
  throw new Error("Cannot detect workspace root. Set VESTI_ROOT.");
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function listJson<T>(dir: string): T[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => readJson<T>(path.join(dir, n)));
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function pickList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of v) {
    const t = typeof i === "string" ? i.replace(/\s+/g, " ").trim() : "";
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function isLowSignalNarrativeItem(value: string): boolean {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return true;
  if (/^[^A-Za-z0-9\u3400-\u9FFF]+$/.test(compact)) return true;
  if (/^\d+\s*(\/|\\|-)\s*\d+$/.test(compact)) return true;
  if (/^(n\/a|na|none|null|todo)$/i.test(compact)) return true;
  if (
    /^(获取|确认|查看|梳理|推进|优化|完善|明确|对齐|收集|验证|补充|建立|形成|评估|制定|修复|排查)[A-Za-z0-9\u3400-\u9FFF]{0,4}$/.test(
      compact
    )
  ) {
    return true;
  }
  if (/^(get|check|verify|confirm|fix|review|update|build)\s+\w{1,6}$/i.test(compact)) {
    return true;
  }

  const cjkCount = countCjkChars(compact);
  const asciiWordCount = countAsciiWords(compact);
  const compactLen = compact.replace(/\s+/g, "").length;

  if (cjkCount > 0) {
    return cjkCount < 6;
  }

  if (asciiWordCount >= 3) return false;
  if (asciiWordCount >= 2 && compactLen >= 8) return false;

  return compactLen < 12;
}

function parseWeeklyLiteReportObject(value: unknown): {
  success: true;
  data: WeeklyLiteReportV1;
} | {
  success: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, errors: ["root must be an object"] };
  }

  const row = value as Record<string, unknown>;
  const timeRange = row.time_range as Record<string, unknown> | undefined;
  const start = typeof timeRange?.start === "string" ? timeRange.start.trim() : "";
  const end = typeof timeRange?.end === "string" ? timeRange.end.trim() : "";
  const totalConversations = Number(timeRange?.total_conversations);

  if (!start) errors.push("time_range.start missing");
  if (!end) errors.push("time_range.end missing");
  if (!Number.isFinite(totalConversations) || totalConversations < 0) {
    errors.push("time_range.total_conversations invalid");
  }

  const highlights = pickList(row.highlights, 8);
  const recurringQuestions = pickList(row.recurring_questions, 8);
  const unresolvedThreads = pickList(row.unresolved_threads, 8);
  const suggestedFocus = pickList(row.suggested_focus, 8);
  if (!highlights.length) errors.push("highlights missing");

  const crossDomainRaw = Array.isArray(row.cross_domain_echoes)
    ? row.cross_domain_echoes
    : [];
  const crossDomainEchoes = crossDomainRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const echo = item as Record<string, unknown>;
      const domainA = typeof echo.domain_a === "string" ? echo.domain_a.trim() : "";
      const domainB = typeof echo.domain_b === "string" ? echo.domain_b.trim() : "";
      const sharedLogic =
        typeof echo.shared_logic === "string" ? echo.shared_logic.trim() : "";
      const evidenceIds = Array.isArray(echo.evidence_ids)
        ? echo.evidence_ids
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id >= 0)
        : [];
      if (!domainA || !domainB || !sharedLogic) return null;
      return {
        domain_a: domainA,
        domain_b: domainB,
        shared_logic: sharedLogic,
        evidence_ids: evidenceIds,
      };
    })
    .filter(
      (
        item
      ): item is {
        domain_a: string;
        domain_b: string;
        shared_logic: string;
        evidence_ids: number[];
      } => item !== null
    )
    .slice(0, 4);

  const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : [];
  const evidence = evidenceRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const conversationId = Number(value.conversation_id);
      const note = typeof value.note === "string" ? value.note.trim() : "";
      if (!Number.isInteger(conversationId) || conversationId < 0 || !note) return null;
      return { conversation_id: conversationId, note };
    })
    .filter(
      (item): item is { conversation_id: number; note: string } => item !== null
    )
    .slice(0, 10);

  if (typeof row.insufficient_data !== "boolean") {
    errors.push("insufficient_data missing");
  }

  if (errors.length) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      time_range: {
        start,
        end,
        total_conversations: Math.floor(totalConversations),
      },
      highlights,
      recurring_questions: recurringQuestions,
      cross_domain_echoes: crossDomainEchoes,
      unresolved_threads: unresolvedThreads,
      suggested_focus: suggestedFocus,
      evidence,
      insufficient_data: Boolean(row.insufficient_data),
    },
  };
}

function validateWeeklySemanticQuality(report: WeeklyLiteReportV1): {
  passed: boolean;
  issueCodes: string[];
} {
  if (report.insufficient_data) {
    return { passed: true, issueCodes: [] };
  }

  const issueCodes = new Set<string>();
  const recurringNotQuestionLike = report.recurring_questions.some(
    (item) => !/[?？]$/.test(item.trim()) && !/^(为什么|为何|如何|怎么|是否|能否|what|why|how)/i.test(item.trim())
  );

  if (!report.highlights.length) issueCodes.add("EMPTY_VALID_HIGHLIGHTS");
  if (report.highlights.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_HIGHLIGHT");
  }
  if (report.recurring_questions.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_RECURRING");
  }
  if (recurringNotQuestionLike) issueCodes.add("RECURRING_NOT_QUESTIONLIKE");
  if (report.unresolved_threads.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_UNRESOLVED");
  }
  if (report.suggested_focus.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_SUGGESTED_FOCUS");
  }
  if (!report.suggested_focus.length) {
    issueCodes.add("EMPTY_VALID_SUGGESTED_FOCUS");
  }

  return {
    passed: issueCodes.size === 0,
    issueCodes: [...issueCodes],
  };
}

function countCjkChars(value: string): number {
  const matches = value.match(/[\u3400-\u9FFF]/g);
  return matches ? matches.length : 0;
}

function countAsciiWords(value: string): number {
  const matches = value.match(/[A-Za-z0-9][A-Za-z0-9+/_\-.]*/g);
  return matches ? matches.length : 0;
}

function isCompleteSentence(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (isLowSignalNarrativeItem(text)) return false;
  if (/[。！？.!?]$/.test(text)) return true;

  const cjk = countCjkChars(text);
  if (cjk >= 10) return true;

  const asciiWords = countAsciiWords(text);
  return asciiWords >= 5;
}

function toWeeklyLiteText(report: WeeklyLiteReportV1): string {
  return [
    ...report.highlights,
    ...report.recurring_questions,
    ...report.unresolved_threads,
    ...report.suggested_focus,
    ...report.evidence.map((item) => item.note),
  ].join(" ");
}

function evaluateWeeklyCaseSemantics(
  report: WeeklyLiteReportV1,
  knownConversationIds: Set<number>
): {
  lowSignalItemRate: number;
  minCompleteSentenceRate: number;
  evidenceConsistencyRate: number;
  semanticPassed: boolean;
  semanticIssueCodes: string[];
} {
  const quality = validateWeeklySemanticQuality(report);
  if (report.insufficient_data) {
    return {
      lowSignalItemRate: 0,
      minCompleteSentenceRate: 100,
      evidenceConsistencyRate: 100,
      semanticPassed: quality.passed,
      semanticIssueCodes: quality.issueCodes,
    };
  }

  const narrativeItems = [
    ...report.highlights,
    ...report.recurring_questions,
    ...report.unresolved_threads,
    ...report.suggested_focus,
  ].filter((item) => item.trim().length > 0);

  const lowSignalCount = narrativeItems.filter((item) =>
    isLowSignalNarrativeItem(item)
  ).length;
  const completeCount = narrativeItems.filter((item) =>
    isCompleteSentence(item)
  ).length;
  const totalNarratives = Math.max(narrativeItems.length, 1);

  const validEvidenceCount = report.evidence.filter((item) =>
    knownConversationIds.has(item.conversation_id)
  ).length;
  const evidenceConsistencyRate = report.insufficient_data
    ? 100
    : report.evidence.length > 0
      ? (validEvidenceCount / report.evidence.length) * 100
      : 0;

  return {
    lowSignalItemRate: (lowSignalCount / totalNarratives) * 100,
    minCompleteSentenceRate: (completeCount / totalNarratives) * 100,
    evidenceConsistencyRate,
    semanticPassed: quality.passed,
    semanticIssueCodes: quality.issueCodes,
  };
}

function removeTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      output += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) {
        j += 1;
      }
      const next = input[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    output += ch;
  }

  return output;
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m[1]) {
      blocks.push(m[1].trim());
    }
  }

  return blocks;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function tryParseJsonCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim().replace(/^\uFEFF/, "");
  const attempts = [trimmed, removeTrailingCommas(trimmed)];

  for (const attempt of attempts) {
    if (!attempt) continue;

    try {
      let value: unknown = JSON.parse(attempt);

      // Handle double-encoded JSON (e.g. a JSON string containing a JSON object).
      for (let i = 0; i < 2; i++) {
        if (typeof value !== "string") break;
        const inner = value.trim();
        if (!inner) break;
        if (
          (inner.startsWith("{") && inner.endsWith("}")) ||
          (inner.startsWith("[") && inner.endsWith("]"))
        ) {
          try {
            value = JSON.parse(inner);
            continue;
          } catch {
            break;
          }
        }
        break;
      }

      return value;
    } catch {
      // Keep trying.
    }
  }

  return null;
}

function parseJsonFromText(raw: string): unknown {
  const t = raw.trim();
  const cands: string[] = [];

  if (t) {
    cands.push(t);
  }

  for (const block of extractFencedBlocks(t)) {
    if (block) {
      cands.push(block);
    }
  }

  const balanced = extractBalancedJsonObject(t);
  if (balanced) {
    cands.push(balanced);
  }

  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    cands.push(t.slice(s, e + 1));
  }

  for (const c of cands) {
    const parsed = tryParseJsonCandidate(c);
    if (parsed !== null) {
      return parsed;
    }
  }

  throw new Error("INVALID_JSON_PAYLOAD");
}

function parseStructured(kind: "conversation" | "weekly", raw: string) {
  try {
    const value = parseJsonFromText(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        data: null,
        errors: [`root must be an object, got ${Array.isArray(value) ? "array" : typeof value}`],
      };
    }

    const o = value as Record<string, unknown>;

    if (kind === "conversation") {
      const topic = typeof o.topic_title === "string" ? o.topic_title.trim() : "";
      const takeaways = pickList((o as any).key_takeaways ?? (o as any).key_insights, 8);

      const rawSentiment = typeof o.sentiment === "string" ? o.sentiment.trim().toLowerCase() : "";
      const sentimentMap: Record<string, "neutral" | "positive" | "negative"> = {
        neutral: "neutral",
        positive: "positive",
        negative: "negative",
        "\u4e2d\u6027": "neutral",
        "\u6b63\u9762": "positive",
        "\u79ef\u6781": "positive",
        "\u8d1f\u9762": "negative",
        "\u6d88\u6781": "negative",
      };
      const sentiment = (sentimentMap as any)[rawSentiment] ?? rawSentiment;

      const errors: string[] = [];
      if (!topic) errors.push("topic_title missing");
      if (!takeaways.length) errors.push("key_takeaways missing");
      if (!["neutral", "positive", "negative"].includes(sentiment)) {
        errors.push("sentiment invalid");
      }

      if (errors.length) {
        return { data: null, errors };
      }

      return {
        data: {
          topic_title: topic.slice(0, 80),
          key_takeaways: takeaways,
          sentiment,
          action_items: pickList((o as any).action_items ?? (o as any).next_steps ?? (o as any).todos, 8),
          tech_stack_detected: pickList((o as any).tech_stack_detected ?? (o as any).tags ?? (o as any).tech_stack, 8),
        },
        errors: [] as string[],
      };
    }

    const parsed = parseWeeklyLiteReportObject(o);
    if (parsed.success) {
      return {
        data: parsed.data,
        errors: [] as string[],
      };
    }

    return {
      data: null,
      errors: (parsed as { errors?: string[] }).errors ?? ["WEEKLY_PARSE_FAILED"],
    };
  } catch (e) {
    return { data: null, errors: [String((e as Error).message || e)] };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callProvider(
  cfg: { baseUrl: string; apiKey: string; modelId: string; temperature: number; maxTokens: number },
  system: string,
  user: string,
  jsonMode: boolean
): Promise<{ content: string; mode: "json_mode" | "prompt_json" | "plain_text" }> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const post = (body: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });

  const postWithRetry = async (body: Record<string, unknown>, label: string) => {
    let retries = 0;
    while (true) {
      if (cli.throttleMs > 0 && retries === 0) {
        await sleep(cli.throttleMs);
      }

      const res = await post(body);
      if (res.status !== 429) return res;

      retries += 1;
      const retryAfter = res.headers.get("retry-after");
      const waitMs = retryAfter
        ? Math.max(1, Number(retryAfter) * 1000)
        : Math.min(120000, 2000 * 2 ** (retries - 1));

      await sleep(waitMs + Math.floor(Math.random() * 250));

      if (retries >= 12) {
        return res;
      }
    }
  };

  const content = (p: unknown) => {
    const c = (p as any)?.choices?.[0]?.message?.content?.trim();
    if (!c) throw new Error("empty content");
    return c as string;
  };
  const msgs = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  if (jsonMode) {
    const r = await postWithRetry({
      model: cfg.modelId,
      enable_thinking: false,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      response_format: { type: "json_object" },
      messages: msgs,
    }, "json_mode");
    if (r.ok) return { content: content(await r.json()), mode: "json_mode" };
    const err = await r.text();
    const fallback =
      [400, 404, 415, 422].includes(r.status) || /response_format|json_object|unsupported/i.test(err);
    if (!fallback) throw new Error(`provider json failed ${r.status}`);
    const r2 = await postWithRetry({
      model: cfg.modelId,
      enable_thinking: false,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      messages: [
        { role: "system", content: `${system}\n${STRICT_JSON}` },
        { role: "user", content: user },
      ],
    }, "prompt_json");
    if (!r2.ok) throw new Error(`provider prompt_json failed ${r2.status}`);
    return { content: content(await r2.json()), mode: "prompt_json" };
  }
  const r = await postWithRetry({
    model: cfg.modelId,
    enable_thinking: false,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: msgs,
  }, "plain_text");
  if (!r.ok) throw new Error(`provider plain failed ${r.status}`);
  return { content: content(await r.json()), mode: "plain_text" };
}

function textFromStructured(s: any, raw: string): string {
  if (!s) return raw;
  if (s.topic_title) {
    return [s.topic_title, ...(s.key_takeaways || []), ...(s.action_items || []), ...(s.tech_stack_detected || [])].join(" ");
  }
  if (s.time_range && Array.isArray(s.highlights)) {
    return toWeeklyLiteText(s as WeeklyLiteReportV1);
  }
  return [
    s.period_title,
    ...(s.main_themes || []),
    ...(s.key_takeaways || []),
    ...(s.action_items || []),
    ...(s.tech_stack_detected || []),
  ].join(" ");
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

async function main() {
  const root = rootDir();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const debugDir = cli.debugRaw ? path.join(root, "eval", "reports", "raw", runId) : null;
  if (debugDir) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const runMode =
    cli.mode === "auto"
      ? process.env.VESTI_EVAL_API_KEY && process.env.VESTI_EVAL_MODEL_ID
        ? "live"
        : "mock"
      : cli.mode;

  let cases = [
    ...listJson<any>(path.join(root, "eval", "gold", "conversation")),
    ...listJson<any>(path.join(root, "eval", "gold", "weekly")),
  ];

  if (cli.caseFilter) {
    const filters = cli.caseFilter
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    cases = cases.filter((item: any) =>
      filters.some((filter) => item.id === filter || String(item.id).includes(filter))
    );
  }

  if (cli.limit > 0) {
    cases = cases.slice(0, cli.limit);
  }

  const thresholds = readJson<any>(path.join(root, "eval", "rubrics", "thresholds.json"));

  console.log(`[eval:prompts] selectedCases=${cases.length} caseFilter=${cli.caseFilter || "(none)"} limit=${cli.limit || "(none)"}`);

  const cfg =
    runMode === "live"
      ? {
          baseUrl: process.env.VESTI_EVAL_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: process.env.VESTI_EVAL_API_KEY || "",
          modelId: process.env.VESTI_EVAL_MODEL_ID || "",
          temperature: Number(process.env.VESTI_EVAL_TEMPERATURE || "0.3"),
          maxTokens: Number(process.env.VESTI_EVAL_MAX_TOKENS || "1800"),
        }
      : null;

  if (runMode === "live" && (!cfg?.apiKey || !cfg?.modelId)) {
    throw new Error("live mode requires VESTI_EVAL_API_KEY and VESTI_EVAL_MODEL_ID");
  }

  const scored: any[] = [];
  for (const c of cases) {
    const kind = c.type as "conversation" | "weekly";
    const promptType = kind === "conversation" ? "conversationSummary" : "weeklyDigest";
    const prompt = getPrompt(promptType, { variant: cli.variant });
    let mode = "mock_gold";
    let attempt = 1;
    let raw = "";
    let parsed: any = null;
    const started = Date.now();
    const debugAttempts: Array<{ attempt: number; mode: string; raw: string; errors?: string[] }> = [];

    if (runMode === "mock") {
      const ref = JSON.parse(JSON.stringify(c.gold.reference));
      const has = (v: string) => norm(textFromStructured(ref, "")).includes(norm(v));
      const missing = (c.gold.required_facts || []).filter((f: string) => !has(f));
      if (kind === "conversation") {
        ref.key_takeaways = [...(ref.key_takeaways || []), ...missing];
      } else {
        ref.highlights = [...(ref.highlights || []), ...missing];
      }
      raw = JSON.stringify(ref);
      parsed = ref;
      debugAttempts.push({ attempt: 1, mode: "mock_gold", raw });
    } else {
      const payload =
        kind === "conversation"
          ? {
              conversationTitle: c.title,
              messages: c.messages.map((m: any, i: number) => ({
                id: i + 1,
                conversation_id: 1,
                role: m.role,
                content_text: m.content,
                created_at: m.timestamp,
              })),
              locale: c.locale || "zh",
            }
          : {
              conversations: c.conversations.map((x: any) => ({
                id: x.id,
                uuid: String(x.id),
                platform: x.platform,
                title: x.title,
                snippet: x.snippet,
                url: "",
                created_at: x.created_at,
                updated_at: x.created_at,
                message_count: x.message_count,
                is_archived: false,
                is_trash: false,
                tags: [],
              })),
              rangeStart: c.range_start,
              rangeEnd: c.range_end,
              locale: c.locale || "zh",
            };

      const p1 = await callProvider(cfg!, prompt.system, prompt.userTemplate(payload as never), true);
      mode = p1.mode;
      raw = p1.content;
      const v1 = parseStructured(kind, raw);
      debugAttempts.push({ attempt: 1, mode: p1.mode, raw: p1.content, errors: v1.errors });
      if (v1.data) {
        parsed = v1.data;
      } else {
        attempt = 2;
        const repair =
          kind === "conversation"
            ? `Fix as JSON with keys topic_title,key_takeaways,sentiment,action_items,tech_stack_detected. Errors: ${v1.errors.join("; ")}\n${raw}`
            : `Fix as weekly_lite.v1 JSON with keys time_range,highlights,recurring_questions,cross_domain_echoes,unresolved_threads,suggested_focus,evidence,insufficient_data. Errors: ${v1.errors.join("; ")}\n${raw}`;
        const p2 = await callProvider(cfg!, prompt.system, repair, true);
        mode = p2.mode;
        raw = p2.content;
        const v2 = parseStructured(kind, raw);
        debugAttempts.push({ attempt: 2, mode: p2.mode, raw: p2.content, errors: v2.errors });
        if (v2.data) {
          parsed = v2.data;
        } else {
          attempt = 3;
          mode = "fallback_text";
          const p3 = await callProvider(
            cfg!,
            prompt.fallbackSystem || prompt.system,
            prompt.fallbackTemplate(payload as never),
            false
          );
          raw = p3.content;
          debugAttempts.push({ attempt: 3, mode: "fallback_text", raw: p3.content });
        }
      }
    }

    if (debugDir) {
      const debugPath = path.join(debugDir, `${c.id}.json`);
      fs.writeFileSync(
        debugPath,
        `${JSON.stringify({ id: c.id, type: kind, promptVersion: prompt.version, runMode, variant: cli.variant, attempt, finalMode: mode, formatCompliant: !!parsed, modelId: runMode === "live" ? cfg!.modelId : "mock", baseUrl: runMode === "live" ? cfg!.baseUrl : "mock", attempts: debugAttempts }, null, 2)}
`,
        "utf-8"
      );
    }

    const text = textFromStructured(parsed, raw);
    const required = c.gold.required_facts || [];
    const forbidden = c.gold.forbidden_facts || [];
    const matched = required.filter((f: string) => norm(text).includes(norm(f)));
    const missed = required.filter((f: string) => !norm(text).includes(norm(f)));
    const triggered = forbidden.filter((f: string) => norm(text).includes(norm(f)));
    const coverage = required.length ? matched.length / required.length : 1;
    const hallucination = forbidden.length ? triggered.length / forbidden.length : 0;
    const formatOk = !!parsed;
    const hasActions =
      kind === "conversation"
        ? parsed?.action_items?.length
          ? 1
          : 0
        : parsed?.suggested_focus?.length
          ? 1
          : 0;

    let weeklyLowSignalItemRate = 0;
    let weeklyMinCompleteSentenceRate = 100;
    let weeklyEvidenceConsistencyRate = 100;
    let weeklySemanticPassed = true;
    let weeklySemanticIssueCodes: string[] = [];

    if (kind === "weekly" && parsed) {
      const knownConversationIds = new Set<number>(
        (c.conversations || []).map((item: any) => Number(item.id))
      );
      const weeklyEval = evaluateWeeklyCaseSemantics(
        parsed as WeeklyLiteReportV1,
        knownConversationIds
      );
      weeklyLowSignalItemRate = weeklyEval.lowSignalItemRate;
      weeklyMinCompleteSentenceRate = weeklyEval.minCompleteSentenceRate;
      weeklyEvidenceConsistencyRate = weeklyEval.evidenceConsistencyRate;
      weeklySemanticPassed = weeklyEval.semanticPassed;
      weeklySemanticIssueCodes = weeklyEval.semanticIssueCodes;
    }

    let subjective =
      2 +
      (formatOk ? 1 : 0) +
      coverage * 1.5 +
      (hallucination === 0 ? 0.8 : -Math.min(1.2, hallucination * 2)) +
      (hasActions ? 0.3 : 0) +
      (mode === "fallback_text" ? -0.4 : 0);
    if (kind === "weekly") {
      subjective += weeklySemanticPassed ? 0.3 : -0.6;
      subjective += Math.max(-0.5, (weeklyMinCompleteSentenceRate - 80) * 0.005);
      subjective += Math.max(-0.6, (20 - weeklyLowSignalItemRate) * 0.01);
      subjective += Math.max(-0.4, (weeklyEvidenceConsistencyRate - 70) * 0.004);
    }
    subjective = Math.max(1, Math.min(5, subjective));

    scored.push({
      id: c.id,
      type: kind,
      promptVersion: runMode === "mock" ? `${prompt.version}#mock` : prompt.version,
      mode,
      attempt,
      latencyMs: Date.now() - started,
      formatCompliant: formatOk,
      coverageRate: round2(coverage),
      hallucinationRate: round2(hallucination),
      subjectiveScore: round2(subjective),
      matchedRequiredFacts: matched,
      missedRequiredFacts: missed,
      triggeredForbiddenFacts: triggered,
      weeklyLowSignalItemRate:
        kind === "weekly" ? round2(weeklyLowSignalItemRate) : undefined,
      weeklyMinCompleteSentenceRate:
        kind === "weekly" ? round2(weeklyMinCompleteSentenceRate) : undefined,
      weeklyEvidenceConsistencyRate:
        kind === "weekly" ? round2(weeklyEvidenceConsistencyRate) : undefined,
      weeklySemanticPassed: kind === "weekly" ? weeklySemanticPassed : undefined,
      weeklySemanticIssueCodes:
        kind === "weekly" ? weeklySemanticIssueCodes : undefined,
    });

    if (cli.caseDelayMs > 0) {
      await sleep(cli.caseDelayMs);
    }
  }

  const total = scored.length || 1;
  const weeklyCases = scored.filter((x) => x.type === "weekly");
  const weeklyTotal = weeklyCases.length;
  const weeklyMetrics =
    weeklyTotal > 0
      ? {
          weeklyLowSignalItemRate: round2(
            weeklyCases.reduce((sum, item) => sum + (item.weeklyLowSignalItemRate ?? 0), 0) /
              weeklyTotal
          ),
          weeklyMinCompleteSentenceRate: round2(
            weeklyCases.reduce(
              (sum, item) => sum + (item.weeklyMinCompleteSentenceRate ?? 0),
              0
            ) / weeklyTotal
          ),
          weeklyEvidenceConsistencyRate: round2(
            weeklyCases.reduce(
              (sum, item) => sum + (item.weeklyEvidenceConsistencyRate ?? 0),
              0
            ) / weeklyTotal
          ),
          weeklySemanticPassRate: round2(
            (weeklyCases.filter((item) => item.weeklySemanticPassed).length /
              weeklyTotal) *
              100
          ),
        }
      : {
          weeklyLowSignalItemRate: 0,
          weeklyMinCompleteSentenceRate: 100,
          weeklyEvidenceConsistencyRate: 100,
          weeklySemanticPassRate: 100,
        };
  const metrics = {
    formatComplianceRate: round2((scored.filter((x) => x.formatCompliant).length / total) * 100),
    informationCoverageRate: round2((scored.reduce((s, x) => s + x.coverageRate, 0) / total) * 100),
    hallucinationRate: round2((scored.reduce((s, x) => s + x.hallucinationRate, 0) / total) * 100),
    userSatisfaction: round2(scored.reduce((s, x) => s + x.subjectiveScore, 0) / total),
    ...weeklyMetrics,
  };

  const weeklyThresholds = {
    weeklyLowSignalItemRate: Number(thresholds.weeklyLowSignalItemRate ?? 12),
    weeklyMinCompleteSentenceRate: Number(
      thresholds.weeklyMinCompleteSentenceRate ?? 82
    ),
    weeklyEvidenceConsistencyRate: Number(
      thresholds.weeklyEvidenceConsistencyRate ?? 85
    ),
    weeklySemanticPassRate: Number(thresholds.weeklySemanticPassRate ?? 100),
  };
  const reportThresholds = { ...thresholds, ...weeklyThresholds };

  const gate = {
    formatComplianceRate:
      metrics.formatComplianceRate >= reportThresholds.formatComplianceRate,
    informationCoverageRate:
      metrics.informationCoverageRate >= reportThresholds.informationCoverageRate,
    hallucinationRate:
      metrics.hallucinationRate <= reportThresholds.hallucinationRate,
    userSatisfaction: metrics.userSatisfaction >= reportThresholds.userSatisfaction,
    weeklyLowSignalItemRate:
      metrics.weeklyLowSignalItemRate <= reportThresholds.weeklyLowSignalItemRate,
    weeklyMinCompleteSentenceRate:
      metrics.weeklyMinCompleteSentenceRate >=
      reportThresholds.weeklyMinCompleteSentenceRate,
    weeklyEvidenceConsistencyRate:
      metrics.weeklyEvidenceConsistencyRate >=
      reportThresholds.weeklyEvidenceConsistencyRate,
    weeklySemanticPassRate:
      metrics.weeklySemanticPassRate >= reportThresholds.weeklySemanticPassRate,
  };
  const allPassed = Object.values(gate).every(Boolean);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: runMode,
    variant: cli.variant,
    datasetSize: {
      total: scored.length,
      conversation: scored.filter((x) => x.type === "conversation").length,
      weekly: scored.filter((x) => x.type === "weekly").length,
    },
    metrics,
    thresholds: reportThresholds,
    gate: { ...gate, allPassed },
    cases: scored,
  };

  const reportsDir = path.join(root, "eval", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const latest = path.join(reportsDir, "latest.json");
  const baseline = path.join(reportsDir, "baseline.json");
  const diff = path.join(reportsDir, "diff-vs-baseline.md");

  fs.writeFileSync(latest, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  if (cli.updateBaseline || !fs.existsSync(baseline)) {
    fs.writeFileSync(baseline, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }

  const base = fs.existsSync(baseline) ? readJson<any>(baseline) : null;
  const lines: string[] = ["# Prompt Eval Diff vs Baseline", ""];
  if (!base) {
    lines.push("No baseline report found.");
  } else {
    lines.push(`- Baseline generated at: ${base.generatedAt}`);
    lines.push(`- Latest generated at: ${report.generatedAt}`);
    lines.push(`- Mode: ${report.mode}`);
    lines.push(`- Variant: ${report.variant}`, "");
    lines.push("| Metric | Baseline | Latest | Delta |", "| --- | ---: | ---: | ---: |");
    for (const key of [
      "formatComplianceRate",
      "informationCoverageRate",
      "hallucinationRate",
      "userSatisfaction",
      "weeklyLowSignalItemRate",
      "weeklyMinCompleteSentenceRate",
      "weeklyEvidenceConsistencyRate",
      "weeklySemanticPassRate",
    ]) {
      const b = Number(base.metrics[key]);
      const l = Number(report.metrics[key]);
      const d = l - b;
      lines.push(`| ${key} | ${b.toFixed(2)} | ${l.toFixed(2)} | ${d > 0 ? "+" : ""}${d.toFixed(2)} |`);
    }
    lines.push("", "## Gate", "");
    lines.push(`- formatComplianceRate: ${report.gate.formatComplianceRate ? "PASS" : "FAIL"}`);
    lines.push(`- informationCoverageRate: ${report.gate.informationCoverageRate ? "PASS" : "FAIL"}`);
    lines.push(`- hallucinationRate: ${report.gate.hallucinationRate ? "PASS" : "FAIL"}`);
    lines.push(`- userSatisfaction: ${report.gate.userSatisfaction ? "PASS" : "FAIL"}`);
    lines.push(`- weeklyLowSignalItemRate: ${report.gate.weeklyLowSignalItemRate ? "PASS" : "FAIL"}`);
    lines.push(`- weeklyMinCompleteSentenceRate: ${report.gate.weeklyMinCompleteSentenceRate ? "PASS" : "FAIL"}`);
    lines.push(`- weeklyEvidenceConsistencyRate: ${report.gate.weeklyEvidenceConsistencyRate ? "PASS" : "FAIL"}`);
    lines.push(`- weeklySemanticPassRate: ${report.gate.weeklySemanticPassRate ? "PASS" : "FAIL"}`);
    lines.push(`- overall: ${report.gate.allPassed ? "PASS" : "FAIL"}`);
  }
  fs.writeFileSync(diff, `${lines.join("\n")}\n`, "utf-8");

  console.log(`[eval:prompts] mode=${runMode} variant=${cli.variant} total=${report.datasetSize.total}`);
  console.log(
    `[eval:prompts] metrics format=${metrics.formatComplianceRate} coverage=${metrics.informationCoverageRate} hallucination=${metrics.hallucinationRate} satisfaction=${metrics.userSatisfaction} weeklyLowSignal=${metrics.weeklyLowSignalItemRate} weeklyComplete=${metrics.weeklyMinCompleteSentenceRate} weeklyEvidence=${metrics.weeklyEvidenceConsistencyRate} weeklySemanticPass=${metrics.weeklySemanticPassRate}`
  );
  console.log(`[eval:prompts] gate=${report.gate.allPassed ? "PASS" : "FAIL"}`);
  console.log(`[eval:prompts] latest=${latest}`);
  console.log(`[eval:prompts] diff=${diff}`);
  if (debugDir) {
    console.log(`[eval:prompts] debugRawDir=${debugDir}`);
  }

  if (cli.strict && !report.gate.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("[eval:prompts] failed", e);
  process.exitCode = 1;
});
