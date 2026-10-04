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
listing = builder.listing_urls("https://mcp.review.example/mcp")
plugin["extensions"]["com.openai"]["interface"].update(listing)
builder.validate_plugin(plugin, listing)

mcp = load_json(ROOT / "submission" / "mcp.template.json")
mcp["mcpServers"]["zssh"]["url"] = "https://mcp.review.example/mcp"
builder.validate_mcp_config(mcp, "https://mcp.review.example/mcp")

unknown_tool = copy.deepcopy(plugin)
unknown_tool["extensions"]["com.openai"]["review"]["test_cases"]["positive"][0]["tools_triggered"] = "totally_unreviewed_tool"
expect_failure(lambda: builder.validate_plugin(unknown_tool, listing), "references unreviewed tools")

missing_write = copy.deepcopy(plugin)
positive = missing_write["extensions"]["com.openai"]["review"]["test_cases"]["positive"]
for case in positive:
    if "zssh_write_file" in case["tools_triggered"]:
        case["tools_triggered"] = "zssh_read_file"
expect_failure(lambda: builder.validate_plugin(missing_write, listing), "exercise every public write tool")

credentials_in_zip = copy.deepcopy(plugin)
credentials_in_zip["extensions"]["com.openai"]["review"]["test_credentials"] = {"username": "reviewer"}
expect_failure(lambda: builder.validate_plugin(credentials_in_zip, listing), "must stay out of the public plugin ZIP")

missing_release_notes = copy.deepcopy(plugin)
missing_release_notes["extensions"]["com.openai"]["publication"]["release_notes"] = ""
expect_failure(lambda: builder.validate_plugin(missing_release_notes, listing), "publication.release_notes")

unversioned_release_notes = copy.deepcopy(plugin)
unversioned_release_notes["extensions"]["com.openai"]["publication"]["release_notes"] = "Public release candidate with scoped Linux operations."
expect_failure(
    lambda: builder.validate_plugin(unversioned_release_notes, listing),
    "must mention the exact plugin version",
)

cross_origin_listing = copy.deepcopy(plugin)
cross_origin_listing["extensions"]["com.openai"]["interface"]["supportURL"] = "https://support.example.net/zssh"
expect_failure(
    lambda: builder.validate_plugin(cross_origin_listing, listing),
    "canonical same-origin public review URL",
)

extra_server = copy.deepcopy(mcp)
extra_server["mcpServers"]["other"] = {
    "type": "streamable-http",
    "url": "https://other.example/mcp",
}
expect_failure(
    lambda: builder.validate_mcp_config(extra_server, "https://mcp.review.example/mcp"),
    "exactly one MCP server named zssh",
)


review_cases = plugin["extensions"]["com.openai"]["review"]["test_cases"]["positive"]
review_case_text = json.dumps(review_cases, sort_keys=True)
if "ZSSH_ALLOWED_ROOTS" in review_case_text:
    raise AssertionError("public submission review cases must not reference private ZSSH_ALLOWED_ROOTS")
if "ZSSH_PUBLIC_ALLOWED_ROOTS" not in review_case_text:
    raise AssertionError("public submission review cases must name ZSSH_PUBLIC_ALLOWED_ROOTS for reviewer file access")

print("OPENAI_SUBMISSION_CONTRACT_CANARY_GREEN")
