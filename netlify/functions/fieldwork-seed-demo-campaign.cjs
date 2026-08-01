/**
 * Seeds a demo audit campaign into Fieldwork tables for a logged-in
 * subscriber — used when cloud mode is on but Anthropic Fieldwork key
 * is not yet configured. Never writes to CCC audits / letters / clients.
 */
const { requireFieldworkUser, getOrCreateSubscriber, fwRest, json } = require('./_fieldworkAuth.cjs');
const { fieldworkSupabase } = require('./_fieldworkEnv.cjs');

// Keep payload small — mirror of DIY demo summary for cloud persistence tests.
const SEED_AUDIT = {
  id: 'audit_fieldwork_seed',
  summary: {
    accountsReviewed: 18,
    actionableAccounts: 5,
    totalViolations: 11,
    crossBureauConflicts: 3,
    furnisherFirst: true,
  },
  methodologyNote:
    'Fieldwork audits Metro 2 base-segment fields against FCRA accuracy duties — furnisher first.',
  accounts: [
    {
      id: 'acc_midland',
      furnisher: 'Midland Credit Management',
      priority: 'high',
      violations: [{ field: '25', title: 'DOFD appears re-aged at acquisition', statute: 'FCRA §623(a)(5)' }],
    },
    {
      id: 'acc_capital',
      furnisher: 'Capital One',
      priority: 'high',
      violations: [{ field: '21', title: 'Balance disagrees across bureaus', statute: 'FCRA §607(b)' }],
    },
  ],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  try {
    const caller = await requireFieldworkUser(event);
    const subscriber = await getOrCreateSubscriber(caller, { email: caller.email });
    const { url, serviceKey } = fieldworkSupabase();

    const selected = SEED_AUDIT.accounts.filter((a) => a.priority === 'high').map((a) => a.id);
    const created = await fwRest('/rest/v1/fieldwork_campaigns', 'POST', serviceKey, url, {
      subscriber_id: subscriber.id,
      name: `Furnisher wave · ${new Date().toLocaleDateString()}`,
      status: 'ready',
      audit_json: SEED_AUDIT,
      selected_account_ids: selected,
    });

    if (!(created.status >= 200 && created.status < 300) || !created.body?.[0]) {
      return json(500, { error: created.body?.message || 'Failed to seed campaign' });
    }

    return json(200, {
      isolated: true,
      campaign: created.body[0],
      message: 'Seeded into fieldwork_campaigns only.',
    });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message || 'Seed failed' });
  }
};
