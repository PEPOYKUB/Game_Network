# งานเพิ่มโหมดแข่งขัน KUHU NET — แบ่งงาน 3 คน

เอกสารหลักสำหรับติดตามงานย่อย ให้ผู้พัฒนาแต่ละคนใช้สเปกตามหัวข้อของตน:

1. [งานที่ 1 — โหมดแข่งขัน FFA 4 คนและทีม 2v2](multiplayer-01-game-modes.md)
2. [งานที่ 2 — ความคืบหน้าผ่าน Network](multiplayer-02-progress-network.md)
3. [งานที่ 3 — ไอเทมและการก่อกวน](multiplayer-03-items-and-sabotage.md)

## ข้อตกลงร่วม

- ใช้ `server/game/rooms.js` และ `server/game/engine.js` เป็นจุดหลักสำหรับ logic ห้อง/การแข่งขัน แต่ตรวจรูปแบบปัจจุบันก่อนแก้
- Server เป็นเจ้าของสถานะเกม, progress, การสุ่มไอเทม และผลของทุก action; client เป็นส่วนแสดงผลและส่งคำขอ
- ห้ามส่ง ground truth, เฉลย หรือข้อมูลโจทย์ลับให้คู่แข่ง
- ผู้พัฒนาทั้งสามต้องตกลง schema ร่วมกันสำหรับ `mode`, `playerId`, `teamId`, `phase`, state scope และ Socket.IO events ก่อนรวมงาน
- รักษาโหมด co-op 2 คนและการทำงานของด่านเดิม
- ก่อนส่งงานให้เพิ่ม/ปรับ automated tests ที่ครอบคลุมความสามารถของตนและ regression ที่เกี่ยวข้อง
