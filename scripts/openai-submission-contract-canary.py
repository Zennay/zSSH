#!/usr/bin/env python3
"""Fail-closed regression canary for the public OpenAI submission package."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts" / "build-openai-plugin.py"

spec = importlib.util.spec_from_file_location("zssh_openai_plugin_builder", BUILDER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("cannot load OpenAI plugin builder")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expect_failure(fn, contains: str) -> None:
    try:
        fn()
    except SystemExit as exc:
        message = str(exc)
        if contains not in message:
            raise AssertionError(f"expected {contains!r} in failure, got {message!r}") from exc
        return
    raise AssertionError(f"expected failure containing {contains!r}")


plugin = load_json(ROOT / "submission" / "plugin.template.json")
plugin["extensions"]["com.openai"]["review"]["demo_recording_url"] = "https://review.example/zssh-demo"
builder.validate_plugin(plugin)

mcp = load_json(ROOT / "submission" / "mcp.template.json")
mcp["mcpServers"]["zssh"]["url"] = "https://mcp.review.example/mcp"
builder.validate_mcp_config(mcp, "https://mcp.review.example/mcp")

unknown_tool = copy.deepcopy(plugin)
unknown_tool["extensions"]["com.openai"]["review"]["test_cases"]["positive"][0]["tools_triggered"] = "totally_unreviewed_tool"
expect_failure(lambda: builder.validate_plugin(unknown_tool), "references unreviewed tools")

missing_write = copy.deepcopy(plugin)
positive = missing_write["extensions"]["com.openai"]["review"]["test_cases"]["positive"]
for case in positive:
    if "zssh_write_file" in case["tools_triggered"]:
        case["tools_triggered"] = "zssh_read_file"
expect_failure(lambda: builder.validate_plugin(missing_write), "exercise every public write tool")

credentials_in_zip = copy.deepcopy(plugin)
credentials_in_zip["extensions"]["com.openai"]["review"]["test_credentials"] = {"username": "reviewer"}
expect_failure(lambda: builder.validate_plugin(credentials_in_zip), "must stay out of the public plugin ZIP")

missing_release_notes = copy.deepcopy(plugin)
missing_release_notes["extensions"]["com.openai"]["publication"]["release_notes"] = ""
expect_failure(lambda: builder.validate_plugin(missing_release_notes), "publication.release_notes")

extra_server = copy.deepcopy(mcp)
extra_server["mcpServers"]["other"] = {
    "type": "streamable-http",
    "url": "https://other.example/mcp",
}
expect_failure(
    lambda: builder.validate_mcp_config(extra_server, "https://mcp.review.example/mcp"),
    "exactly one MCP server named zssh",
)

print("OPENAI_SUBMISSION_CONTRACT_CANARY_GREEN")
