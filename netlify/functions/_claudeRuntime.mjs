export const CLAUDE_MODEL = 'claude-sonnet-5';
export const CLAUDE_CLIENT_OPTIONS = {
  maxRetries: 2,
  timeout: 8 * 60 * 1000,
};
export const MAX_SAFE_INPUT_TOKENS = 850000;

export function usageFromMessage(message) {
  const usage = message?.usage || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    thinking_tokens: usage.output_tokens_details?.thinking_tokens || 0,
    cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
  };
}

export function assertCompletedMessage(message, operation, model = CLAUDE_MODEL) {
  if (!message || message.model !== model) {
    throw new Error(`${operation} model mismatch — expected ${model}, received ${message?.model || 'no model id'}`);
  }
  if (message.stop_reason !== 'end_turn') {
    if (message.stop_reason === 'max_tokens') throw new Error(`${operation} hit the output limit before finishing. Nothing incomplete was saved.`);
    if (message.stop_reason === 'refusal') throw new Error(`${operation} was declined by the model. Review the source material and try again.`);
    throw new Error(`${operation} did not finish cleanly (${message.stop_reason || 'missing stop reason'}).`);
  }
  return message;
}

export async function preflightTokenCount(anthropic, params, { operation, maxInputTokens = MAX_SAFE_INPUT_TOKENS } = {}) {
  const countParams = {
    model: params.model,
    system: params.system,
    messages: params.messages,
  };
  const counted = await anthropic.messages.countTokens(countParams);
  if ((counted?.input_tokens || 0) > maxInputTokens) {
    throw new Error(`${operation || 'Claude request'} is too large (${counted.input_tokens.toLocaleString()} input tokens). Split the source documents and try again.`);
  }
  return counted?.input_tokens || 0;
}

export async function logClaudeCall(db, details) {
  try {
    const finishedAt = details.finishedAt || new Date();
    const startedAt = details.startedAt instanceof Date ? details.startedAt : new Date(details.startedAt || finishedAt);
    const usage = details.usage || {};
    await db.from('claude_call_logs').insert({
      user_id: details.userId || null,
      operation: details.operation,
      entity_type: details.entityType || null,
      entity_id: details.entityId ? String(details.entityId) : null,
      model: details.model || CLAUDE_MODEL,
      effort: details.effort || null,
      prompt_version: details.promptVersion || null,
      attempt: details.attempt || 1,
      status: details.status || 'completed',
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      latency_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      request_id: details.requestId || null,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      thinking_tokens: usage.thinking_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      stop_reason: details.stopReason || null,
      error_type: details.errorType || null,
      error_message: details.errorMessage ? String(details.errorMessage).slice(0, 1000) : null,
    });
  } catch (error) {
    // Telemetry must never discard valid work product.
    console.warn('claude telemetry write failed:', error.message);
  }
}
