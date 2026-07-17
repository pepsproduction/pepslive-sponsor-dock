# PepsLive Sponsor Dock

รุ่น 2.0.0 รวมระบบ Sponsor สำหรับ OBS โดยยึดฟังก์ชันจาก
`pepsproduction/pepslive-sponsor-dock` เป็นหลัก แล้วจัด UX/UI และโครงสร้างการทำงานใหม่
ให้ใช้ง่ายขึ้นโดยยังคงธีมดำ–ส้มของ PepsLive

> Release 2.0.0 — ผ่าน automated regression และพร้อมใช้งานบน GitHub Pages/OBS Browser Source

## สิ่งที่รวมไว้

- Sponsor Library พร้อมชื่อ, Tier, เวลาแสดง และสถานะเปิดใช้งาน
- Groups สำหรับ URL/Browser Source แบบคงที่
- Playlists สำหรับควบคุมลำดับระหว่าง Live
- Mode Studio พร้อมค่าตั้งแยกอิสระรายโหมด
- Live Control: Show/Hide, Previous, Pause, Next, Sponsor Break และ Goal Popup
- URL Center สำหรับ Live Display, Classic Auto และทุก Mode/Group
- Import/Export Project JSON รวมไฟล์รูป
- OBS WebSocket: สร้าง/อัปเดต Source, Refresh และ Show/Hide Scene Item
- Migration จากข้อมูลเดิมทั้งระบบ v3 และ local redesign

## หน้าหลัก

- `sponsor-control.html` — หน้า Control แบ่งเป็น Live, Sponsors, Collections, Modes และ Settings
- `sponsor-display.html` — หน้า Display โปร่งใสสำหรับ OBS
- `sponsor.html` — Compatibility route สำหรับ URL เดิม
- `assets/sponsor-mode-registry.js` — รายชื่อ, ค่าเริ่มต้น และ controls ของ 21 โหมด
- `assets/sponsor-modes.js` — Renderer ของทุกโหมด
- `assets/sponsor-shared.js` — State, validation, migration, localStorage, IndexedDB และ sync

## เส้นทาง Display

- `sponsor.html?mode=live` — Live Display ตาม Playlist และคำสั่งหน้า Live
- `sponsor.html?mode=display` — Compatibility alias เดิม ตาม Mode Studio และ Group ที่ผูกไว้
- `sponsor.html?mode=auto` — Compatibility alias เดิม ตาม Mode Studio และ Group ที่ผูกไว้
- `sponsor.html?mode=MODE&group=GROUP` — Output แบบคงที่สำหรับ Mode/Group ที่ระบุ
- `sponsor.html?mode=control` — เปิดหน้า Control

URL เดิมของ 14 โหมดจาก GitHub ยังใช้ ID เดิม เช่น `grid`, `ticker`, `orbit` และ
`spotlight` ส่วนโหมดใหม่ใช้ ID แยกเพื่อไม่ให้ความหมายชนกัน เช่น `grid_board` และ
`broadcast_ticker`

## 21 Display Modes

โหมดเดิม 14 แบบ:

- Grid, Rotator, Ticker, Bounce, Rain
- 3D Cover Flow, Pulse, Spin, Wiggle, Float
- Swing, Wave, Orbit และ Spotlight

โหมด Broadcast/Event เพิ่มเติม 7 แบบ:

- Bottom Sponsor Bar
- Corner Badge
- Side Tower
- Broadcast Ticker
- Grid Board
- Fullscreen Sponsor Break
- Goal Sponsor Popup

## Workflow ที่แนะนำ

1. เปิดหน้า Control แล้วไปที่ **Sponsors** เพื่ออัปโหลด PNG, JPG, WebP หรือ SVG
2. จัด Sponsor เป็น **Groups** สำหรับ Source แบบคงที่
3. จัด **Playlists** สำหรับลำดับระหว่าง Live
4. ปรับโหมดและค่ารายโหมดใน **Modes**
5. ทดสอบ Show/Hide, Next/Pause และ Trigger ใน **Live**
6. ใช้ URL `mode=live` เป็น Browser Source หลักสำหรับหน้างาน
7. Export Project เก็บเป็น Backup ก่อนเริ่มงานจริง

## เปิดทดสอบ Local

รัน static server จากโฟลเดอร์โปรเจกต์:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

จากนั้นเปิด:

```text
http://127.0.0.1:8765/sponsor-control.html
```

ไม่ควรเปิดด้วย `file://` เพราะ IndexedDB, BroadcastChannel และ iframe sync อาจทำงานไม่ครบ

## ตั้งค่า OBS

### Custom Browser Dock

- URL: `https://pepsproduction.github.io/pepslive-sponsor-dock/sponsor-control.html`

### Browser Source หลัก

- URL: `https://pepsproduction.github.io/pepslive-sponsor-dock/sponsor.html?mode=live`
- Width: `1920`
- Height: `1080`
- Background: โปร่งใส

หน้า Settings โหลด `obs-websocket-js` จาก jsDelivr เมื่อกด Connect เท่านั้น รหัสผ่าน OBS
อยู่เฉพาะใน session ปัจจุบันและไม่ถูกบันทึก, sync หรือ export

## Storage และ Migration

- Authoritative state และไฟล์รูป: IndexedDB `PepsSponsorDockDB_v2`
- Compatibility mirror: localStorage `peps_sponsor_dock_state_v2`
- Sync channel: `peps_sponsor_dock_channel_v2`

การบันทึกจากหลายแท็บใช้ IndexedDB transaction, 3-way rebase และ project epoch
เพื่อไม่ให้การเพิ่ม/ลบ/แก้ Sponsor, Group หรือ Playlist พร้อมกันทำข้อมูลอีกแท็บหาย

ระบบอ่านข้อมูล v3 เดิมโดยตรง และรองรับ migration จาก local redesign key
`pepslive_sponsor_dock_state_v1` / `PepsLiveSponsorDockDB` โดยไม่ลบ store เก่าทิ้งอัตโนมัติ
หากพบข้อมูลทั้งสองระบบพร้อมกัน หน้า Settings จะแสดงตัวเลือกให้รวมข้อมูล redesign เข้าโปรเจกต์หลัก
โดยสร้าง ID ใหม่และคงข้อมูล canonical เดิมไว้ ส่วนรายการที่หาไฟล์รูปไม่พบจะแสดงสถานะให้กดแทนที่รูปได้

Chrome และ OBS Browser Source อาจใช้ storage คนละ profile วิธีที่เสถียรที่สุดคือเปิดหน้า
Control เป็น OBS Custom Browser Dock ใน OBS profile เดียวกับ Browser Source

## ตรวจสอบโปรเจกต์

ต้องมี Node.js 22+ และ Chrome หรือ Edge:

```powershell
npm test
```

แยกตรวจได้ด้วย:

```powershell
npm run test:static
npm run test:browser
```

Browser regression ครอบคลุม 21 โหมด, compatibility routes, Mode/Group URLs,
Group/Playlist async rendering, Import/Export rollback, OBS mock, multi-tab locking,
BFCache lifecycle, output โปร่งใส และการสลับโหมดอย่างรวดเร็ว
