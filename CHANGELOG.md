# Changelog

## v2.0.0

### Unified System

- รวมระบบ v3 เดิมกับ Sponsor Library, Groups, Playlists และ Live Control ใน state เดียว
- รักษา 14 โหมดเดิมและเพิ่ม 7 โหมด Broadcast/Event รวม 21 โหมด
- แยก `grid`/`ticker` เดิมออกจาก `grid_board`/`broadcast_ticker` เพื่อไม่ให้ URL เปลี่ยนความหมาย
- เพิ่ม Mode Studio, Mode-to-Group mapping และ URL Center
- คง `mode=display` และ `mode=auto` เป็น Classic aliases ตาม GitHub เดิม
- เพิ่ม `mode=live` สำหรับ Live Playlist และคำสั่ง Operator
- รองรับ migration จาก localStorage/IndexedDB ทั้งสอง generation โดยไม่ลบข้อมูลเดิม

### UX/UI

- จัดระบบใหม่เป็น Live, Sponsors, Collections, Modes และ Settings
- คงธีมดำ–ส้ม พร้อมเพิ่ม hierarchy, card system, motion และ responsive dock layout
- เพิ่ม compact operator experience สำหรับ Dock ขนาดเล็ก
- เพิ่ม Preview ที่จำลอง output 1920×1080, safe area, playback progress และ effect countdown
- เพิ่ม Confirm Dialog, Toast, focus state และ keyboard tab navigation

### Reliability

- แยก async render token ของ Group และ Playlist ป้องกันรายการหายเมื่อ render พร้อมกัน
- เพิ่ม generation guard และ cleanup สำหรับ timer, interval และ animation frame
- แก้ Ticker loop เป็นสองชุดแบบ `-50%`
- รักษาค่าตำแหน่ง X/Y และ settings แยกรายโหมดจาก v3
- ทำ Import แบบ transactional และไม่บันทึกรหัสผ่าน OBS
- บังคับ Browser Source เดิมกลับจาก Local File เป็น URL และตรวจ Scene Item ใน Scene ปัจจุบัน
- เริ่ม Preview หลัง state หลัก initialize เสร็จ ป้องกัน migration ซ้ำระหว่าง Control กับ iframe
- ใช้ IndexedDB transaction เป็น state หลัก พร้อม 3-way rebase และ epoch guard ป้องกันข้อมูลหายเมื่อเปิดหลายแท็บ
- ฟื้น BroadcastChannel, DB connection, timer และ Blob URL เมื่อกลับจาก BFCache
- ตัด runtime รุ่นทดลอง/รุ่นเก่าที่ไม่มีหน้าใดอ้างอิงออก เพื่อลดโค้ดซ้ำและภาระดูแล
- เพิ่ม static/browser regression ครบ 21 โหมดและ compatibility routes

### Validation

- Static project checks ผ่าน 161 assertions
- Browser regression ผ่านครบ 21 โหมด, multi-tab locking และ BFCache lifecycle

## v1.1.0

- Local redesign ของ Sponsor Library, Playlists, Live Trigger และ 7 display modes
- เพิ่ม validation, import/export, responsive UI และ browser smoke tests

## v1.0.0

- Sponsor Library, Playlist Manager, Live Trigger, Preview และ OBS WebSocket รุ่นแรก
