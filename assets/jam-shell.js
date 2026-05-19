(()=>{
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div id="loading">Loading...</div>
    <div id="toast">Copied!</div>
    <div id="display-container"></div>
    <div id="control-panel">
      <div class="header">
        <div class="brand"><h1>Sponsor Manager</h1><span>Dock UI OBS - Sponsor Version 1.1</span></div>
        <div class="lang-switch" id="langBtn">EN / TH</div>
      </div>
      <div class="section">
        <h2>จัดการรูปภาพ</h2>
        <div id="drop-zone"><span class="folder">📂</span><span>ลากรูปภาพมาวางที่นี่</span><div id="file-count">0 Images Ready</div></div>
        <input type="file" id="file-input" multiple accept="image/*" style="display:none">
        <div id="thumb-list"></div>
        <button class="btn btn-danger" id="resetBtn">ล้างข้อมูลทั้งหมด</button>
      </div>
      <div class="section">
        <h2>โหมดแสดงผล</h2>
        <select id="mode-select">
          <option value="grid">แบบตาราง (เรียงด้านล่าง)</option>
          <option value="rotator">แบบหมุนวน (ลูปทีละภาพ)</option>
          <option value="ticker">แบบตัววิ่ง (เลื่อนซ้าย)</option>
          <option value="bounce">แบบขยับเด้ง (DVD Saver)</option>
          <option value="rain">แบบฝนตก (หล่นจากฟ้า)</option>
          <option value="3d">แบบ 3D (คัฟเวอร์โฟลว์)</option>
          <option value="pulse">แบบชีพจร (กระเพื่อม)</option>
          <option value="spin">แบบหมุน (ควงรอบ)</option>
          <option value="wiggle">แบบสั่น (ดุ๊กดิ๊ก)</option>
          <option value="float">แบบลอยตัว (Hovering)</option>
          <option value="swing">แบบแกว่ง (ลูกตุ้ม)</option>
        </select>
      </div>
      <div class="section" id="settings-area">
        <h2>ตั้งค่า</h2>
        <label>ขนาดรูป <span class="readout" id="val-size"></span></label><input type="range" id="inp-size" min="50" max="800">
        <div class="row"><div class="col"><label>ความมน <span class="readout" id="val-radius"></span></label><input type="range" id="inp-radius" min="0" max="50"></div><div class="col"><label>เงา <span class="readout" id="val-shadow"></span></label><input type="range" id="inp-shadow" min="0" max="1" step="0.1"></div></div>
        <hr style="border:0;border-top:1px dashed #444;margin:10px 0">
        <div id="sets-grid" class="mode-sets hidden"><label>ระยะห่าง <span class="readout" id="val-gap"></span></label><input type="range" id="inp-gap" min="0" max="100"></div>
        <div id="sets-rotator" class="mode-sets hidden"><div class="row"><div class="col"><label>Horz</label><select id="inp-pos-x"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div><div class="col"><label>Vert</label><select id="inp-pos-y"><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></div></div><label>Margin <span class="readout" id="val-margin"></span></label><input type="range" id="inp-margin" min="0" max="200"><label>Duration <span class="readout" id="val-stay"></span></label><input type="range" id="inp-stay" min="0.5" max="10" step="0.5"><label>Effect</label><select id="inp-effect"><option value="fade">Fade</option><option value="slide">Slide Up</option><option value="zoom">Zoom</option><option value="flip">Flip 3D</option><option value="drop">Drop Bounce</option><option value="spin-in">Spin In</option><option value="blur">Blur Fade</option></select></div>
        <div id="sets-ticker" class="mode-sets hidden"><label>ความเร็ว <span class="readout" id="val-speed"></span></label><input type="range" id="inp-speed" min="5" max="200"><label>ระยะห่าง <span class="readout" id="val-ticker-gap"></span></label><input type="range" id="inp-ticker-gap" min="0" max="200"><label>Position Y <span class="readout" id="val-ticker-y"></span></label><input type="range" id="inp-ticker-y" min="0" max="1000"></div>
        <div id="sets-bounce" class="mode-sets hidden"><label>ความเร็ว <span class="readout" id="val-bounce-speed"></span></label><input type="range" id="inp-bounce-speed" min="1" max="20"></div>
        <div id="sets-rain" class="mode-sets hidden"><label>Fall Speed <span class="readout" id="val-rain-speed"></span></label><input type="range" id="inp-rain-speed" min="1" max="20"><label>Density <span class="readout" id="val-rain-density"></span></label><input type="range" id="inp-rain-density" min="1" max="10"></div>
        <div id="sets-3d" class="mode-sets hidden"><label>Rotation Speed <span class="readout" id="val-3d-speed"></span></label><input type="range" id="inp-3d-speed" min="500" max="5000" step="100"></div>
        <div id="sets-pulse" class="mode-sets hidden"><label>Pulse Speed <span class="readout" id="val-pulse-speed"></span></label><input type="range" id="inp-pulse-speed" min="200" max="3000" step="100"><label>ระยะห่าง <span class="readout" id="val-pulse-gap"></span></label><input type="range" id="inp-pulse-gap" min="0" max="100"></div>
        <div id="sets-spin" class="mode-sets hidden"><label>Spin Speed <span class="readout" id="val-spin-speed"></span></label><input type="range" id="inp-spin-speed" min="500" max="5000" step="100"><label>ระยะห่าง <span class="readout" id="val-spin-gap"></span></label><input type="range" id="inp-spin-gap" min="0" max="100"></div>
        <div id="sets-wiggle" class="mode-sets hidden"><label>Wiggle Speed <span class="readout" id="val-wiggle-speed"></span></label><input type="range" id="inp-wiggle-speed" min="100" max="2000" step="100"><label>ระยะห่าง <span class="readout" id="val-wiggle-gap"></span></label><input type="range" id="inp-wiggle-gap" min="0" max="100"></div>
        <div id="sets-float" class="mode-sets hidden"><label>Float Speed <span class="readout" id="val-float-speed"></span></label><input type="range" id="inp-float-speed" min="500" max="4000" step="100"><label>ระยะห่าง <span class="readout" id="val-float-gap"></span></label><input type="range" id="inp-float-gap" min="0" max="100"></div>
        <div id="sets-swing" class="mode-sets hidden"><label>Swing Speed <span class="readout" id="val-swing-speed"></span></label><input type="range" id="inp-swing-speed" min="500" max="4000" step="100"><label>ระยะห่าง <span class="readout" id="val-swing-gap"></span></label><input type="range" id="inp-swing-gap" min="0" max="100"></div>
      </div>
      <div class="section"><button class="btn btn-success" id="syncBtn">บังคับ Sync หน้าจอ</button></div>
      <div class="menu-bar"><button class="btn btn-outline" id="helpBtn">❓ วิธีใช้งาน</button><button class="btn btn-outline" id="sponsorBtn">🎁 ผู้สนับสนุน</button></div>
    </div>
    <div id="modal-help" class="modal-overlay"><div class="modal"><button class="modal-close" data-close="modal-help">×</button><h2>วิธีใช้งาน (URL GENERATOR)</h2><p class="note">สร้าง Browser Source ขนาด 1920x1080 แล้วคัดลอก URL ด้านล่างไปใส่ หรือกดเพิ่มผ่าน WebSocket</p><div id="url-list"></div><hr style="border:0;border-top:1px dashed #444;margin:15px 0"><label>OBS WebSocket Port (Default: 4455)</label><div style="display:flex;gap:5px"><input class="text-field" id="obs-port" value="4455" style="width:70px;text-align:center"><input class="text-field" id="obs-pass" type="password" placeholder="(No password)" style="flex:1"></div><button class="btn btn-primary" id="obsConnectBtn">Connect OBS</button><div id="obs-status" class="obs-disconnected">OBS Websocket connection is used to automatically add the URL to the current scene.</div></div></div>
    <div id="modal-sponsor" class="modal-overlay"><div class="modal"><button class="modal-close" data-close="modal-sponsor">×</button><h2>ผู้สนับสนุน</h2><p class="note">PepsLive Sponsor Manager</p><a class="btn btn-primary" href="https://heylink.me/pepslive/" target="_blank">เปิดหน้าสนับสนุน</a></div></div>`;
})();
