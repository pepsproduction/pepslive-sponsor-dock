# PepsLive Sponsor Dock

Static OBS Sponsor Manager สำหรับ GitHub Pages และ OBS Browser Source

## ไฟล์หลัก

- `sponsor-control.html`  
  หน้า Control สำหรับอัปโหลดโลโก้ ตั้งค่า Playlist สั่ง Trigger และเชื่อมต่อ OBS WebSocket

- `sponsor-display.html`  
  หน้า Display สำหรับใส่เป็น OBS Browser Source

- `assets/sponsor.css`  
  ธีม UI และสกิน Display

- `assets/sponsor-shared.js`  
  ระบบ state, localStorage, IndexedDB, BroadcastChannel และ helper กลาง

- `assets/sponsor-control.js`  
  Logic หน้า Control

- `assets/sponsor-display.js`  
  Logic หน้า Display

## วิธีอัปขึ้น GitHub Pages

1. สร้าง repo ใหม่ เช่น `pepslive-sponsor-dock`
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น repo
3. เข้า `Settings > Pages`
4. เลือก branch `main` และ folder `/root`
5. เปิด URL:
   - Control: `https://USERNAME.github.io/pepslive-sponsor-dock/sponsor-control.html`
   - Display: `https://USERNAME.github.io/pepslive-sponsor-dock/sponsor-display.html`

## วิธีใช้กับ OBS

### วิธีแนะนำ

1. เปิด OBS
2. ไปที่ `Docks > Custom Browser Docks`
3. เพิ่มหน้า Control:
   - Dock Name: `PepsLive Sponsor Dock`
   - URL: `https://USERNAME.github.io/pepslive-sponsor-dock/sponsor-control.html`
4. เพิ่ม Browser Source:
   - Source Name: `PEPS_SPONSOR_DISPLAY`
   - URL: `https://USERNAME.github.io/pepslive-sponsor-dock/sponsor-display.html`
   - Width: `1920`
   - Height: `1080`
5. อัปโหลดโลโก้ในหน้า Control
6. เลือก Playlist และ Skin
7. กด Show / Next / Sponsor Break / Goal Sponsor Popup ตามต้องการ

## OBS WebSocket

ถ้าต้องการให้หน้า Control สร้าง/refresh/show/hide source ได้:

1. เปิด OBS
2. ไปที่ `Tools > WebSocket Server Settings`
3. Enable WebSocket server
4. ใช้ port ปกติ `4455`
5. ใส่ password ในหน้า Control หากตั้งไว้
6. กด `Connect OBS`
7. กด `สร้าง Browser Source`

หมายเหตุ: OBS 28+ มี obs-websocket รวมมาแล้ว ปกติ default port คือ `4455`

## ข้อควรรู้เรื่อง Storage

ระบบนี้เก็บข้อมูลด้วย:

- `localStorage` สำหรับค่า settings/project
- `IndexedDB` สำหรับไฟล์รูปโลโก้
- `BroadcastChannel` สำหรับ sync หน้า Control และ Display

ถ้าเปิด Control ใน Chrome แต่ Display อยู่ใน OBS Browser Source อาจเป็นคนละ storage กัน  
วิธีที่เสถียรกว่าคือเปิด Control เป็น `OBS Custom Browser Dock`

## ฟีเจอร์ที่มี

- Sponsor Library
- Sponsor Playlist
- Bottom Sponsor Bar
- Corner Badge
- Side Tower
- Ticker Run
- Grid Board
- Fullscreen Sponsor Break
- Goal Sponsor Popup
- Safe Area Guide
- Show/Hide/Next/Previous/Pause
- Export/Import Project JSON รวมรูป
- OBS WebSocket create/refresh/show/hide source
- Sample sponsors สำหรับทดสอบทันที

## Workflow หน้างาน

1. ก่อนงาน: เตรียมโลโก้สปอนเซอร์ทั้งหมดเป็น PNG/WebP พื้นหลังโปร่งใส
2. เปิด Control ใน OBS Dock
3. อัปโหลดโลโก้
4. จัดระดับ Main / Gold / Silver / Partner
5. สร้าง Playlist:
   - ระหว่างแข่งขัน
   - พักครึ่ง
   - Goal Popup
   - Final Score
6. เพิ่ม `sponsor-display.html` เป็น Browser Source
7. Test ปุ่ม:
   - Show Sponsor
   - Next
   - Sponsor Break
   - Goal Sponsor Popup
8. Export Project JSON เก็บไว้เป็น backup

## แนะนำการพัฒนาต่อ

- เพิ่ม Google Sheet Sync สำหรับโหลด sponsor ตาม Match ID
- เพิ่ม per-scene preset สำหรับ OBS
- เพิ่ม auto trigger จาก PepsLive Scoreboard เมื่อกด Goal
- เพิ่ม sponsor report ว่าแต่ละรายออกหน้าจอกี่ครั้ง/กี่วินาที
- เพิ่ม mobile mini control
- เพิ่ม zip export ที่แยก assets เป็นไฟล์จริง
