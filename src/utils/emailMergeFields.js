const FIELD = /\{\{\s*([a-z]+\.[a-zA-Z]+)\s*\}\}/g;

function valueMap({ client = {}, account = {}, round = {} } = {}) {
  return {
    'client.name': client.name || '',
    'client.address': client.address || '',
    'account.furnisher': account.furnisher || account.display_furnisher || '',
    'round.number': round.roundNumber ?? round.round_number ?? '',
    'round.targetType': round.targetType || round.target_type || '',
    'round.status': round.status || '',
  };
}
export function resolveEmailMergeFields(template, context) {
  const values = valueMap(context);
  const unknown = [];
  const rendered = String(template || '').replace(FIELD, (match, key) => {
    if (!(key in values)) {
      unknown.push(key);
      return match;
    }
    return String(values[key]);
  });
  if (unknown.length) throw new Error(`Unknown email merge field${unknown.length === 1 ? '' : 's'}: ${[...new Set(unknown)].join(', ')}`);
  return rendered;
}

export function plainTextToSafeHtml(text, escapeHtml) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
