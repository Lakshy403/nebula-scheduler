/**
 * @file services/worker/src/ai/AIFailureAnalyzer.js
 * @description AI-powered root cause analysis service for failed jobs.
 *
 * Integration model:
 *  This service is designed for enterprise AI hubs that expose an OpenAI-
 *  compatible Chat Completions API (e.g., SAP Generative AI Hub, Azure OpenAI,
 *  AWS Bedrock via compatibility shims). The endpoint, model name, and API key
 *  are resolved from environment variables so the same code runs against any
 *  compliant provider without modification.
 *
 * Strict JSON extraction strategy:
 *  Rather than relying on free-form LLM output and post-hoc parsing (which
 *  is brittle under error conditions), the prompt mandates JSON-only output
 *  and the request uses `response_format: { type: 'json_object' }` where the
 *  provider supports it. A regex-based fallback extraction is applied in case
 *  the model emits preamble text before the JSON block.
 *
 * Resilience:
 *  - If the AI service is unreachable, returns after AI_TIMEOUT_MS.
 *  - If JSON parsing fails, the structured fallback response is returned
 *    so the DLQ insertion always has a valid `ai_analysis` field.
 *  - No exception escapes this class — callers receive either real AI output
 *    or the deterministic fallback. The DLQ handler must not fail because
 *    AI is unavailable.
 *
 * Output schema (guaranteed):
 *  {
 *    "summary":          string   — one sentence plain-English summary
 *    "root_cause":       string   — detailed technical root cause
 *    "suggested_fix":    string   — numbered actionable remediation steps
 *    "confidence_score": float    — [0.0, 1.0]; 0.0 on fallback
 *    "analyzed_by":      string   — model ID or "FALLBACK"
 *    "analyzed_at":      string   — ISO 8601 timestamp
 *  }
 */

import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AI_ENDPOINT   = process.env.AI_HUB_ENDPOINT     ?? 'https://api.openai.com/v1';
const AI_API_KEY    = process.env.AI_HUB_API_KEY       ?? '';
const AI_MODEL      = process.env.AI_HUB_MODEL         ?? 'gpt-4o';
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS ?? '15000', 10); // 15 s
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS ?? '800',   10);

/** Maximum characters of stack trace forwarded to the LLM (cost + latency control). */
const MAX_STACK_CHARS   = 2000;
/** Maximum characters of error message forwarded to the LLM. */
const MAX_MESSAGE_CHARS = 500;

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

/**
 * Builds the system prompt.
 *
 * The system prompt establishes the LLM's persona and output contract.
 * Strict JSON-only output is mandated here; the user prompt contains the
 * payload. Separating persona from payload produces more consistent results
 * across provider implementations.
 */
const SYSTEM_PROMPT = `\
You are an expert distributed systems engineer and incident responder.
Your sole task is to perform root cause analysis (RCA) on a failed background job
and return your findings as a single, strictly valid JSON object.

You MUST respond with ONLY a JSON object. Do not include markdown, code fences,
prose, or any text outside of the JSON object itself. Non-JSON output will be
treated as a system failure.

The JSON object MUST contain exactly these keys:
{
  "summary":          "<one concise sentence describing what failed and why>",
  "root_cause":       "<detailed technical explanation of the root cause>",
  "suggested_fix":    "<numbered list of specific, actionable remediation steps>",
  "confidence_score": <float between 0.0 and 1.0 indicating your certainty>
}

Rules:
- Do not add extra keys.
- Do not include null values; use empty strings if a field has no content.
- confidence_score must be a JSON number (float), not a string.
- Base your analysis on the job name, error message, and stack trace provided.
- If the stack trace is insufficient for a confident analysis, lower confidence_score accordingly.`;

/**
 * Builds the user prompt containing the job failure context.
 *
 * @param {object} params
 * @param {string} params.jobName
 * @param {string} params.errorMessage
 * @param {string} params.stackTrace
 * @returns {string}
 */
