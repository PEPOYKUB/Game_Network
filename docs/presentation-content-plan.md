# CP422011 Presentation Content Plan

## Direction

Use the Canva reference as a visual direction: vintage escape-room / detective-board mood, cream paper background, hand-drawn black outlines, dark brown body text, red accent for danger/problem, and small evidence-style illustrations around the frame. The content should remain a technical networking proposal, not a generic game pitch.

Recommended length: 11 slides for a 7–10 minute presentation.

## Slide-by-slide content

### 1. Cover — 20–30 seconds

**Title:** Two Rooms, One Network

**Subtitle:** A 2D cooperative networking escape-room game for CP422011 Computer Networking

**Footer:** Group [number] · [student names / IDs] · [course / faculty / year]

**Visuals:** both pixel characters facing the locked gateway, a hand-drawn network cable, a small terminal, and the red stamp `CASE FILE: NETWORK LINK`.

### 2. Problem and motivation — 40–50 seconds

**Main message:** Networking concepts are often learned as isolated commands and diagrams. Players should experience cause-and-effect by solving a network failure together.

**Points:**

- Students can memorize `ping`, routing, DNS, and ports without understanding how they relate.
- Traditional exercises do not force communication between two viewpoints.
- The game turns packet flow, reachability, routing, and service discovery into cooperative evidence.

**Visuals:** split illustration: one player sees one room/evidence board, the other sees a different room/evidence board, with a locked gate between them.

### 3. Objectives — 30–40 seconds

**Learning objectives:**

1. Explain and apply ICMP reachability, routing paths, DNS resolution, and service ports.
2. Practice interpreting command output instead of guessing an answer.
3. Communicate incomplete information with a partner to diagnose a shared network.

**Game objectives:**

1. Build a playable 2D multiplayer prototype.
2. Synchronize player movement and authoritative puzzle state.
3. Unlock three rooms and reunite both players at the final gateway.

**Visuals:** three hand-drawn objective cards with icons: learn, cooperate, unlock.

### 4. Game concept and core loop — 50–60 seconds

**Core loop:**

`Explore room → approach terminal → press E → run command → compare evidence → solve together → open gate → meet at gateway → next room`

**Rules:**

- Two players start in separate rooms and cannot see each other.
- Each player has a different side of the evidence.
- Both correct terminal actions are required.
- The server validates commands and controls gate progression.

**Visuals:** 5-step horizontal storyboard using the two attached characters, terminal, CMD window, gate, and handshake.

### 5. Level design: three networking rooms — 2 minutes

| Room | Networking problem | Command / evidence | Unlock condition |
|---|---|---|---|
| 01 ICMP Handshake | Is the peer reachable? | `ping 10.0.0.2` and packet loss/latency evidence | Both players validate reachability |
| 02 Routing Blackhole | Which hop breaks the path? | `traceroute 10.30.0.10` with a missing hop | Both identify the failed route |
| 03 DNS Service Discovery | Where is the gateway service? | `nslookup gateway.lab` and A-record evidence | Both resolve the correct service |

**Difficulty design:** each room gives each player only partial evidence; the command alone is not enough. They must communicate output, infer the fault, and use the correct target.

**Visuals:** three mini room maps, one per level, with terminal and gateway markers.

### 6. User Interface / User Experience — 50–60 seconds

**Controls:** `WASD` move, `E` interact, `ESC` close terminal.

**HUD elements:**

- Mission status and current room.
- Door state: locked / waiting / open.
- Ping acknowledgement.
- Terminal prompt and command result.
- Remote player indicator after the gate opens.

**UX principle:** never show the full question as a static quiz list. The player discovers the terminal, interacts with it, and receives contextual feedback.

**Visuals:** gameplay screenshot with callouts: player, terminal, HUD, gateway, CMD overlay.

### 7. Technical architecture — 60 seconds

**Client:** Phaser.js 2D Canvas renderer, custom pixel characters, keyboard input, scene/map rendering.

**Server:** Node.js + Express + Socket.IO. The server is authoritative for room membership, player positions, command validation, gate state, and stage progression.

