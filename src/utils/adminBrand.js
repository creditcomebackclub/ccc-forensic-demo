// Canonical presentation tokens for the authenticated admin/auditor workspace.
// Keep these scoped to the operational shell: public, client, and affiliate
// experiences own their themes independently.
export const ADMIN_BRAND = Object.freeze({
  accent: '#38A9FF',
  accentStrong: '#0873BF',
  accentSoft: '#EAF6FF',
  ink: '#07111F',
  inkSoft: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',
  background: '#F4F8FC',
  surface: '#FFFFFF',
  border: '#D9E6F1',
  borderStrong: '#B9D8F1',
  shadow: '0 1px 2px rgba(7,17,31,0.04), 0 10px 30px rgba(30,91,130,0.06)',
});

export const ADMIN_THEME_VARS = Object.freeze({
  '--ccc-admin-accent': ADMIN_BRAND.accent,
  '--ccc-admin-accent-strong': ADMIN_BRAND.accentStrong,
  '--ccc-admin-accent-soft': ADMIN_BRAND.accentSoft,
  '--ccc-admin-ink': ADMIN_BRAND.ink,
  '--ccc-admin-ink-soft': ADMIN_BRAND.inkSoft,
  '--ccc-admin-muted': ADMIN_BRAND.muted,
  '--ccc-admin-faint': ADMIN_BRAND.faint,
  '--ccc-admin-bg': ADMIN_BRAND.background,
  '--ccc-admin-surface': ADMIN_BRAND.surface,
  '--ccc-admin-border': ADMIN_BRAND.border,
  '--ccc-admin-border-strong': ADMIN_BRAND.borderStrong,
  '--ccc-admin-shadow': ADMIN_BRAND.shadow,
});
