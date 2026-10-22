# Changelog

## v2.1.0

### UX/UI และการเตรียมงาน

- แบ่งหน้า Control เป็นขั้นเตรียมงานและควบคุมสด พร้อมแสดงขั้นตอนเลือกโหมด เพิ่มโลโก้ และจัดชุดเล่น
- แนะนำ 5 รูปแบบที่เหมาะกับงานถ่ายทอดสด และเก็บโหมดอื่นไว้ในรายการเพิ่มเติม
- ลากไฟล์โลโก้แล้วเพิ่มเข้าชุด Sponsor และ Group ที่ใช้อยู่โดยอัตโนมัติ
- เลือก Playlist แล้วอัปเดตรูปแบบการแสดงผลของชุดนั้น พร้อมแสดงสถานะใน Preview
- เพิ่มปุ่มพัก Preview และพักการเรนเดอร์เมื่อซ่อนหน้า Control

### ประสิทธิภาพและความเสถียร

- ลดการโหลด Preview ซ้ำเมื่อ URL ของโหมดและ Group ไม่เปลี่ยน
- จำกัด Cover Flow 3D ให้เรนเดอร์การ์ดใกล้ตำแหน่งปัจจุบันสูงสุด 7 ใบ และเลื่อนเนื้อหาไปตามรายการ Sponsor
- เพิ่ม regression สำหรับการเล่น Cover Flow ที่มี Sponsor 100 ราย พร้อมวัดเวลาแสดงผลคำสั่ง

### Validation

- Static checks ผ่าน 186 assertions
- Browser regression ผ่านครบ 21 โหมด, URL compatibility, Playlists/Groups, Import/Export, OBS mock, multi-tab และการสลับโหมดรวดเร็ว
- ทดสอบ OBS Browser Source จริงและ Google Sign-in/License บนบัญชี production แยกไว้เป็นการตรวจ runtime ก่อนใช้งานหน้างาน

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
