#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const agentUrl = new URL('../agents/concierge_agent.py', import.meta.url);
const agent = readFileSync(agentUrl, 'utf8');

assert.doesNotMatch(
  agent,
  /"score_changes"\s*:\s*diff\.get|"removed_accounts"\s*:/,
  'raw progress-diff fields must not be copied into external-model context',
);
assert.match(agent, /progress = \[_safe_progress_summary\(row\) for row in progress_rows\]/);

const pythonProbe = String.raw`
import ast
import math
import re
import sys
from typing import Any

source_path = sys.argv[1]
source = open(source_path, encoding="utf-8").read()
tree = ast.parse(source, filename=source_path)
wanted_assignments = {
    "_ssn_pattern", "_card_pattern", "_credential_pattern", "_email_pattern",
    "_phone_pattern", "_birth_detail_pattern", "_street_address_pattern",
    "_address_value_pattern", "_po_box_pattern", "_bank_number_pattern",
    "_health_detail_pattern", "_unformatted_identifier_pattern",
}
wanted_functions = {
    "_reject_sensitive_message", "_safe_progress_number", "_safe_progress_summary",
}
nodes = []
for node in tree.body:
    if isinstance(node, ast.Assign):
        names = {target.id for target in node.targets if isinstance(target, ast.Name)}
        if names & wanted_assignments:
            nodes.append(node)
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted_functions:
        nodes.append(node)

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail

scope = {"Any": Any, "HTTPException": HTTPException, "math": math, "re": re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), source_path, "exec"), scope)
reject = scope["_reject_sensitive_message"]
summarize = scope["_safe_progress_summary"]

sensitive_messages = [
    "My SSN is 123-45-6789",
    "My number is 123456789",
    "Email me at client@example.com",
    "Call me at (970) 644-0063",
    "My date of birth is January 2, 1990",
    "I live at 123 Main Street",
    "My mailing address is 77 Main",
    "Send it to P.O. Box 52",
    "My routing number is 123456789",
    "My checking account is 123456",
    "I was diagnosed with diabetes",
]
for message in sensitive_messages:
    try:
        reject(message)
    except HTTPException as exc:
        assert exc.status_code == 400, (message, exc.status_code)
    else:
        raise AssertionError("sensitive message was accepted: " + message)

for message in [
    "What happened with Capital One ending 1234?",
    "When was my latest letter mailed?",
    "How do I upload proof of address?",
]:
    reject(message)

sentinel = "DO_NOT_SEND_INTERNAL_DIFF"
summary = summarize({
    "from_report_date": "2026-07-01",
    "to_report_date": "2026-08-01",
    "diff": {
        "scoreDeltas": {
            "equifax": {"old": 600, "new": 640, "delta": 40, "notes": sentinel},
            "experian": {"old": "secret", "new": 700, "delta": 10},
            "transunion": {"old": 650, "new": 900, "delta": float("inf")},
            "internal": {"prompt": sentinel},
        },
        "negativeCounts": {"before": 5, "after": 3, "staff_notes": sentinel},
        "totalDebtRemoved": 335000,
        "deleted": [{"furnisher": sentinel, "accountNumber": "123456789"}],
        "violations": [{"statute": sentinel}],
        "phase_progress": {"internal": sentinel},
    },
})
assert summary == {
    "from_report_date": "2026-07-01",
    "to_report_date": "2026-08-01",
    "score_changes": {
        "equifax": {"old": 600, "new": 640, "delta": 40},
        "experian": {"old": None, "new": 700, "delta": 10},
        "transunion": {"old": 650, "new": None, "delta": None},
    },
    "negative_accounts": {"before": 5, "after": 3},
    "debt_removed": 335000,
}, summary
assert sentinel not in repr(summary)
`;

const probe = spawnSync('python3', ['-c', pythonProbe, agentUrl.pathname], {
  encoding: 'utf8',
});
assert.equal(
  probe.status,
  0,
  `concierge privacy behavior probe failed:\n${probe.stdout}\n${probe.stderr}`,
);

console.log('Concierge sensitive-input and model-context privacy assertions passed.');
