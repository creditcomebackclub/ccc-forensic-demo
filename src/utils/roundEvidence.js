export function buildPriorRoundLeverageBlock({ priorTargetType, nextTargetType, priorLetterHtml, priorLetterSummary, priorResponseClassification, priorResponseSummary }) {
  const transition = `${priorTargetType || 'furnisher'}->${nextTargetType}`;
  const framing = {
    'furnisher->bureau': 'A direct furnisher dispute preceded this CRA dispute. Use the furnisher outcome as evidence requiring an independent CRA reinvestigation; keep the CRA and furnisher statutory duties separate.',
    'bureau->bureau': 'This is a supplemental CRA dispute after the prior CRA reinvestigation failed to resolve the supported issues. Identify what the bureau did not substantively address without repeating unsupported premises.',
    'bureau->furnisher': 'This direct furnisher dispute follows a CRA reinvestigation that stalled or failed to correct the supported reporting. Center the factual CRA outcome while stating the furnisher direct-dispute duties under Regulation V accurately.',
    'furnisher->furnisher': 'This is a renewed direct dispute to the furnisher. State the new evidence or unresolved response defect that prevents it from being a mere duplicate, and do not claim CRA-notice duties have already attached.',
  }[transition];
  if (!framing) throw new Error(`Unsupported dispute-round transition: ${transition}`);
  return `PRIOR-ROUND LEVERAGE (${transition}):\n${framing}\n\nPrior letter summary:\n${priorLetterSummary || 'No separate summary stored.'}\n\nPrior response classification: ${priorResponseClassification || 'No document response; use only the reviewed non-response record.'}\nPrior response summary: ${priorResponseSummary || 'No additional response summary stored.'}\n\nPRIOR LETTER HTML (evidence; correct unsupported premises rather than copying them):\n${priorLetterHtml || ''}`;
}
