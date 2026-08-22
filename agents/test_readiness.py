"""Focused, dependency-free tests for the Render readiness contract."""

import ast
from pathlib import Path
import unittest


SOURCE_PATH = Path(__file__).with_name("concierge_agent.py")
SOURCE_TREE = ast.parse(SOURCE_PATH.read_text(encoding="utf-8"))


def _load_readiness_symbols():
    wanted_assignments = {
        "_READINESS_SENTINEL_PORTAL_USER_ID",
        "_READINESS_SENTINEL_CLIENT_ID",
    }
    wanted_functions = {
        "_postgrest_error",
        "_probe_database_contract",
        "readiness",
    }
    nodes = []
    for node in SOURCE_TREE.body:
        if isinstance(node, ast.Assign):
            names = {
                target.id for target in node.targets if isinstance(target, ast.Name)
            }
            if names & wanted_assignments:
                nodes.append(node)
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id in wanted_assignments:
                nodes.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in wanted_functions:
                node.decorator_list = []
                nodes.append(node)

    namespace = {}
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, str(SOURCE_PATH), "exec"), namespace)
    return namespace


class FakePostgrestError(Exception):
    def __init__(self, code, message):
        super().__init__({"code": code, "message": message})
        self.code = code
        self.message = message


class FakeRequest:
    def __init__(self, *, error=None, data=None):
        self.error = error
        self.data = data

    def select(self, _columns):
        return self

    def limit(self, _count):
        return self

    def execute(self):
        if self.error:
            raise self.error
        return type("Result", (), {"data": self.data})()


class FakeSupabase:
    def __init__(self, *, table_error=None, rpc_error=None, rpc_data=None):
        self.table_error = table_error
        self.rpc_error = rpc_error
        self.rpc_data = rpc_data
        self.table_names = []
        self.rpc_calls = []

    def table(self, name):
        self.table_names.append(name)
        return FakeRequest(error=self.table_error, data=[])

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return FakeRequest(error=self.rpc_error, data=self.rpc_data)


class FakeHTTPException(Exception):
    def __init__(self, *, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class DatabaseContractProbeTests(unittest.TestCase):
    def setUp(self):
        self.ns = _load_readiness_symbols()

    def _probe(self, fake):
        self.ns["supabase"] = fake
        return self.ns["_probe_database_contract"]()

    def test_hardened_canonical_gate_is_ready_without_inserting(self):
        fake = FakeSupabase(
            rpc_error=FakePostgrestError(
                "42501", "The client portal identity is ambiguous"
            )
        )
        self.assertTrue(self._probe(fake))
        self.assertEqual(fake.table_names, ["portal_concierge_events"])
        self.assertEqual(len(fake.rpc_calls), 1)
        rpc_name, params = fake.rpc_calls[0]
        self.assertEqual(rpc_name, "ccc_begin_portal_concierge_request")
        self.assertEqual(params["p_portal_user_id"], "00000000-0000-0000-0000-000000000000")
        self.assertEqual(params["p_client_id"], "00000000-0000-0000-0000-000000000000")
        self.assertIsNone(params["p_handoff_reason"])

    def test_legacy_limiter_contract_is_not_ready(self):
        fake = FakeSupabase(
            rpc_error=FakePostgrestError(
                "42501", "Exact client portal mapping required"
            )
        )
        self.assertFalse(self._probe(fake))

    def test_missing_rpc_is_not_ready(self):
        fake = FakeSupabase(
            rpc_error=FakePostgrestError(
                "PGRST202", "Could not find the function"
            )
        )
        self.assertFalse(self._probe(fake))

    def test_missing_event_table_stops_before_rpc(self):
        fake = FakeSupabase(
            table_error=FakePostgrestError(
                "42P01", 'relation "portal_concierge_events" does not exist'
            )
        )
        self.assertFalse(self._probe(fake))
        self.assertEqual(fake.rpc_calls, [])

    def test_unexpected_success_fails_closed(self):
        self.assertFalse(self._probe(FakeSupabase(rpc_data={"allowed": True})))


class ReadinessEndpointTests(unittest.TestCase):
    def setUp(self):
        self.ns = _load_readiness_symbols()
        self.ns["HTTPException"] = FakeHTTPException

    def test_configuration_failure_short_circuits_database_probe(self):
        calls = []
        self.ns["_configuration_missing"] = lambda: ["SUPABASE_URL"]
        self.ns["_database_contract_ready"] = lambda: calls.append(True) or True
        with self.assertRaises(FakeHTTPException) as raised:
            self.ns["readiness"]()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(calls, [])

    def test_database_contract_failure_returns_503(self):
        self.ns["_configuration_missing"] = lambda: []
        self.ns["_database_contract_ready"] = lambda: False
        with self.assertRaises(FakeHTTPException) as raised:
            self.ns["readiness"]()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(
            raised.exception.detail,
            "Required database contract is unavailable",
        )

    def test_ready_only_when_both_gates_pass(self):
        self.ns["_configuration_missing"] = lambda: []
        self.ns["_database_contract_ready"] = lambda: True
        self.assertEqual(self.ns["readiness"](), {"status": "ready"})


if __name__ == "__main__":
    unittest.main()
