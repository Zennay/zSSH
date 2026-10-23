# zSSH plugin

Let Claude (and ChatGPT) operate your own Linux servers.

1. Add the marketplace and install the plugin:
   - Claude Code: `/plugin marketplace add Zennay/zSSH`, then `/plugin install zssh@zssh`
   - Claude / ChatGPT apps: add the `Zennay/zSSH` marketplace in the plugin settings and install **zSSH**.
2. Sign in when the plugin asks (one account for all your servers).
3. Say "link my server" (or run `/zssh:setup`). You get one command; run it on your VPS as root.
4. Done: the server is linked. Ask things like "how full is the disk on web-1?".

The plugin talks to the hosted gateway at `https://zssh.zennay.nl`. The agent
on your VPS only dials out (no open ports) and runs as an unprivileged `zssh`
user. Shell access is opt-in per server (`--allow-shell`, on by default in the
command the plugin generates; generate one with `allow_shell: false` to skip it).
