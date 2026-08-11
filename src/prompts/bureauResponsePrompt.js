// Backward-compatible alias for older imports. Bureau-response model calls
// extract claims only; deterministicResponse.js owns classifications and
// next-action recommendations.
import { RESPONSE_EXTRACTION_SYSTEM_PROMPT } from './extractionPrompts.js';

export const BUREAU_RESPONSE_SYSTEM_PROMPT = RESPONSE_EXTRACTION_SYSTEM_PROMPT;
