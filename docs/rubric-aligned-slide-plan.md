# Rubric-aligned slide plan

## Slide 1 — Related Work #1

**Room Escape at Class: Escape games เพื่อการเรียนรู้ Computer Networks**

**งานนี้คืออะไร:** นำรูปแบบ Room Escape มาใช้สอน Computer Networks และ Information Security สำหรับนักศึกษาวิศวกรรมศาสตร์

**ทำอะไร:** ผู้เรียนสร้าง IP packet และส่งอีเมลที่บีบอัดด้วย LZ77 เพื่อไขปริศนา

**ทำได้:** ใช้เนื้อหาวิชาจริงเป็นกลไกของเกม ทำให้ผู้เรียนลงมือปฏิบัติกับแนวคิด network

**ทำไม่ได้ / ข้อจำกัด:** ผู้เล่นอยู่ในกลุ่มเดียวกันและเห็นข้อมูลร่วมกันทั้งหมด ไม่มีบทบาทแยกหรือข้อมูลคนละส่วนระหว่างผู้เล่น

**รูป:** ภาพห้อง escape + IP packet + compressed email + กล่องสรุป limitation

**อ้างอิง:** [1] Borrego, C. et al. (2017). *Room escape at class: Escape games activities to facilitate motivation and learning in computer science.*

## Slide 2 — Related Work #2

**The Impact of a Digital Escape Room Focused on HTML and Computer Networks**

**งานนี้คืออะไร:** ศึกษาผลของ digital escape room ต่อนักเรียนอาชีวศึกษาสายช่างที่เรียน HTML และ Computer Networks

**ผลที่พบ:** เพิ่มแรงจูงใจ ความผูกพัน และความพึงพอใจของผู้เรียน

**ทำได้:** แสดงให้เห็นว่า escape room เหมาะกับการเรียนรู้เนื้อหา technical และทำให้ผู้เรียนมีส่วนร่วมมากขึ้น

**ทำไม่ได้ / ข้อจำกัด:** เป็น single-player ไม่มีการสื่อสารหรือทำงานร่วมกันแบบ real-time ระหว่างผู้เล่น

**รูป:** ภาพนักเรียนกับ digital escape room + กราฟ engagement + ป้าย single-player

**อ้างอิง:** [2] *The Impact of a Digital Escape Room Focused on HTML and Computer Networks on Vocational High School Students.* Education Sciences, 12(10), 682 (2022).

## Slide 3 — งานของเราคืออะไรและทำงานอย่างไร

**Two Rooms, One Network**

**งานของเราคืออะไร:** เกม 2D cooperative networking escape room สำหรับผู้เล่น 2 คน

**ฟังก์ชันหลัก:**

- เดินสำรวจด้วย WASD
- แยกผู้เล่นคนละห้องและมองไม่เห็นกัน
- เดินไปหา Terminal แล้วกด E
- เปิด CMD และใช้คำสั่ง networking
- ส่งผลลัพธ์ผ่าน WebSocket
- ปลดล็อกประตูเมื่อทั้งสองคนแก้โจทย์สำเร็จ
- เดินมาที่ Gateway พร้อมกันเพื่อไปห้องถัดไป

**ทำงานอย่างไร:**

`เดินสำรวจ → Terminal → Command → Server validate → Broadcast state → Door open → Gateway`

**รูป:** gameplay flow 6 ขั้น พร้อมตัวละครสองฝั่งและประตูกลาง

## Slide 4 — เราเพิ่มเติมและแตกต่างจากงานอื่นอย่างไร

**สิ่งที่งานเดิมมี:**

- ใช้เกม escape room เพื่อสอนเนื้อหา technical
- ช่วยเพิ่มแรงจูงใจและ engagement
- ให้ผู้เรียนแก้ปริศนาจากเนื้อหาวิชา

**สิ่งที่งานเราต่อยอด:**

- เปลี่ยนจาก single-player เป็น two-player real-time co-op
- แบ่งข้อมูลเป็นคนละห้อง ผู้เล่นแต่ละคนเห็นข้อมูลไม่เท่ากัน
- บังคับให้สื่อสารและอธิบายหลักฐานให้กัน
- ใช้ server เป็นผู้ตรวจคำสั่งและควบคุม gate state
- ทำให้การเรียน network เกิดจากการร่วมวิเคราะห์ ไม่ใช่แค่ตอบคำถามคนเดียว

**สรุปความแตกต่าง:** งานเดิมทำให้ “การเรียนรู้กลายเป็นเกม” แต่งานเราทำให้ “การสื่อสารระหว่างผู้เล่นกลายเป็นส่วนหนึ่งของ network problem”

**รูป:** ตารางเปรียบเทียบ Previous Work / Our Work หรือภาพสองห้องที่มีเส้นข้อมูลเชื่อมกัน

## Slide 5 — Prototype / User Interface

**แสดงรูปหน้าจอจริงของเกม**

ควรมี callout 5 จุด:

1. ตัวละครผู้เล่นและการควบคุม WASD
2. Network Terminal และปุ่ม E
3. CMD interface สำหรับ ping / traceroute / nslookup
4. Mission HUD แสดงสถานะ ping และประตู
5. Gateway ที่ใช้เดินไปห้องถัดไป

**ข้อความสั้นบนสไลด์:**

`The player does not see a static quiz list. The question appears through exploration and interaction with the world.`

**รูป:** Screenshot gameplay เต็มหน้า + screenshot CMD overlay ขนาดเล็ก

## Slide 6 — ตัวอย่างงานที่พิสูจน์ว่าทำได้

**Proof of implementation**

เลือกแสดง 3 หลักฐานในหน้าเดียว:

- **Application:** ภาพเกมสองห้อง ตัวละคร และ Gateway
- **Source code:** ภาพ code snippet ของ `socket.on('ping-quest')` หรือ `advance-room`
- **Live result:** ภาพก่อนและหลังประตูเปิด หรือภาพผู้เล่นสอง browser ใน room เดียวกัน

**ข้อความอธิบาย:**

- Phaser.js ใช้สร้างฉาก 2D และการเดินของตัวละคร
- Node.js + Socket.IO ใช้ sync player position และ door state
- Server ตรวจ command และไม่ให้ client เปลี่ยนผลลัพธ์เอง

**รูป:** gameplay screenshot, code snippet, co-op test screenshot

## Slide 7 — เอกสารอ้างอิง

ใส่รายการแบบเดียวกันทั้งสไลด์:

- [1] Borrego, C., Fernández, C., Blanes, I., & Robles, S. (2017). *Room escape at class: Escape games activities to facilitate motivation and learning in computer science.*
- [2] *The Impact of a Digital Escape Room Focused on HTML and Computer Networks on Vocational High School Students.* (2022). *Education Sciences, 12*(10), 682.
- [3] Socket.IO Documentation. *Introduction.* https://socket.io/docs/v4/
- [4] Phaser Documentation. *Phaser 3 API Documentation.* https://phaser.io/learn
- [5] Express.js Documentation. *Getting started.* https://expressjs.com/
- [6] Prisma Documentation. *PostgreSQL database connector.* https://www.prisma.io/docs/

## สำคัญสำหรับการจัดหน้า

- Related Work #1 และ #2 ต้องแยกคนละหน้า
- หน้า 3 และ 4 ต้องแยก “งานของเราคืออะไร” กับ “เราแตกต่างอย่างไร”
- หน้า Prototype เน้นภาพจริง ไม่ใส่คำอธิบายยาว
- หน้า Proof ต้องมีหลักฐานว่าเป็น application/source code ที่ทำได้จริง
- หน้า References ไม่ควรใส่เนื้อหาอื่นปน
