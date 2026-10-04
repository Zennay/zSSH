# Public pairing metadata minimization — 2026-10-04

## Primary source

OpenAI's current remote MCP review requirements explicitly advise developers to audit every user-related field returned by tools and remove unnecessary telemetry/internal identifiers such as request IDs, timestamps, internal account IDs, and logs. A user identifier should be returned only when it is necessary and directly tied to the user's intent.

Source:
- https://developers.openai.com/plugins/deploy/app-review

## zSSH finding

The public `get_pairing_status` response and connection card exposed two values that were not needed to complete pairing:

- the opaque internal `profile_id`;
- the absolute internal `expires_at` timestamp.

The short-lived `request_id` is different: the target owner must use that value to approve the pending request locally, so it is user-actionable and remains part of the public response.

## Decision

Minimize the public pairing contract to:

- `paired`;
- `pending`;
- `target_label`;
- `request_id` when a local approval is pending.

The gateway may continue to keep profile identity and expiry state internally for routing, revocation, cleanup, and authorization. They are not echoed by the public pairing status tool or its UI.

The dedicated OpenAI profile tool remains unchanged because its stable profile identifier is the purpose of that standardized profile surface.

## Regression policy

- The public MCP output schema must not advertise `profile_id` or `expires_at` on `get_pairing_status`.
- The connection-card HTML must not render the internal profile identifier.
- Unit coverage validates the exact minimized runtime object.
- The public plugin canary fails if either removed field reappears in the pairing schema or UI.
