#!/usr/bin/env python3
"""Negative and reproducibility canary for the private IP zSSH ZIP."""

import importlib.util
import json
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build-private-plugin.py"
spec = importlib.util.spec_from_file_location("private_builder", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("private builder loader unavailable")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def must_reject(url: str):
    try:
        builder.validate_private_url(url)
    except ValueError:
        return
    raise AssertionError(f"unsafe URL accepted: {url!r}")


for bad in (
    "http://198.244.191.182/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.12/mcp",
    "https://192.168.1.2/mcp",
    "https://zssh.example.org/mcp",
    "https://198.244.191.182:8443/mcp",
    "https://198.244.191.182/mcp?token=do-not-embed",
    "https://198.244.191.182/mcp#secret",
    "https://user:pass@198.244.191.182/mcp",
    "https://198.244.191.182/other",
    "https://198.244.191.182/mcp\nAuthorization: Bearer bad",
):
    must_reject(bad)

url = "https://198.244.191.182/mcp"
assert builder.validate_private_url(url) == url
dist = ROOT / "dist"
dist.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=dist, prefix="private-plugin-canary-") as directory:
    first = builder.build(url, Path(directory) / "one.zip")
    second = builder.build(url, Path(directory) / "two.zip")
    assert first["sha256"] == second["sha256"], "ZIP must be reproducible"
    with zipfile.ZipFile(first["zip"]) as package:
        assert package.testzip() is None
        assert {"plugin.json", "mcp.json", "assets/icon.svg", "skills/setup/SKILL.md", "README.txt"} == set(package.namelist())
        plugin = json.loads(package.read("plugin.json"))
        mcp = json.loads(package.read("mcp.json"))
        assert plugin["name"] == "zssh-private"
        assert plugin["version"] == builder.VERSION
        assert plugin["extensions"]["com.openai"]["onboardingSkill"] == "./skills/setup/SKILL.md"
        assert "review" not in plugin["extensions"]["com.openai"]
        assert "publication" not in plugin["extensions"]["com.openai"]
        assert mcp["mcpServers"]["zssh"]["url"] == url
        assert mcp["mcpServers"]["zssh"]["extensions"]["com.openai"]["auth"] == {
            "type": "api_key", "headerScheme": "bearer",
        }
        assert "headers" not in mcp["mcpServers"]["zssh"]
        assert "name: setup" in package.read("skills/setup/SKILL.md").decode("utf-8")
        assert "OAuth" not in json.dumps(mcp), "private ZIP must not request OAuth"
        assert "cheapgpt.shop" not in str(package.namelist())

print("ZSSH_PRIVATE_IP_PLUGIN_CANARY_GREEN")
