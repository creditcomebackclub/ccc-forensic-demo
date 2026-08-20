#!/usr/bin/env node
import {
  clientCampaignDetail,
  clientCampaignLabel,
  isAccountDisputeCampaign,
  isBureauCampaign,
  isCccDisputeCampaign,
  isFileUpdateCampaign,
} from '../src/utils/clientCampaignCopy.js';

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

assert(isFileUpdateCampaign('Personal Info & Inquiries'), 'PI & Inquiries is file update');
assert(isFileUpdateCampaign('Personal Info Cleanup'), 'PI Cleanup is file update');
assert(isFileUpdateCampaign('Inquiry Removal'), 'Inquiry Removal is file update');
assert(!isFileUpdateCampaign('Phase 1'), 'Phase 1 is not file update');
assert(!isFileUpdateCampaign('Phase 3 — Experian'), 'Phase 3 is not file update');

assert(isBureauCampaign('Phase 3 — TransUnion'), 'Phase 3 is bureau');
assert(isBureauCampaign('Phase 4'), 'Phase 4 is bureau');
assert(!isBureauCampaign('Personal Info & Inquiries'), 'file update is not bureau campaign');
assert(isCccDisputeCampaign('CCC Dispute — Accuracy R1 — Equifax'), 'CCC round is recognized');

assert(isAccountDisputeCampaign('Phase 1'), 'Phase 1 is account dispute');
assert(isAccountDisputeCampaign('Phase 2'), 'Phase 2 is account dispute');
assert(!isAccountDisputeCampaign('Personal Info & Inquiries'), 'file update is not account dispute');
assert(!isAccountDisputeCampaign('Phase 3 — Equifax'), 'Phase 3 is not account dispute');

assert(clientCampaignLabel('Personal Info & Inquiries') === 'File update', 'label: file update');
assert(clientCampaignLabel('Phase 1') === 'Account dispute', 'label: account dispute');
assert(clientCampaignLabel('Phase 3 — Experian') === 'Credit Bureau Review', 'label: bureau review');
assert(clientCampaignLabel('CCC Dispute — Collection R1 — Experian') === 'CCC bureau dispute', 'label: CCC bureau dispute');

assert(clientCampaignDetail('Inquiry Removal') === 'Personal info & inquiry cleanup', 'detail: file update');
assert(clientCampaignDetail('Phase 1').includes('direct'), 'detail: account dispute');
assert(clientCampaignDetail('Phase 3 — TU').includes('Bureau'), 'detail: bureau');
assert(clientCampaignDetail('CCC Dispute — Consent R1 — TU').toLowerCase().includes('consent'), 'detail: CCC flow');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll client campaign copy assertions passed');
