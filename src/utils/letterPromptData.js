/**
 * Claude receives only the identity fields needed to address a letter.
 * Audits, letters, campaigns, billing, and signatures must never leak into
 * another route's frozen evidence payload.
 */
export function clientForLetterPrompt(client) {
  if (!client || typeof client !== 'object') return client;
  const reportDate = client.reportDate
    || client.auditReportDate
    || client.latestAudit?.reportDate
    || client.audits?.[0]?.reportDate
    || null;
  return {
    id: client.id || null,
    name: client.name || client.fullName || null,
    address: client.address || null,
    dateOfBirth: client.dateOfBirth || client.date_of_birth || null,
    reportDate,
  };
}
