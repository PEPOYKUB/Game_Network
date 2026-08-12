# ตัวอย่างเนื้อหาและภาพสำหรับสไลด์ 4–8

ใช้กับธีม Canva แนว Escape Room / Detective: พื้นครีม เส้นกรอบน้ำตาล ตัวอักษรดำ และ accent สีแดง

## Slide 4 — Game Loop

**หัวข้อ:** ทุกห้องใช้ loop เดียวกัน: สำรวจ → วิเคราะห์ → ปลดล็อก

**ข้อความบนสไลด์:**

`01 EXPLORE  →  02 TERMINAL  →  03 COMMAND  →  04 GATE  →  05 MEET`

**คำอธิบายสั้น:**

ผู้เล่นสองคนเริ่มต้นคนละห้อง มองไม่เห็นกัน ต้องเดินไปหา Network Terminal กด E และใช้คำสั่ง networking เพื่อแลกเปลี่ยนหลักฐาน เมื่อทั้งสองคนทำภารกิจสำเร็จ ประตูจะเปิดและต้องเดินมาที่ Gateway พร้อมกัน

**รูปที่ใส่:**

- ตัวละครคนที่ 1 อยู่ฝั่งซ้าย
- ตัวละครคนที่ 2 อยู่ฝั่งขวา
- ไอคอน Terminal
- ไอคอน CMD prompt
- ประตูเหล็ก/สาย network ที่เปิดออก

**Layout:** วางเป็น timeline 5 วงกลมต่อกันกลางหน้า ใช้สีแดงเน้นขั้น `MEET`

## Slide 5 — Level Design

**หัวข้อ:** 3 ห้อง = 3 ปัญหา Network ที่ยากขึ้น

| ห้อง | ปัญหา | คำสั่ง | สิ่งที่ต้องคิด |
|---|---|---|---|
| ROOM 01: ICMP HANDSHAKE | ตรวจว่าอีกห้อง reachable หรือไม่ | `ping 10.0.0.2` | packet loss / reply / timeout |
| ROOM 02: ROUTING BLACKHOLE | หา hop ที่ทำให้ packet หาย | `traceroute 10.30.0.10` | วิเคราะห์เส้นทางและจุดที่ขาด |
| ROOM 03: DNS DISCOVERY | ค้นหา gateway service | `nslookup gateway.lab` | อ่าน DNS record และปลายทาง |

**ข้อความปิดท้าย:**

คำสั่งเป็นเพียงจุดเริ่มต้น ผู้เล่นต้องสื่อสารหลักฐานจากคนละห้องและตีความร่วมกันจึงจะผ่านด่านได้

**รูปที่ใส่:**

- แผนที่ห้อง 1 สีฟ้า
- แผนที่ห้อง 2 สีม่วง
- ห้อง 3 เป็นห้อง server / DNS สีแดงเข้ม
- ไอคอน ping, route map, DNS server

**Layout:** ใช้ 3 แถวแนวนอน แถวละหนึ่งห้อง พร้อมเลข `01 / 02 / 03` แบบป้ายแฟ้มคดี

## Slide 6 — UX / UI

**หัวข้อ:** คำถามจะปรากฏเมื่อผู้เล่นค้นพบ Terminal เท่านั้น

**ข้อความบนสไลด์:**

- `WASD` = เดินสำรวจ
- `E` = ใช้งาน Terminal
- `ESC` = ปิด CMD
- HUD แสดงสถานะห้อง ประตู และ Ping acknowledgement

**UX flow:**

`เดินเข้าใกล้ Terminal → กด E → พิมพ์ command → ได้ผลลัพธ์ → รอ partner → ประตูเปิด`

**ข้อความสำคัญ:**

เราไม่แสดงคำถามเป็นรายการ quiz ค้างบนจอ แต่ให้ผู้เล่นค้นพบ interaction จากโลกของเกม ทำให้เกมรู้สึกเหมือน escape room มากกว่าแบบทดสอบทั่วไป

**รูปที่ใส่:**

- Screenshot ฉากเกมที่มีตัวละครและ Terminal
- Screenshot CMD window
- ลูกศร callout ชี้ไปที่ HUD / Terminal / Gateway

**Layout:** ซ้ายเป็นภาพ gameplay ขวาเป็น CMD overlay และวาง control legend ด้านล่าง

## Slide 7 — Network Architecture

**หัวข้อ:** Server เป็นผู้ถือความจริงของเกม ทุก client เห็น state เดียวกัน

**ข้อความบนสไลด์:**

**Player A Browser**

Phaser 2D + Socket.IO Client

**Node.js Host Server**

Express + Socket.IO + Room State

**Player B Browser**

Phaser 2D + Socket.IO Client

**Optional:** PostgreSQL via Prisma สำหรับเก็บ session, score และประวัติการเล่น

**สิ่งที่ server ควบคุม:**

- Room membership
- Player positions
- Command validation
- Door state
- Stage progression

**รูปที่ใส่:**

- Browser icon คนที่ 1
- Server / router icon ตรงกลาง
- Browser icon คนที่ 2
- เส้น WebSocket สองทิศทาง
- Database icon ใต้ server

**Layout:** ทำเป็น diagram แนวนอน 3 กล่อง เชื่อมด้วยลูกศรสีแดง และวาง database ใต้ server

## Slide 8 — Multiplayer Sequence

**หัวข้อ:** Command หนึ่งครั้งจะกลายเป็น event ที่แชร์ให้ทั้งห้อง

**Sequence:**

1. Player A เดินถึง Terminal และกด `E`
2. Client เปิด CMD overlay
3. Player A ส่ง `ping-quest` ไปยัง server
4. Server validate command และบันทึกว่า A ผ่าน
5. Player B ทำคำสั่งของตัวเอง
6. Server พบว่าทั้งคู่ผ่าน จึงตั้งค่า `doorOpen = true`
7. Server broadcast state ไปยัง client ทั้งสอง
8. ผู้เล่นทั้งสองเดินมาที่ Gateway และกด `E` เพื่อเข้า room ถัดไป

**ตัวอย่าง event:**

```text
Player A → submit command
Server  → validate + update state
Server  → broadcast doorOpen
Player A / Player B → render open gateway
```

**รูปที่ใส่:**

- ตัวละคร A
- Server กลาง
- ตัวละคร B
- Gateway
- ลูกศรตามลำดับ action → server → broadcast

**Layout:** ใช้เส้นแนวตั้ง 4 คอลัมน์แบบ sequence diagram และใช้สีแดงกับ event ที่ทำให้ประตูเปิด

