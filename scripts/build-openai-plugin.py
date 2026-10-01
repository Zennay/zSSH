#!/usr/bin/env python3
"""Build and validate the portable OpenAI Agent Plugin ZIP for zSSH."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = ROOT / "submission"
DEFAULT_OUT = ROOT / "dist" / "openai-plugin"
DEFAULT_ICON = SUBMISSION / "assets" / "icon.svg"
PUBLIC_TOOL_CONTRACT = SUBMISSION / "public-tool-contract.json"


def fail(message: str) -> None:
    raise SystemExit("PLUGIN_PACKAGE_ERROR: " + message)


def https_url(value: str, field: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        fail(f"{field} must be an HTTPS URL without embedded credentials")
    return value


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"cannot parse {path.relative_to(ROOT)}: {exc}")


def validate_icon(path: Path) -> str:
    if not path.is_file():
        fail(f"icon does not exist: {path}")
    if path.stat().st_size <= 0 or path.stat().st_size > 5 * 1024 * 1024:
        fail("icon must be non-empty and no larger than 5 MiB")

    suffix = path.suffix.lower()
    if suffix == ".svg":
        try:
            root = ET.fromstring(path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"invalid SVG icon: {exc}")
        viewbox = root.attrib.get("viewBox", "").split()
        if len(viewbox) == 4:
            try:
                width, height = float(viewbox[2]), float(viewbox[3])
            except ValueError:
                fail("SVG icon viewBox must contain numeric dimensions")
        else:
            def numeric(value: str | None) -> float:
                if value is None or not re.fullmatch(r"\d+(?:\.\d+)?", value):
                    fail("SVG icon needs a square numeric width/height or square viewBox")
                return float(value)
            width, height = numeric(root.attrib.get("width")), numeric(root.attrib.get("height"))
        if width != height or width < 48:
            fail("SVG icon must be square and at least 48 by 48")
    elif suffix == ".png":
        data = path.read_bytes()
        if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
            fail("invalid PNG icon")
        width, height = struct.unpack(">II", data[16:24])
        if width != height or width < 48 or width > 4096:
            fail("PNG icon must be square and between 48 and 4096 pixels")
    else:
        fail("submission builder currently accepts SVG or PNG icons")

    return suffix


def parse_tools_triggered(value: str) -> list[str]:
    tools = [item.strip() for item in str(value or "").split(",") if item.strip()]
    if not tools:
        fail("positive review tools_triggered must name at least one public tool")
    if len(tools) != len(set(tools)):
        fail("positive review tools_triggered must not contain duplicate tool names")
    return tools


def validate_mcp_config(mcp: dict, expected_url: str) -> None:
    if mcp.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json":
        fail("mcp.json uses the wrong Agent Plugins schema")
    servers = mcp.get("mcpServers")
    if not isinstance(servers, dict) or set(servers) != {"zssh"}:
        fail("zSSH submission must declare exactly one MCP server named zssh")
    server = servers["zssh"]
    if server.get("type") != "streamable-http":
        fail("zSSH MCP server must use streamable-http")
    if server.get("url") != expected_url:
        fail("zSSH MCP server URL must match the validated public MCP URL")


def validate_plugin(plugin: dict) -> None:
    if plugin.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
        fail("plugin.json uses the wrong Agent Plugins schema")
    name = plugin.get("name", "")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 64:
        fail("plugin name must be lowercase kebab-case and at most 64 characters")

    ext = plugin.get("extensions", {}).get("com.openai", {})
    interface = ext.get("interface", {})
    required_lengths = {
        "displayName": 30,
        "shortDescription": 30,
        "longDescription": 4000,
        "developerName": 80,
    }
    for field, limit in required_lengths.items():
        value = interface.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            fail(f"interface.{field} is required and must be at most {limit} characters")
        if field != "longDescription" and ("\n" in value or "\r" in value):
            fail(f"interface.{field} must be one line")

    if interface.get("category") != "Developer Tools":
        fail("zSSH submission category must remain Developer Tools")

    caps = interface.get("capabilities")
    if not isinstance(caps, list) or len(caps) > 20 or any(not isinstance(x, str) or not x.strip() or len(x) > 120 or "\n" in x for x in caps):
        fail("capabilities must contain at most 20 one-line values of at most 120 characters")

    for field in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        https_url(str(interface.get(field, "")), "interface." + field)

    prompts = interface.get("defaultPrompt", [])
    if isinstance(prompts, str):
        prompts = [prompts]
    if not isinstance(prompts, list) or len(prompts) > 3:
        fail("defaultPrompt must contain at most three prompts")
    normalized = set()
    for prompt in prompts:
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 128 or "\n" in prompt or "\r" in prompt:
            fail("starter prompts must be non-empty one-line strings of at most 128 characters")
        if "@" in prompt:
            fail("starter prompts must not contain MCP @mentions")
        key = " ".join(prompt.split()).casefold()
        if key in normalized:
            fail("starter prompts must be unique")
        normalized.add(key)

    review = ext.get("review", {})
    for forbidden in ("test_credentials", "reviewer_instructions"):
        if forbidden in review:
            fail(f"review.{forbidden} must stay out of the public plugin ZIP")

    public_tools = read_json(PUBLIC_TOOL_CONTRACT)
    if not isinstance(public_tools, dict) or not public_tools:
        fail("public tool contract must be a non-empty object")
    if any(scope not in {"zssh:read", "zssh:write"} for scope in public_tools.values()):
        fail("public tool contract contains an unsupported OAuth scope")

    cases = review.get("test_cases", {})
    positive = cases.get("positive", [])
    negative = cases.get("negative", [])
    if len(positive) != 5 or len(negative) != 3:
        fail("initial MCP review requires exactly five positive and three negative cases")
    reviewed_tools = set()
    for index, case in enumerate(positive, 1):
        for field in ("description", "prompt", "tools_triggered", "expected_behavior"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                fail(f"positive review case {index} is missing {field}")
        triggered = parse_tools_triggered(case["tools_triggered"])
        unknown = sorted(set(triggered) - set(public_tools))
        if unknown:
            fail(f"positive review case {index} references unreviewed tools: {', '.join(unknown)}")
        reviewed_tools.update(triggered)

    uncovered_writes = sorted(
        name for name, scope in public_tools.items()
        if scope == "zssh:write" and name not in reviewed_tools
    )
    if uncovered_writes:
        fail("positive review cases must exercise every public write tool: " + ", ".join(uncovered_writes))
    for index, case in enumerate(negative, 1):
        for field in ("description", "prompt"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                fail(f"negative review case {index} is missing {field}")

    https_url(str(review.get("demo_recording_url", "")), "review.demo_recording_url")
    if review.get("commerce") is not False:
        fail("zSSH review metadata must declare commerce=false")

    publication = ext.get("publication", {})
    release_notes = publication.get("release_notes")
    if not isinstance(release_notes, str) or not release_notes.strip():
        fail("publication.release_notes is required for the review-ready package")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-url", default=os.getenv("ZSSH_PLUGIN_MCP_URL", ""))
    parser.add_argument("--demo-url", default=os.getenv("ZSSH_PLUGIN_DEMO_RECORDING_URL", ""))
    parser.add_argument("--icon", default=os.getenv("ZSSH_PLUGIN_ICON", str(DEFAULT_ICON)))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    mcp_url = https_url(args.mcp_url, "MCP URL")
    if urlparse(mcp_url).path.rstrip("/") != "/mcp":
        fail("MCP URL must point to the public /mcp endpoint")
    demo_url = https_url(args.demo_url, "demo recording URL")

    if not args.icon:
        fail("ZSSH_PLUGIN_ICON or --icon is required for a submission build")
    icon_source = Path(args.icon).expanduser().resolve()
    icon_suffix = validate_icon(icon_source)

    plugin = read_json(SUBMISSION / "plugin.template.json")
    package_metadata = read_json(ROOT / "package.json")
    if plugin.get("version") != package_metadata.get("version"):
        fail("submission plugin version must match package.json version")
    mcp = read_json(SUBMISSION / "mcp.template.json")
    plugin["extensions"]["com.openai"]["review"]["demo_recording_url"] = demo_url
    icon_ref = "./assets/icon" + icon_suffix
    interface = plugin["extensions"]["com.openai"]["interface"]
    interface["composerIcon"] = icon_ref
    interface["logo"] = icon_ref
    mcp["mcpServers"]["zssh"]["url"] = mcp_url

    validate_mcp_config(mcp, mcp_url)
    validate_plugin(plugin)

    out_dir = Path(args.out_dir).resolve()
    if out_dir == ROOT or ROOT not in out_dir.parents:
        fail("output directory must stay inside the repository")
    shutil.rmtree(out_dir, ignore_errors=True)
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "plugin.json").write_text(json.dumps(plugin, indent=2) + "\n", encoding="utf-8")
    (out_dir / "mcp.json").write_text(json.dumps(mcp, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(icon_source, assets_dir / ("icon" + icon_suffix))

    zip_path = out_dir.parent / "zssh-openai-plugin.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(out_dir.rglob("*")):
            if not file.is_file():
                continue
            relative = file.relative_to(out_dir).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o644 & 0xFFFF) << 16
            archive.writestr(info, file.read_bytes())

    bundle_sha256 = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    print(json.dumps({
        "ok": True,
        "version": plugin["version"],
        "package_dir": str(out_dir),
        "zip": str(zip_path),
        "zip_sha256": bundle_sha256,
        "mcp_url": mcp_url,
        "positive_cases": 5,
        "negative_cases": 3,
        "reviewed_public_tools": len(read_json(PUBLIC_TOOL_CONTRACT)),
        "icon": icon_ref,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
