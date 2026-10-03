# Public secret-exfiltration red-team hardening — 2026-10-03

## Scope

This review covers the public zSSH MCP profile only. The goal is to make public file reads/writes fail closed when model-controlled content contains credentials, even when the credential is not written as `token=...` or `Authorization: Bearer ...`.

## Current primary sources checked

- OpenAI Plugins Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Plugin Guidelines:
  https://developers.openai.com/plugins/plugin-guidelines
- OpenAI MCP server guide:
  https://developers.openai.com/plugins/build/mcp-server
- OpenAI remote MCP review requirements:
  https://developers.openai.com/plugins/deploy/app-review

## Platform requirements driving the change

Current OpenAI guidance says to:

- treat every tool input as untrusted;
- validate authorization and parameters on the server;
- keep secrets and sensitive data out of tool metadata and results;
- minimize tool responses to data required for the user task;
- assume prompt injection and malicious inputs can reach the MCP server;
- avoid collecting or processing access credentials/authentication secrets in public plugins.

## Red-team finding

The existing zSSH public file boundary already rejected:

- secret-looking paths such as `.env`, private-key extensions, and credential directories;
- PEM/OpenSSH private-key blocks;
- Bearer tokens;
- labelled values such as `token=...`, `password=...`, and `api_key=...`;
- zSSH client-token format.

However, an allowed ordinary text file containing a raw provider credential with no label could pass the content gate. Examples include raw OpenAI-style secret keys, GitHub tokens, AWS access-key IDs, Google API keys, Slack tokens, JWTs, or credentials embedded in an authority URL.

That creates a prompt-injection/data-exfiltration failure mode: malicious or accidental content inside an otherwise allowed file could be returned to the model.

## Decision

The public secret detector is extended with conservative high-confidence raw credential signatures.

Detection/redaction covers:

- OpenAI-style `sk-...` keys;
- GitHub classic/application token prefixes and fine-grained `github_pat_...` tokens;
- AWS `AKIA` / `ASIA` access-key IDs;
- Google `AIza...` API keys;
- Slack `xox...` tokens;
- JWT-shaped three-segment tokens beginning with a JSON-object header;
- passwords embedded in URI authority sections;
- existing labelled/Bearer/zSSH/private-key patterns.

Common private-key filenames such as `id_rsa`, `id_dsa`, `id_ecdsa`, and `id_ed25519` are also rejected even if copied into an otherwise allowed root.

## Boundary

This detector is defense in depth, not a substitute for:

- dedicated public allowed roots;
- OAuth + local pairing;
- least-privilege target data;
- avoiding secrets in reviewer fixtures;
- local filesystem permissions.

Patterns should stay high-confidence to avoid turning ordinary source code or prose into false positives. New provider patterns require a regression corpus before release.
