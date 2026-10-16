#!/usr/bin/env python3
"""Build a private, manual-install zSSH Agent Plugin ZIP for an owned HTTPS IPv4 endpoint.

This builder is distinct from build-openai-plugin.py: no public submission, DNS
publication, reviewer fixture, or OAuth provider is required. Authentication is
client-managed Bearer; secrets are NEVER embedded in the package.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import shutil
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.3-private.1"
SCHEMA_PLUGIN = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
SCHEMA_MCP = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"


def validate_private_url(value: str) -> str:
    if not value or re.search(r"[\x00-\x20]", value):
        raise ValueError("MCP endpoint cannot be empty or contain whitespace")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("private MCP requires HTTPS without URL credentials")
    if parsed.path != "/mcp" or parsed.query or parsed.fragment:
        raise ValueError("MCP endpoint must be an exact /mcp path without query or fragment")
    try:
        port = parsed.port
        ip = ipaddress.ip_address(parsed.hostname or "")
    except ValueError as exc:
        raise ValueError("MCP endpoint must be an IPv4 address with valid port") from exc
    if port not in (None, 443):
        raise ValueError("private plugin only supports standard HTTPS port 443")
    if ip.version != 4 or not ip.is_global:
        raise ValueError("MCP endpoint must use publicly routable IPv4")
    return value


def make_files(url: str) -> dict[str, bytes]:
    url = validate_private_url(url)
    manifest = json.loads((ROOT / "submission/plugin.template.json").read_text(encoding="utf-8"))
    manifest["name"] = "zssh-private"
    manifest["version"] = VERSION
    manifest["description"] = "Securely connect to a private zSSH Linux gateway by HTTPS IPv4 and client-managed Bearer credentials."
    manifest["$schema"] = SCHEMA_PLUGIN

    ext = manifest["extensions"]["com.openai"]
    ext.pop("review", None)
    ext.pop("publication", None)
    ext["onboardingSkill"] = "./skills/setup/SKILL.md"
    interface = ext["interface"]
    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        interface.pop(key, None)
    interface["displayName"] = "zSSH Private"
    interface["shortDescription"] = "Connect to your private VPS"
    interface["longDescription"] = (
        "Access only the tools exposed by your own zSSH private MCP gateway. "
        "Use a valid HTTPS certificate for the IP address and provide a Bearer "
        "token through the client connection settings. This ZIP has no secrets "
        "and cannot bypass server-side permissions."
    )
    interface["capabilities"] = ["Inspect authenticated Linux server state", "Use authorized zSSH tools"]
    interface["defaultPrompt"] = [
        "Help me connect zSSH Private to my VPS.",
        "Check my zSSH connection and show available tools.",
        "Show the status of my connected Linux server.",
    ]

    mcp = {
        "$schema": SCHEMA_MCP,
        "mcpServers": {
            "zssh": {
                "type": "streamable-http",
                "url": url,
                "extensions": {
                    "com.openai": {
                        "auth": {"type": "api_key", "headerScheme": "bearer"}
                    }
                },
            }
        },
    }
    private_skill = ROOT / "submission/skills/private-setup/SKILL.md"
    source_icon = ROOT / "submission/assets/icon.svg"
    if not private_skill.is_file() or not source_icon.is_file():
        raise ValueError("missing private setup skill or zSSH icon")
    return {
        "plugin.json": (json.dumps(manifest, indent=2) + "\n").encode(),
        "mcp.json": (json.dumps(mcp, indent=2) + "\n").encode(),
        "skills/setup/SKILL.md": private_skill.read_bytes(),
        "assets/icon.svg": source_icon.read_bytes(),
        "README.txt": (
            "zSSH Private " + VERSION + "\n\n"
            "MCP endpoint: " + url + "\n"
            "Authentication: client-managed Bearer token (api_key).\n"
            "This private ZIP does not contain credentials or publish your MCP.\n"
            "Install manually in a compatible plugin client. Use the included "
            "setup skill for authentication and TLS troubleshooting.\n"
            "Certificate MUST validate for the exact IP; never disable TLS checks.\n"
            "Private API-key setup depends on the installing client's support; "
            "public plugin submission forms may not support API keys.\n"
            "Source: https://github.com/Zennay/zSSH\n"
        ).encode(),
    }


def build(url: str, output: Path) -> dict:
    files = make_files(url)
    output = output.resolve()
    if output == ROOT or ROOT not in output.parents:
        raise ValueError("ZIP destination must be inside the zSSH repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w") as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    with zipfile.ZipFile(output) as check:
        if check.testzip() is not None:
            raise ValueError("invalid ZIP")
        if set(check.namelist()) != set(files):
            raise ValueError("incomplete ZIP")
        auth = json.loads(check.read("mcp.json"))["mcpServers"]["zssh"]["extensions"]["com.openai"]["auth"]
        if auth != {"type": "api_key", "headerScheme": "bearer"}:
            raise ValueError("private auth must be client-managed Bearer")
        if b"Authorization: Bearer " in check.read("mcp.json"):
            raise ValueError("secret credential embedded")
    return {
        "zip": str(output),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "size": output.stat().st_size,
        "version": VERSION,
        "auth": "client-managed-bearer",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mcp-url", required=True)
    parser.add_argument("--output", default=str(ROOT / "dist/zssh-private-ip-plugin.zip"))
    args = parser.parse_args()
    print(json.dumps(build(args.mcp_url, Path(args.output)), sort_keys=True))


if __name__ == "__main__":
    main()
