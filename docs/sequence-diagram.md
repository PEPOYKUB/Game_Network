# Sequence Diagram: configure → verify → System Link ONLINE

Example: stage 8 (missing static route). Room B controls the router, Room A has the topology and the branch PC.

```mermaid
sequenceDiagram
  participant A as Room A (BRANCH-PC)
  participant S as Socket.IO server
  participant B as Room B (R-Branch)
  A->>S: term:exec "ping 192.168.100.10"
  S->>S: simulate with network_state (no route)
  S-->>A: Destination net unreachable
  A->>S: chat:send "ping ไม่ถึง DC — subnet 192.168.100.0/24, WAN 10.10.10.1"
  S-->>B: chat:msg
  B->>S: term:exec "route print"
  S-->>B: routing table (route is missing)
  B->>S: term:exec "add route 192.168.100.0 255.255.255.0 10.10.10.1"
  S->>S: update network_state, compare with ground truth (wrong → score event)
  S-->>A: activity (Room B is configuring)
  A->>S: term:exec "ping 192.168.100.10"
  S->>S: route matches truth and ping succeeds → stage passed
  S-->>A: Reply from 192.168.100.10
  S-->>A: stage:complete + room:state (link ONLINE)
  S-->>B: stage:complete + room:state (link ONLINE)
```

Socket.IO events used by the client: `room:create`, `room:join`, `room:leave`, `lobby:character`, `lobby:ready`, `lobby:swap`, `lobby:start`, `stage:catalog`, `stage:start`, `stage:quit`, `term:exec`, `form:submit`, `hint:reveal`, `chat:send`, `activity`. The server pushes `room:state`, `stage:view` (per room), `chat:history`, `chat:msg`, `activity` and `stage:complete`.
