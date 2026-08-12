# Two Rooms, One Network

เกม 2D cooperative networking puzzle สำหรับ CP422011: ผู้เล่นสองคนอยู่คนละห้องและสื่อสารกันผ่าน WebSocket เพื่อปลดล็อกประตูเชื่อมห้อง

## Run บน LAN

```bash
npm install
npm run dev
```

Host เปิด `http://localhost:3000` และเพื่อนเปิด `http://<HOST-LAN-IP>:3000` ใช้ room code เดียวกัน เช่น `DEMO01` เครื่องที่รัน server ต้องอนุญาต inbound TCP port 3000 ใน Windows Firewall

## Stack

- Client: Phaser.js dependency พร้อม UI prototype แบบ responsive (ระบบปริศนาใช้ DOM เพื่ออ่านง่ายในเดโม)
- Server: Node.js, Express, Socket.IO, host-based room state
- Data: Prisma schema สำหรับ PostgreSQL; ปัจจุบันใช้ in-memory session เพื่อรันเดโมได้ทันที และพร้อมต่อ persistence ด้วย `prisma migrate dev`

## Gameplay

ผู้เล่นเข้าห้องเดียวกัน คนแรกจะอยู่ LEFT คนที่สอง RIGHT กด READY แล้วสื่อสารคำใบ้ผ่านช่องแชต ด่าน 4 ชุดคือ subnet matching, rogue MAC, traceroute และ suspicious port เมื่อแก้ครบ ประตู network link จะเปิด

ตัวละคร 2D อยู่ที่ `public/assets/character-left.png` และ `public/assets/character-right.png` จากภาพที่ผู้ใช้ให้มา พื้นหลังสีขาวจะถูกทำให้โปร่งใสตอนโหลดเข้า Phaser และมี walk animation แบบ bob/หันซ้าย-ขวา ควบคุมด้วย `WASD` หรือปุ่มลูกศร

## 3-room progression

1. `ROOM 01 // ICMP HANDSHAKE` — ทั้งสองฝั่งใช้ `ping 10.0.0.2`
2. `ROOM 02 // ROUTING BLACKHOLE` — ทั้งสองฝั่งใช้ `traceroute 10.30.0.10` เพื่อวิเคราะห์ hop ที่หาย
3. `ROOM 03 // DNS SERVICE DISCOVERY` — ทั้งสองฝั่งใช้ `nslookup gateway.lab`

หลังคำสั่งของทั้งสองคนถูกต้อง ประตูจะเปิด ต้องเดินมาที่ Gateway กลางห้องพร้อมกัน แล้วกด `E` เพื่อย้ายไปห้องถัดไป

## Documents

- [Network architecture](docs/network-architecture.md)
- [Sequence diagram](docs/sequence-diagram.md)
- [WebSocket vs HTTP](docs/websocket-vs-http.md)
- [Network security analysis](docs/security-analysis.md)
