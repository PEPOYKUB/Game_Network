# Multiplayer 03: Items and sabotage — implementation groundwork

## Scope in this repository

The current application contains the cooperative A/B stage game only. Its room model has two player slots, shared stage completion, and no FFA/2v2 team identities. The competitive room/mode code is not present in this checkout. The authoritative item domain logic is therefore isolated in `server/game/items.js`; it does not alter cooperative stage rules or expose item actions through the current Socket.IO handlers.

## Chosen item behavior

| Item | Server effect |
|---|---|
| Config Erase | Restores one server-approved configuration key on one valid opponent to that stage's default. The competitive mode adapter must apply the restore to its own authoritative configuration state. |
| Config Glitch | Marks one server-approved configuration key as glitched for 2 seconds. The adapter should display a dismissible warning and clear the visual/functional glitch when the effect ends; there is no repair interaction. |
| Shield | Protects its owner from the next incoming attack for up to 2 seconds. It is consumed on a block or expires unused. |
| Reflect | Reflects the next incoming attack to its sender for up to 2 seconds. It is consumed once; reflected attacks are marked and bypass defense resolution to prevent loops. |
| Switch / Lever | A fixed scene interaction point, not a collectible. Server validates range and applies a 2-second disruption to eligible opponents. Each switch has a random 10–20 second activation cooldown. |

## Balance defaults

- Server schedules a spawn every random 10–20 seconds throughout the match; Switch/Lever also has a random 10–20 second per-point cooldown.
- A drop expires after 15 seconds. At most one drop remains on the map at a time.
- Inventory holds at most 3 collectible items. Switch/Lever is a scene interaction and does not occupy an inventory slot.
- Timed effects last 2 seconds. There is no per-round item use limit.
- Spawn positions must be supplied from the selected map's server-owned allowlist. The drop's type, position and expiry are server-generated.
- Pickup checks membership, phase, expiration, capacity, authoritative player-to-drop distance, and a player-scoped request ID. Duplicate requests replay the original response rather than applying the action twice.

## Competitive adapter contract

When competitive mode is added, its room handler should own one `createItemState()` per match and:

1. Call `tickItems()` from a server timer, passing only allowed map spawn points. Broadcast only spawn/expiry and the requesting player's inventory.
2. Call `pickUpItem()` with membership, phase and distance derived from the server's room/player state. Never accept client-provided item type, position, distance or expiration.
3. Resolve target IDs against server-owned player/team data before `useItem()`. Pass `target.eligible`, `target.finished`, `target.sameTeam`, and the target's allowlisted `configKeys` from the server. Client target/config selections are selectors only and must be checked against those values.
4. Apply returned `config-erase` / `config-glitch` effects to the competitive mode's authoritative configuration engine. Keep the full effect payload server-side; broadcast only generic status, such as “กำลังถูกรบกวน” plus remaining duration. `publicItems()` follows this rule and does not expose the affected config key or attacker identity.
5. For Switch/Lever, resolve the fixed point and player coordinates server-side, then call `activateSwitch()` with the server-derived reach check and eligible opponents.
6. Re-send `publicItems()` after reconnect. The item state is keyed to stable player IDs so reconnecting does not duplicate inventory or drops.

The current cooperative game has no appropriate opponent targets, no competitive config state, and no competitive map interaction contract. Wiring these events into its existing A/B room would make teammates valid targets or damage shared puzzle state, so the isolated module is the safe boundary until the competitive mode update arrives.
