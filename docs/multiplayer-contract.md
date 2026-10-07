# สัญญาข้อมูลและ Event ของโหมดแข่งขัน (งาน 1 — ใช้ต่อในงาน 2 และ 3)

โค้ด: `server/game/competitive.js` (FFA / 2v2) · `server/game/rooms.js` แยกตาม `room.mode`
ห้อง co-op (`mode: 'coop'`) ใช้ handler เดิมทุกตัว ไม่ผ่าน `competitive.js`

## Model

| ชื่อ | ความหมาย |
|---|---|
| `mode` | `'coop'` (2 คน A/B) · `'ffa'` (4 คน) · `'team'` (2v2) — กำหนดตอน `room:create` แล้วเปลี่ยนไม่ได้ |
| `playerId` | id ถาวรที่ client สร้างและเก็บไว้เอง ใช้ reconnect เท่านั้น **ไม่ broadcast ให้คนอื่น** |
| `seat` | `P1`–`P4` ตำแหน่งในห้อง (โหมดแข่งขัน) — ใช้แทนตัวผู้เล่นในทุก payload สาธารณะ |
| `teamId` | FFA: เท่ากับ `seat` · 2v2: `T1` / `T2` |
| `scope` | หน่วยแข่งขัน = หนึ่ง stage run อิสระ · FFA: ต่อคน · 2v2: ต่อทีม · **`scopeId === teamId` เสมอ** |
| `station` | ฝั่งคอมพิวเตอร์ที่ผู้เล่นเปิดอยู่ (`'A'`/`'B'`/`null`) — server ใช้เป็น role ของคำสั่ง/ฟอร์ม |
| `phase` | `lobby` → `select` → `play` → `ended` → (`stage:start` เริ่มใหม่ / `stage:quit` → `select`) |

```js
room.match = {
  stageId, seed, startedAt, endsAt, endedAt, endedReason,   // reason: 'winner' | 'timeout' | 'forfeit'
  scopes: { [scopeId]: { id, teamId, members: [seat], run, finishedAt, forfeited } },
  results: null | ResultRow[],
}
```

ทุก scope ใน match ใช้ seed เดียวกัน → โจทย์/ค่าเริ่มต้นเหมือนกัน แต่ `run.s` คนละ object

## กติกาจัดอันดับ (FFA และ 2v2 ใช้ฟังก์ชันเดียว `rankScopes`)

ต่อ scope เรียงตาม: 1) ไม่ถอนตัว 2) ผ่านด่าน 3) จำนวนเป้าหมายสำเร็จ (`objectivesOf(run)`) 4) คะแนน 5) เวลาน้อยกว่า
แถวที่เท่ากันทุกข้อได้อันดับเดียวกัน (1, 1, 3 …)

```js
ResultRow = { scopeId, teamId, members: [seat], rank, completed, forfeited, objectivesDone, objectivesTotal, score, elapsedMs }
```

- **จบเมื่อ**: scope แรกผ่านด่าน (`winner`) · หมดเวลา (`timeout`) · เหลือ scope ที่ยังแข่งได้ ≤ 1 (`forfeit`)
- `objectivesOf` ตอนนี้คืน `{ done: passed ? 1 : 0, total: 1 }` — **งาน 2 ต้องแทนด้วยเป้าหมายรายด่านจริง**

## ค่าตั้งต้น (`MODE_CONFIG`)

| ค่า | ค่าเริ่มต้น |
|---|---|
| `matchDurationMs` | 10 นาที |
| `disconnectGraceMs` | 60 วินาที — หลุดเกินนี้ระหว่าง `play` = ถอนตัว; scope ถอนตัวเมื่อสมาชิกถอนตัวครบ |
| `teamSize` | 2 — ใน lobby ทีมหนึ่งมีได้ชั่วคราว 3 คนเพื่อสลับทีม เริ่มได้เมื่อ 2/2 เท่านั้น |
| จัดทีม | ผู้เข้าห้องใหม่ถูกจัดเข้าทีมที่คนน้อยกว่า (เสมอ → T1) แล้วเลือกเองด้วย `lobby:team` |

## Client → Server (โหมดแข่งขัน)

