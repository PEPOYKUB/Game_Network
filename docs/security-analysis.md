# Network Security Analysis

## Threats

- **Room spoofing / unauthorized join:** room codes are short and currently act as a demo access token.
- **Answer tampering:** a malicious browser could emit arbitrary Socket.IO events.
- **Eavesdropping:** plain `http://` and `ws://` expose chat and answers on an untrusted LAN.
- **Host exposure:** binding to `0.0.0.0` makes the server reachable by every interface allowed by the firewall.
- **Denial of service:** a peer can send oversized or too many messages.

## Current mitigations

The server limits names, commands and chat text, caps a room at two players, and rate-limits terminal commands (10 per 2 seconds per socket). Answers are never compared client-side: the ground truth for every stage stays on the server, each room only receives its own view, and a stage passes only when the simulated network behaves correctly. Room codes are random 4-digit numbers; an empty room is deleted 10 minutes after its last player disconnects.

## Production hardening

Use HTTPS/WSS with TLS, authenticated invite tokens instead of a guessable room code, rate limiting and payload schemas, CSRF/origin allowlists, structured audit logs, and a reverse proxy. Keep PostgreSQL credentials server-side, use Prisma migrations with least-privilege DB roles, and never trust client-supplied score or player side. For a classroom LAN demo, private Wi-Fi/VLAN plus a Windows Firewall rule scoped to the local subnet is recommended.
