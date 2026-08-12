# Network Architecture Diagram

```mermaid
flowchart LR
  A[Player A browser\nPhaser UI + Socket.IO] ---|WebSocket / TCP 3000| H[Host machine\nNode.js + Express + Socket.IO]
  B[Player B browser\nPhaser UI + Socket.IO] ---|LAN WebSocket / TCP 3000| H
  H --> S[Room state\nplayers, puzzle, chat]
  H -. optional persistence .-> P[(PostgreSQL\nvia Prisma)]
```

Host-based design keeps the authoritative game state on one student's machine. Browsers never connect directly to each other; all actions are validated and broadcast by Socket.IO. PostgreSQL is optional for demo mode and can store session history, scores, and solved counts in a production version.