function buildUserPrompt({ jobName, errorMessage, stackTrace }) {
  const truncatedMessage = errorMessage.slice(0, MAX_MESSAGE_CHARS);
  const truncatedStack   = stackTrace.slice(0, MAX_STACK_CHARS);

  return `\
Analyze the following failed background job and provide root cause analysis.

JOB NAME:
${jobName}

ERROR MESSAGE:
${truncatedMessage}

STACK TRACE:
${truncatedStack}

Return your analysis as a single JSON object following the schema in your instructions.`;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a JSON object from a raw LLM response string.
 *
 * Strategy:
 *  1. Try `JSON.parse(content)` directly (ideal — model obeyed the prompt).
 *  2. Use a regex to extract the first `{...}` block (model emitted preamble).
 *  3. Return null if neither strategy yields a valid object.
 *
 * @param {string} content - Raw LLM response content.
 * @returns {object | null}
 */
function extractJson(content) {
  if (!content || typeof content !== 'string') return null;

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(content.trim());
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* fall through */ }

  // Strategy 2: regex extraction — find the outermost JSON object
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Validates and normalises the extracted JSON against the expected schema.
 * Missing or invalid fields are replaced with safe defaults.
 *
 * @param {object} raw - Extracted JSON object from the LLM.
 * @param {string} modelId
 * @returns {AnalysisResult}
 */
function normalizeAnalysis(raw, modelId) {
  const score = parseFloat(raw.confidence_score);

  return {
    summary:          typeof raw.summary       === 'string' ? raw.summary.trim()       : 'No summary provided.',
    root_cause:       typeof raw.root_cause    === 'string' ? raw.root_cause.trim()    : 'Root cause could not be determined.',
    suggested_fix:    typeof raw.suggested_fix === 'string' ? raw.suggested_fix.trim() : 'No remediation steps available.',
    confidence_score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.0,
    analyzed_by:      modelId,
    analyzed_at:      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fallback response
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic fallback when the AI service is unavailable or
 * when JSON extraction fails. The DLQ insertion always has a valid analysis.
 *
 * @param {string} jobName
 * @param {string} errorMessage
 * @param {string} reason - Why the fallback was triggered (for logging).
 * @returns {AnalysisResult}
 */
function buildFallback(jobName, errorMessage, reason) {
  logger.warn('AIFailureAnalyzer using fallback analysis.', { jobName, reason });

  return {
    summary:          `Job '${jobName}' failed with: ${errorMessage.slice(0, 120)}`,
    root_cause:       'Automated AI analysis was unavailable. Manual investigation required.',
    suggested_fix:    '1. Review the full error stack trace in job_executions.\n2. Check upstream service health.\n3. Re-run the job after investigating the cause.',
    confidence_score: 0.0,
    analyzed_by:      'FALLBACK',
    analyzed_at:      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AIFailureAnalyzer
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AnalysisResult
 * @property {string} summary           - One sentence description of the failure.
 * @property {string} root_cause        - Detailed technical root cause.
 * @property {string} suggested_fix     - Actionable remediation steps.
 * @property {number} confidence_score  - LLM confidence [0.0, 1.0].
 * @property {string} analyzed_by       - Model ID or "FALLBACK".
 * @property {string} analyzed_at       - ISO 8601 timestamp.
 */

export class AIFailureAnalyzer {
  /**
   * Performs AI-driven root cause analysis on a job failure.
   *
   * This method NEVER throws. All error paths return the deterministic fallback.
   *
   * @param {object} params
   * @param {string} params.jobName      - Human-readable job name.
   * @param {string} params.errorMessage - The error's `.message` field.
   * @param {string} params.stackTrace   - The error's `.stack` field.
   * @param {string} [params.jobId]      - For log correlation.
   * @returns {Promise<AnalysisResult>}
   */
  async analyze({ jobName, errorMessage, stackTrace, jobId }) {
    const logContext = { jobId, jobName, model: AI_MODEL };

    if (!AI_API_KEY) {
      logger.warn('AIFailureAnalyzer: AI_HUB_API_KEY is not set. Using fallback.', logContext);
      return buildFallback(jobName, errorMessage, 'API_KEY_MISSING');
    }

    const controller  = new AbortController();
    const timeoutId   = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      logger.info('AIFailureAnalyzer: Requesting LLM analysis.', logContext);

      const response = await fetch(`${AI_ENDPOINT}/chat/completions`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`,
          // SAP Generative AI Hub requires this additional header.
          // Ignored by other providers that don't recognise it.
          'AI-Resource-Group': process.env.AI_RESOURCE_GROUP ?? 'default',
        },
        body: JSON.stringify({
          model:    AI_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role:    'user',
              content: buildUserPrompt({ jobName, errorMessage, stackTrace }),
            },
          ],
          max_tokens:   AI_MAX_TOKENS,
          temperature:  0.1,   // low temperature for deterministic, factual output
          // Request structured JSON output when the provider supports it.
          // Providers that don't support this field ignore it gracefully.
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.error('AIFailureAnalyzer: LLM API returned a non-200 status.', {
          ...logContext,
          httpStatus:   response.status,
          responseBody: body.slice(0, 300),
        });
        return buildFallback(jobName, errorMessage, `HTTP_${response.status}`);
      }

      const json    = await response.json();
      const content = json?.choices?.[0]?.message?.content ?? '';

      logger.debug('AIFailureAnalyzer: Raw LLM response received.', {
        ...logContext,
        usage:         json?.usage,
        contentLength: content.length,
      });

      const extracted = extractJson(content);

      if (!extracted) {
        logger.warn('AIFailureAnalyzer: Failed to extract JSON from LLM response.', {
          ...logContext,
          rawContent: content.slice(0, 500),
        });
        return buildFallback(jobName, errorMessage, 'JSON_EXTRACTION_FAILED');
      }

      const result = normalizeAnalysis(extracted, json?.model ?? AI_MODEL);

      logger.info('AIFailureAnalyzer: Analysis complete.', {
        ...logContext,
        confidenceScore: result.confidence_score,
        analyzedBy:      result.analyzed_by,
      });

      return result;
    } catch (err) {
      clearTimeout(timeoutId);

      const isTimeout = err.name === 'AbortError';
      logger.error(`AIFailureAnalyzer: ${isTimeout ? 'Request timed out' : 'Unexpected error'}.`, {
        ...logContext,
        error:     err,
        timeoutMs: isTimeout ? AI_TIMEOUT_MS : undefined,
      });

      return buildFallback(jobName, errorMessage, isTimeout ? 'TIMEOUT' : 'UNEXPECTED_ERROR');
    }
  }
}

// Singleton — shared across DLQHandler invocations within the same process.
export const aiFailureAnalyzer = new AIFailureAnalyzer();
