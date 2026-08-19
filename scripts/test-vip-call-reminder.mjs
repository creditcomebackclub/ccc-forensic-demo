#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test: { vipCallReminderHtml, vipCallAlreadyBookedThisMonth } } = require('../netlify/functions/daily-cron.cjs');

let failed = 0;
function assert(condition, message) {
  if (condition) console.log('ok:', message);
  else { failed += 1; console.error('FAIL:', message); }
}

assert(!vipCallAlreadyBookedThisMonth(null, '2026-08'), 'a client with no VIP call booking is still reminder-eligible');
assert(!vipCallAlreadyBookedThisMonth('2026-07-15T18:00:00Z', '2026-08'), 'a booking from a prior month does not suppress this month\'s reminder');
assert(vipCallAlreadyBookedThisMonth('2026-08-01T18:00:00Z', '2026-08'), 'a booking already scheduled this month suppresses the reminder');

const html = vipCallReminderHtml({ name: 'Jordan' });
assert(html.includes('creditcomebackclub/monthly-vip-call'), 'reminder email links to the VIP Calendly booking page');
assert(html.includes('Jordan'), 'reminder email greets the client by first name');
assert(vipCallReminderHtml({ name: '' }).includes('there'), 'reminder email falls back to a generic greeting without a name');

if (failed) {
  console.error(`\n${failed} VIP call reminder assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll VIP call reminder assertions passed');
