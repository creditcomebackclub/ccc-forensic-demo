/** Fieldwork letter stylesheet — unique skin, print-friendly, no CCC navy/gold. */
export const FIELDWORK_LETTER_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Figtree', 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.55;
    margin: 0;
    padding: 0.7in 0.75in;
    max-width: 8.5in;
    color: #07131f;
    word-wrap: break-word;
    font-size: 13.5px;
  }
  .fw-letter-mark {
    font-family: 'Syne', 'Figtree', sans-serif;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: -0.02em;
    color: #07131f;
    margin: 0 0 4px;
  }
  .fw-letter-mark span { color: #169e6f; }
  .fw-phase {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #14505f;
    margin: 0 0 18px;
  }
  .date-line { margin-bottom: 18px; }
  .sender-block, .recipient-block { margin-bottom: 16px; line-height: 1.35; }
  .re-line {
    font-weight: 700;
    margin: 0 0 18px;
    padding: 10px 12px;
    border-left: 3px solid #169e6f;
    background: #f2f5f7;
  }
  .section-header {
    background: #0c2436;
    color: #ffffff;
    font-weight: 700;
    padding: 7px 12px;
    margin: 22px 0 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
  }
  .section-header.accent {
    background: #14505f;
  }
  .id-table, .list-table, .demands-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
    table-layout: fixed;
    word-wrap: break-word;
  }
  .id-table td {
    padding: 8px 12px;
    border: 1px solid rgba(7, 19, 31, 0.12);
    font-size: 13px;
    vertical-align: top;
  }
  .id-table td.label {
    font-weight: 700;
    background: #f2f5f7;
    width: 32%;
    color: #14505f;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .list-table th, .list-table td {
    padding: 8px 10px;
    border: 1px solid rgba(7, 19, 31, 0.12);
    font-size: 12.5px;
    text-align: left;
    vertical-align: top;
  }
  .list-table th {
    background: #0c2436;
    color: #fff;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .list-table tr:nth-child(even) td { background: #f8fafb; }
  .list-table td.reported { color: #6b7c89; }
  .list-table td.challenge {
    background: rgba(46, 230, 166, 0.08);
    color: #07131f;
  }
  .demands-table td {
    padding: 8px 12px;
    border: 1px solid rgba(7, 19, 31, 0.12);
    font-size: 13px;
    vertical-align: top;
  }
  .demands-table td.demand-num {
    background: #14505f;
    color: #fff;
    font-weight: 700;
    text-align: center;
    width: 36px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  .body-copy { margin: 0 0 12px; }
  .closing-statement {
    font-weight: 700;
    margin: 20px 0;
  }
  .signature-block { margin-top: 40px; }
  .sig-line {
    margin-top: 18px;
    min-height: 56px;
    width: 260px;
    border-bottom: 1px solid #07131f;
  }
  .sig-line img {
    display: block;
    max-height: 56px;
    max-width: 220px;
  }
  .printed-name { margin-top: 6px; font-weight: 700; }
  .rights-line {
    font-size: 12px;
    color: #6b7c89;
    margin-top: 2px;
  }
  .mail-notation {
    margin-top: 28px;
    font-style: italic;
    color: #14505f;
  }
  .enclosures {
    margin-top: 10px;
    font-size: 12.5px;
    color: #6b7c89;
  }
`;

export function wrapFieldworkLetterHtml(bodyInnerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Fieldwork dispute letter</title>
<style>${FIELDWORK_LETTER_CSS}</style>
</head>
<body>
${bodyInnerHtml}
</body>
</html>`;
}

export function isFieldworkLetterHtml(text) {
  return typeof text === 'string' && /<!DOCTYPE html|<table|class=['"]id-table/i.test(text);
}