**Data layer:** Prisma schema prepared for PostgreSQL session persistence; demo mode uses in-memory room state for easy LAN hosting.

**Deployment:** one Host runs the Node server; two browsers connect to the same LAN/public URL.

**Visual:** Network Architecture Diagram: Player A browser ↔ Socket.IO server ↔ Player B browser, with optional PostgreSQL below the server.

### 8. Multiplayer sequence — 50–60 seconds

**Example: terminal command to gate opening:**

1. Player A walks to terminal and presses `E`.
2. Client opens the CMD overlay.
3. Player A sends `ping-quest` to the server.
4. Server validates the command and records A's completion.
5. Player B repeats the action.
6. Server sets `doorOpen = true` and broadcasts the new state.
7. Both clients render the open gateway.
8. Both players stand near the gateway and press `E`; server advances the stage only after both are ready.

**Visual:** Sequence Diagram with A, browser client, Socket.IO server, B, and gateway.

### 9. WebSocket vs HTTP — 40–50 seconds

**HTTP:** serves the game page, assets, and health endpoint using request/response.

**WebSocket / Socket.IO:** keeps a live bidirectional channel for movement, terminal results, door state, remote player visibility, and stage progression.

**Why it matters:** a door state or player movement must reach the other screen immediately; polling would add delay and unnecessary requests.

**Visuals:** side-by-side comparison card, with an HTTP envelope icon and a continuous WebSocket cable.

### 10. Security analysis — 50–60 seconds

**Threats:** room-code guessing, command spoofing, movement tampering, LAN eavesdropping, oversized messages, and host exposure.

**Current protections:** server-authoritative validation, two-player room cap, input length limits, stage checks, and no client-side score authority.

**Production hardening:** HTTPS/WSS, authenticated invite tokens, rate limiting, payload schema validation, origin allowlist, audit logs, least-privilege PostgreSQL role, and a firewall limited to the classroom subnet.

**Visuals:** evidence board with red pins labelled `SPOOF`, `SNIFF`, `FLOOD`, and green countermeasure tags.

### 11. Prototype result, limitations, and next steps — 40–50 seconds

**Completed prototype:**

- 2D Phaser map with two separated rooms and central gateway.
- Attached pixel characters with crop-to-content rendering and movement.
- Multiplayer room join, remote player sync, terminal interaction, ping validation, and gate progression.
- Three networking stages designed for the proposal.

**Limitations:** demo state is in memory; the current command validator is scripted; production hosting needs HTTPS/WSS and persistent storage.

**Next steps:** richer tiles/assets, real command-output evidence, PostgreSQL session history, more fault scenarios, reconnect recovery, and classroom playtesting.

**Visuals:** final gameplay screenshot showing both rooms, open gateway, and both characters; add a small `NEXT BUILD` checklist.

## Required visual assets

### Must use from the project

1. `public/assets/character-left.png` — Player A character.
2. `public/assets/character-right.png` — Player B character.
3. Gameplay screenshot before gate open — proves separated-room concept.
4. Gameplay screenshot after gate open — proves co-op reunion.
5. Terminal/CMD overlay screenshot — proves contextual interaction.
6. Room map screenshot — proves three-room progression.

### Must create as diagrams

1. Network Architecture Diagram.
2. Sequence Diagram: action → server → broadcast → gate.
3. Three-room progression map.
4. WebSocket vs HTTP comparison.
5. Security threat/countermeasure board.

### Decorative visuals for Canva theme

- Hand-drawn network cable and RJ45 plug.
- Terminal cursor / command prompt.
- Router, switch, server rack, DNS label, route-map pin, packet envelope.
- Red evidence strings and paper labels.
- Small room-number cards: `CASE 01`, `CASE 02`, `CASE 03`.

## Information still needed before final slide production

- Group number.
- Student names and student IDs.
- Course/faculty/year text exactly as required.
- Final project title spelling.
- Whether the instructor requires a specific citation style.
- Whether screenshots should show Thai UI, English UI, or mixed terminology.

