// Backward-compatible alias for older imports. Response model calls are now
// extraction-only; deterministicResponse.js owns demand matching and outcome
// classification.
import { RESPONSE_EXTRACTION_SYSTEM_PROMPT } from './extractionPrompts.js';

export const PHASE2_SYSTEM_PROMPT = RESPONSE_EXTRACTION_SYSTEM_PROMPT;
