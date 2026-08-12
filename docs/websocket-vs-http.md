# WebSocket vs HTTP

| Concern | HTTP | WebSocket (Socket.IO) |
|---|---|---|
| Typical use here | Load HTML/CSS/JS and health endpoint | Live chat, ready status, answer result, state broadcast |
| Connection | Request/response; each request is independent | One long-lived bidirectional connection |
| Latency | Headers and polling overhead per action | Small event messages after handshake |
| Direction | Client normally initiates | Server can push updates to both rooms |
| Failure handling | Browser retries a request | Socket.IO reconnects and updates connection status |

HTTP is ideal for static assets and REST-style operations. WebSocket is better for this game because one player's action must immediately reach the other player's screen. Socket.IO adds event semantics and reconnect behavior over WebSocket transports.
