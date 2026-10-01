# OpenAI MCP annotation justifications

These justifications correspond to the public `ZSSH_PLUGIN_PROFILE=public` tool scan. They are written for the OpenAI review form; they are not extra MCP annotation fields.

| Tool | readOnlyHint | Justification | destructiveHint | Justification | openWorldHint | Justification |
| --- | --- | --- | --- | --- | --- | --- |
| `get_profile` | true | Returns only the authenticated connection's opaque zSSH profile identity and does not mutate target or pairing state. | false | It cannot delete, overwrite, revoke, send, or mutate data. | false | It is limited to the caller's authenticated zSSH connection and does not access open-ended public entities. |
| `get_pairing_status` | false | When no request exists, it can create a short-lived local pairing request in the target registry. | false | Creating a pending pairing request does not grant access, overwrite user data, or revoke an existing grant. | false | It operates only on the bounded local zSSH pairing registry for this target. |
| `zssh_server_info` | true | Reads zSSH policy and Linux target identity/state without changing it. | false | It performs no write, delete, revoke, or irreversible action. | false | It reads only the explicitly paired private Linux target. |
| `get_system_uptime` | true | Executes the fixed read-only `uptime` program without a shell. | false | It cannot modify target state. | false | It reads only the paired Linux target. |
| `get_system_identity` | true | Executes the fixed read-only `id` program without a shell. | false | It cannot modify target state. | false | It reads only the paired Linux target. |
| `get_kernel_info` | true | Executes fixed `uname -a` without a shell. | false | It cannot modify target state. | false | It reads only the paired Linux target. |
| `get_disk_usage` | true | Executes fixed `df -h` without a shell. | false | It cannot modify target state. | false | It reads only the paired Linux target. |
| `get_memory_usage` | true | Executes fixed `free -h` without a shell. | false | It cannot modify target state. | false | It reads only the paired Linux target. |
| `zssh_read_file` | true | Reads one UTF-8 file only after the path resolves inside an explicit public allowed root; credential-like paths and content are rejected. | false | It does not create, replace, delete, or send files. | false | It is bounded to the dedicated public filesystem roots on the paired target and refuses common secret locations. |
| `zssh_write_file` | false | Creates or atomically replaces a UTF-8 file inside an explicit public allowed root; credential-like paths and content are rejected. | true | Replacing an existing file can overwrite prior user data, so the action is potentially destructive and must receive write-action friction. | false | It writes only inside dedicated public filesystem roots on the paired target and refuses common secret locations. |

## Review notes

The public plugin does not expose `zssh_exec` or `zssh_run_safe`. Generic command selection and raw shell are private-profile capabilities and are absent from the public MCP scan.

OAuth authentication and local pairing are enforced independently. A valid OAuth token is insufficient for target access until the target owner approves the opaque profile ID locally. Revoking that pairing causes subsequent target tool calls to fail.
