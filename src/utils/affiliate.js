// Display label for an affiliate row across Leads UI. Kept in one place so
// the format never drifts between the tile badge and the two select lists.
export function affiliateLabel(a) {
  if (!a || !a.name) return '';
  return a.name + (a.company ? ' · ' + a.company : '');
}
