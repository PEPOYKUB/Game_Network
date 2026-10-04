# Room artwork, game screen and controls

Based on GitHub main `bcd180a`. Run the game through the Node server
(`npm run dev`, then open `http://localhost:3000/`). Opening `public/index.html`
directly cannot load root-relative assets or Socket.IO.

The four room illustrations (`public/assets/levels/map-0*-pastel.png`) and the
settings artwork (`public/assets/settings/parts/`) come from the team's art
folders. Keep the source artwork's aspect ratio: the illustrations are world
backgrounds with collision and interaction geometry shared by client and server
in `public/js/world.js`.

## Maps and movement

- `world.js` holds each map's floor, walls, obstacles, door gap, spawn points
  and computer stand points, measured in source-image pixels and normalised to
  a 1000-unit world. `test/world.test.js` checks image sizes, spawns, that every
  computer is reachable before the door opens, that the locked door keeps each
  player in their room, and that both players can meet once it opens.
- The server is authoritative: it applies the direction held since the previous
  `player:move` packet, and allows crossing the door only after the stage is
  passed (`room.run.passed`). E opens the terminal only within reach of the
  player's own computer.
- Each computer shows an E marker, a pulsing floor spot where to stand, and an
  arrow at the player's feet pointing to the nearest computer. The E marker
  moves beside the computer when a HUD card would cover it.

## Game screen

- The map is the main area, framed to the level's aspect over a blurred copy of
  the level art, with a floating stage card and key hints.
- Right column: timer, team (with door state and room code), mission checklist
  with the current step, hint and room-info buttons, and chat.
- Terminal opens as an in-world monitor over your own room (left for A, right
  for B). The right column then collapses to a rail (Terminal / mission / hints
  / chat) with a new-message popup and a current-step popup.
- Hints show no text until opened; penalties are the server's 5 / 10 / 15.
- Esc closes one layer at a time: sheet, chat popup, terminal, back to walking.

## Windows and settings

- `public/js/windows.js`: drag by the title bar, resize from any edge or corner,
  double-click the title bar to restore. Used by the mission, hint, terminal,
  chat popup, stage-clear and settings windows.
- Settings is a pixel window with tabs: sound (MASTER / BGM / SFX levels and
  YES/NO switches, test sound), window (remember positions, keep Terminal on
  top, reset all windows), controls and contact. Audio settings are stored in
  `localStorage` key `kuhu.settings`, window preferences in `kuhu.windows`.
