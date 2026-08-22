// This schema remains for reading historical analysis payloads. New CCC
// letters are rendered from the versioned Consent / Accuracy / Collection
// template library, not this retired free-form structured-letter renderer.
export const LETTER_CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    summary: { type: 'string' },
    opening: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accountRef: { type: 'string' },
          heading: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'paragraphs', 'bullets'],
      },
    },
    demands: { type: 'array', items: { type: 'string' } },
    closing: { type: 'string' },
  },
  required: ['subject', 'summary', 'opening', 'sections', 'demands', 'closing'],
};

export const LEGACY_STRUCTURED_LETTER_RETIRED =
  'The free-form forensic letter renderer is retired. Build new correspondence from the versioned CCC dispute-template library.';

/**
 * Historical rows keep their already-rendered HTML. Deliberately fail closed
 * if an old background job attempts to create a new Phase 1/Phase 3,
 * furnisher-first, or free-form letter through this renderer.
 */
export function renderStructuredLetter() {
  throw new Error(LEGACY_STRUCTURED_LETTER_RETIRED);
}
