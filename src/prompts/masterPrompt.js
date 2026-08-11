// Backward-compatible alias retained for old imports. Audit model calls must
// use the extraction-only contract; deterministicAudit.js owns evaluation.
// New code should import CREDIT_EXTRACTION_SYSTEM_PROMPT directly.
import { CREDIT_EXTRACTION_SYSTEM_PROMPT } from './extractionPrompts.js';

export const MASTER_SYSTEM_PROMPT = CREDIT_EXTRACTION_SYSTEM_PROMPT;