| Event | Payload | หมายเหตุ |
|---|---|---|
| `room:create` | `{ name, playerId, mode: 'ffa'\|'team', sample, unlockAll }` | ack `{ ok, code, seat, role: seat, teamId, mode }` |
| `room:join` | `{ code, name, playerId }` | playerId เดิม = กลับเข้าที่เดิม; ระหว่าง `play`/`ended` คนใหม่ถูกปฏิเสธ |
| `lobby:team` | `{ teamId }` | 2v2 + lobby เท่านั้น |
| `lobby:ready` / `lobby:character` / `lobby:start` | เหมือน co-op | `lobby:start` ต้องครบ 4 + พร้อม (+ 2/2) |
| `stage:start` | `{ stageId }` | จาก `select` หรือ `ended` |
| `player:move` | `{ x, y }` | |
| `player:interact` | `{ open, role? }` | เปิดที่สถานีใกล้ตัว (`role` = ฝั่งที่อยากใช้ก่อน); ack `{ ok, open, role }` |
| `stage:role` | `{ role }` | สลับฝั่งได้เมื่อยืนใกล้สถานีฝั่งนั้นเท่านั้น |
| `term:exec` | `{ line, role? }` | role = station ของผู้เล่น; ส่ง role อื่นมา = ปฏิเสธ |
| `form:submit` | `{ data, role? }` | เหมือน `term:exec` |
| `hint:reveal` | `{ level }` | ผลส่งเป็น `hint:private` ให้สมาชิก scope เท่านั้น |
| `chat:send` | `{ text }` | 2v2: เฉพาะเพื่อนร่วมทีม · FFA: ทั้งห้อง |
| `stage:quit` | — | `play`: ถอนตัว · `ended`: กลับหน้าเลือกด่าน |

## Server → Client

| Event | ผู้รับ | Payload |
|---|---|---|
| `room:state` | รายคน | `{ code, phase, mode, you: seat, me: { seat, teamId, scopeId, station }, players: {seat: PublicPlayer}, teams, progress, run: publicRun(scope ของตัวเอง), activeRole, match: PublicMatch, stageProgress*, ffaResults* }` |
| `match:start` | ห้อง | `{ stageId, startedAt, endsAt, scopes: { [id]: { teamId, members, finished, forfeited } } }` |
| `match:end` | ห้อง | `{ stageId, reason, results: ResultRow[] }` |
| `stage:complete` | รายคน (ตอนจบ match) | `{ stageId, result, rank, reason }` |
| `stage:view` | รายคน | `roleView(run ของ scope ตัวเอง, station)` |
| `hint:private` | สมาชิก scope | `{ level, text, penalty }` |
| `room:players` | ห้อง | `{ players: {seat: PublicPlayer} }` |
| `room:progress`* | ห้อง | รูปแบบเดิมของ FFA (นับจำนวนการกระทำ) |

`PublicPlayer = { seat, teamId, name, charId, ready, connected, quit, roomSide, station, x, y, facing, direction, moving, terminal }`
`*` = เก็บไว้ให้ UI FFA เดิมทำงานต่อ งาน 2 จะแทน `room:progress`/`stageProgress` ด้วย projection ใหม่

ไม่มี payload ใดส่ง `truth`, `run.s`, `commandLog` หรือ `playerId` ของผู้อื่น (มีเทสต์ตรวจ)

## จุดต่อของงาน 2 และ 3

- **งาน 2**: คำนวณ progress ต่อ scope จาก `match.scopes[*].run` → แทน `objectivesOf` + `compatProgress`; ส่งพร้อม `version`; ใช้ `teamId`/`members` จาก `publicMatch`
- **งาน 3**: เป้าหมายไอเทม = `scopeId` (FFA คู่แข่ง 1 คน, 2v2 ทีมตรงข้าม 1 ทีม); ผู้ที่ใช้ได้ต้องผ่าน `inPlay()` (สมาชิก + `phase === 'play'` + ไม่ถอนตัว/ไม่จบ); scope ที่ `finishedAt` หรือ `forfeited` ไม่เป็นเป้าหมาย; ตำแหน่งผู้เล่นอยู่ที่ `room.seats[seat].x/y`
