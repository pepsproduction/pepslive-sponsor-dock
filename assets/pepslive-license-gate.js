/* PepsLiveTool shared client-side license gate.
 * The catalog and per-account grant are read from the same Firebase project as
 * PepsLiveTool Launcher. OBS/display pages intentionally do not load this file.
 */
(() => {
  'use strict';

  const body = document.body;
  if (!body) return;
  const toolId = String(body.dataset.pepsliveTool || '').trim().toLowerCase();
  if (!toolId) return;
  if (body.dataset.pepsliveAllowSource === 'true' && new URLSearchParams(location.search).get('view')) return;

  const FIREBASE = Object.freeze({
    apiKey: 'AIzaSyDXaar2OZtIChUMsUi9o8kufbAY2twqwd4',
    authDomain: 'my-project-1531149704307.firebaseapp.com',
    databaseURL: 'https://my-project-1531149704307-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'my-project-1531149704307',
    storageBucket: 'my-project-1531149704307.firebasestorage.app',
    messagingSenderId: '793565815753',
    appId: '1:793565815753:web:49c27bed03b6dedb98fe18'
  });
  const SDK = '12.16.0';
  const ROOT = 'licenseV1';
  const ADMIN_EMAILS = new Set(['bankkjchannel@gmail.com']);
  const TOOL_NAMES = {
    'sponsor-dock': 'PepsLive Sponsor Dock',
    'stinger-studio': 'PepsLive Stinger Studio',
    'tournament-studio': 'PepsLive Tournament Studio',
    'football-scoreboard': 'Football Scoreboard Builder',
    finalscore: 'Peps FinalScore Studio',
    'logo-studio': 'PepsLogo Studio'
  };
  const toolName = TOOL_NAMES[toolId] || 'PepsLive Tool';
  const dateFormat = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  let firebase = null;
  let auth = null;
  let database = null;
  let currentUser = null;
  let lastResult = null;

  const style = document.createElement('style');
  style.textContent = `
    html.pepslive-license-locked body > :not(#pepslive-license-gate){
      filter:blur(4px);pointer-events:none;user-select:none!important;
    }
    #pepslive-license-gate{box-sizing:border-box;position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:clamp(12px,4vw,24px);overflow:auto;background:radial-gradient(circle at 15% 10%,rgba(255,117,24,.18),transparent 32%),radial-gradient(circle at 88% 85%,rgba(79,125,255,.2),transparent 34%),rgba(5,8,14,.94);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f8fbff}
    #pepslive-license-gate[hidden]{display:none}
    .plg-card{box-sizing:border-box;width:min(620px,100%);max-height:calc(100vh - 24px);overflow:auto;border:1px solid rgba(255,255,255,.16);border-radius:clamp(18px,4vw,28px);padding:clamp(18px,5vw,34px);background:linear-gradient(145deg,rgba(21,28,42,.96),rgba(10,14,23,.96));box-shadow:0 30px 100px rgba(0,0,0,.48)}
    .plg-brand{display:flex;align-items:center;gap:14px;min-width:0;margin-bottom:24px}.plg-brand>span:last-child{min-width:0}.plg-mark{flex:0 0 58px;width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#ff7a18,#ffb35b);color:#111;font-weight:950;font-size:24px;box-shadow:0 10px 30px rgba(255,122,24,.24)}.plg-mark img{width:100%;height:100%;object-fit:contain;border-radius:inherit}.plg-brand small{display:block;color:#9eacc1;letter-spacing:.13em;font-size:11px;font-weight:800}.plg-brand strong{display:block;margin-top:3px;font-size:18px;overflow-wrap:anywhere}.plg-kicker{color:#ff9a4a;font-size:11px;letter-spacing:.18em;font-weight:900}.plg-card h1{margin:8px 0 10px;font-size:clamp(24px,4vw,38px);line-height:1.1;overflow-wrap:anywhere}.plg-copy{margin:0;color:#aebbd0;line-height:1.7;overflow-wrap:anywhere}.plg-status{margin:24px 0 18px;padding:15px 16px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);line-height:1.55;overflow-wrap:anywhere}.plg-status strong{display:block;color:#fff}.plg-status span{display:block;color:#aebbd0;font-size:13px;margin-top:4px}.plg-identity{display:block;margin:-8px 0 18px;color:#8e9bb0;font-size:12px;overflow-wrap:anywhere}.plg-actions{display:flex;flex-wrap:wrap;gap:10px}.plg-actions button{min-height:44px;border:0;border-radius:12px;padding:12px 17px;font-weight:850;cursor:pointer;color:#fff;background:#27344a}.plg-actions button.primary{background:linear-gradient(135deg,#ff7415,#ff9e45);color:#16100a}.plg-actions button:disabled{opacity:.55;cursor:wait}.plg-foot{margin:18px 0 0;color:#7888a0;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.plg-error{color:#ffb3a8!important}@media(max-width:520px){.plg-actions button{flex:1 1 100%;width:100%}.plg-brand{gap:10px}.plg-mark{flex-basis:48px;width:48px;height:48px;border-radius:14px}.plg-brand small{font-size:9px}.plg-brand strong{font-size:16px}}
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add('pepslive-license-locked');

  const gate = document.createElement('section');
  gate.id = 'pepslive-license-gate';
  gate.innerHTML = `<div class="plg-card" role="dialog" aria-modal="true" aria-labelledby="plgTitle">
    <div class="plg-brand"><span class="plg-mark">PL</span><span><small>PEPSLIVE TOOL LAUNCHER</small><strong>${escapeHtml(toolName)}</strong></span></div>
    <div class="plg-kicker">LICENSE CONTROL</div>
    <h1 id="plgTitle">ตรวจสอบสิทธิ์ก่อนใช้งาน</h1>
    <p class="plg-copy">Web App นี้ใช้สิทธิ์ชุดเดียวกับ PepsLiveTool Launcher โดยตรวจบัญชี, Pending, วันเริ่ม, Active และวันหมดอายุจากระบบกลาง</p>
    <div class="plg-status"><strong id="plgStatus">กำลังเชื่อมต่อระบบสิทธิ์…</strong><span id="plgDetail">กรุณารอสักครู่</span></div><span class="plg-identity" id="plgIdentity" hidden></span>
    <div class="plg-actions"><button class="primary" id="plgLogin" type="button">เข้าสู่ระบบด้วย Google</button><button id="plgRefresh" type="button">ตรวจสอบอีกครั้ง</button><button id="plgLogout" type="button" hidden>ออกจากระบบ</button></div>
    <p class="plg-foot">Pending, ยังไม่ถึงวันเริ่ม, Suspended, Revoked หรือถึงวันหมดอายุ จะไม่สามารถใช้งานได้ และระบบจะแจ้งให้ติดต่อแอดมิน</p>
  </div>`;
  body.appendChild(gate);
  const statusNode = gate.querySelector('#plgStatus');
  const detailNode = gate.querySelector('#plgDetail');
  const loginButton = gate.querySelector('#plgLogin');
  const refreshButton = gate.querySelector('#plgRefresh');
  const logoutButton = gate.querySelector('#plgLogout');
  const identityNode = gate.querySelector('#plgIdentity');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
  }

  function setStatus(title, detail, error = false) {
    if (statusNode) statusNode.textContent = title;
    if (detailNode) {
      detailNode.textContent = detail;
      detailNode.classList.toggle('plg-error', error);
    }
  }

  function updateIdentity() {
    if (!identityNode) return;
    const email = String(currentUser?.email || '').trim();
    identityNode.hidden = !email;
    identityNode.textContent = email ? `บัญชีที่ Web App ใช้ตรวจสิทธิ์: ${email}` : '';
  }

  function setLocked(title, detail, error = false) {
    document.documentElement.classList.add('pepslive-license-locked');
    gate.hidden = false;
    setStatus(title, detail, error);
    updateIdentity();
    if (loginButton) loginButton.hidden = !!currentUser;
    if (logoutButton) logoutButton.hidden = !currentUser;
  }

  function setUnlocked(result) {
    lastResult = result;
    document.documentElement.classList.remove('pepslive-license-locked');
    gate.hidden = true;
    window.__PEPSLIVE_LICENSE__ = Object.freeze({ ...result, toolId, checkedAt: new Date().toISOString() });
    updateIdentity();
  }

  function adminEmail(user) {
    return ADMIN_EMAILS.has(String(user?.email || '').trim().toLowerCase());
  }

  function usableUser(user) {
    return user && !user.isAnonymous && String(user.email || '').trim() ? user : null;
  }

  function contactAdmin(detail) {
    return `${detail ? `${detail} ` : ''}กรุณาติดต่อแอดมิน`;
  }

  function accountStatus(account, user) {
    if (!account) {
      const email = String(user?.email || '').trim();
      return { allowed: false, reason: 'account_missing', title: 'ไม่พบข้อมูลสิทธิ์ของบัญชีนี้', detail: contactAdmin(email ? `ยังไม่มีข้อมูลสิทธิ์ของ ${email}` : 'ยังไม่มีข้อมูลสิทธิ์ในระบบกลาง') };
    }
    const raw = String(account.status || 'pending').toLowerCase();
    if (raw === 'pending') return { allowed: false, reason: 'account_pending', title: 'บัญชียังเป็น Pending', detail: contactAdmin('รอ Admin อนุมัติบัญชีนี้') };
    if (raw === 'suspended') return { allowed: false, reason: 'account_suspended', title: 'บัญชีถูกพักใช้งาน', detail: contactAdmin() };
    if (raw === 'revoked') return { allowed: false, reason: 'account_revoked', title: 'บัญชีถูกปิดสิทธิ์', detail: contactAdmin() };
    if (raw !== 'active') return { allowed: false, reason: 'account_invalid_status', title: 'สถานะบัญชีไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบสถานะบัญชี') };
    const now = Date.now();
    const start = Date.parse(String(account.validFrom || ''));
    const expiry = Date.parse(String(account.validUntil || ''));
    if (account.validFrom && !Number.isFinite(start)) return { allowed: false, reason: 'invalid_account_start', title: 'วันเริ่มบัญชีไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบข้อมูลสิทธิ์') };
    if (account.validUntil && !Number.isFinite(expiry)) return { allowed: false, reason: 'invalid_account_expiry', title: 'วันหมดอายุบัญชีไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบข้อมูลสิทธิ์') };
    if (Number.isFinite(start) && now < start) return { allowed: false, reason: 'account_not_started', title: 'บัญชียังไม่ถึงวันเริ่ม', detail: contactAdmin(`เริ่ม ${formatDate(account.validFrom)}`) };
    if (Number.isFinite(expiry) && now >= expiry) return { allowed: false, reason: 'account_expired', title: 'สิทธิ์บัญชีหมดอายุแล้ว', detail: contactAdmin(`หมดอายุ ${formatDate(account.validUntil)}`) };
    return { allowed: true, reason: 'account_active', title: 'บัญชี Active', detail: account.validUntil ? `ถึง ${formatDate(account.validUntil)}` : 'สิทธิ์บัญชีพร้อมใช้งาน' };
  }

  function toolsFromContent(content) {
    const raw = content && content.tools;
    return Array.isArray(raw) ? raw : Object.values(raw || {});
  }

  function getTool(content) {
    return toolsFromContent(content).find((item) => String(item?.id || '').toLowerCase() === toolId) || null;
  }

  function accessStatus(content, account, user) {
    const tool = getTool(content);
    if (!tool) return { allowed: false, reason: 'tool_missing', title: 'ไม่พบโปรแกรมใน catalog', detail: contactAdmin('Admin ต้องตรวจสอบรายการโปรแกรม') };
    const toolStatus = String(tool.status || 'active').toLowerCase();
    if (toolStatus === 'pending') return { allowed: false, reason: 'tool_pending', title: 'โปรแกรมยังเป็น Pending', detail: contactAdmin('รอ Admin เปิดโปรแกรมนี้') };
    if (toolStatus === 'suspended') return { allowed: false, reason: 'tool_suspended', title: 'โปรแกรมถูกพักใช้งาน', detail: contactAdmin('Admin พักโปรแกรมนี้ชั่วคราว') };
    if (toolStatus === 'revoked') return { allowed: false, reason: 'tool_revoked', title: 'โปรแกรมถูกปิดสิทธิ์', detail: contactAdmin('Admin ปิดการใช้งานโปรแกรมนี้') };
    if (!['active', ''].includes(toolStatus)) return { allowed: false, reason: 'tool_invalid_status', title: 'สถานะโปรแกรมไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบสถานะโปรแกรม') };
    if (!user) return { allowed: false, reason: 'login_required', title: 'กรุณาเข้าสู่ระบบก่อน', detail: 'ใช้บัญชี Google เดียวกับ PepsLiveTool Launcher' };
    const isAdmin = adminEmail(user);
    const accountAccess = accountStatus(account, user);
    if (!accountAccess.allowed && !isAdmin) return accountAccess;
    const tools = account?.tools && typeof account.tools === 'object' ? account.tools : {};
    const hasGrant = Object.prototype.hasOwnProperty.call(tools, toolId);
    const grant = tools[toolId];
    if (grant === false) return { allowed: false, reason: 'grant_revoked', title: 'ไม่ได้รับสิทธิ์โปรแกรมนี้', detail: contactAdmin('Admin ปิดสิทธิ์รายโปรแกรมสำหรับบัญชีนี้') };
    if (grant === true || (!hasGrant && (tool.free === true || isAdmin))) return { allowed: true, reason: 'active_tool', title: 'สิทธิ์พร้อมใช้งาน', detail: 'สิทธิ์รายโปรแกรมเป็น Active' };
    if (!hasGrant || !grant || typeof grant !== 'object') return { allowed: false, reason: 'grant_pending', title: 'สิทธิ์โปรแกรมยังเป็น Pending', detail: contactAdmin('Admin ยังไม่ได้เปิดสิทธิ์โปรแกรมนี้') };
    const grantStatus = String(grant.status || 'pending').toLowerCase();
    if (grantStatus === 'pending') return { allowed: false, reason: 'grant_pending', title: 'สิทธิ์โปรแกรมยังเป็น Pending', detail: contactAdmin('Admin ยังไม่ได้เปิดสิทธิ์โปรแกรมนี้') };
    if (grantStatus === 'suspended') return { allowed: false, reason: 'grant_suspended', title: 'สิทธิ์โปรแกรมถูกพักใช้งาน', detail: contactAdmin() };
    if (grantStatus === 'revoked') return { allowed: false, reason: 'grant_revoked', title: 'สิทธิ์โปรแกรมถูกปิด', detail: contactAdmin() };
    if (grantStatus !== 'active') return { allowed: false, reason: 'grant_invalid_status', title: 'สถานะสิทธิ์โปรแกรมไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบสิทธิ์รายโปรแกรม') };
    const now = Date.now();
    const start = Date.parse(String(grant.validFrom || ''));
    const expiry = Date.parse(String(grant.validUntil || ''));
    if (grant.validFrom && !Number.isFinite(start)) return { allowed: false, reason: 'invalid_tool_start', title: 'วันเริ่มโปรแกรมไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบวันของโปรแกรมนี้') };
    if (grant.validUntil && !Number.isFinite(expiry)) return { allowed: false, reason: 'invalid_tool_expiry', title: 'วันหมดอายุโปรแกรมไม่ถูกต้อง', detail: contactAdmin('Admin ต้องตรวจสอบวันของโปรแกรมนี้') };
    if (Number.isFinite(start) && now < start) return { allowed: false, reason: 'tool_not_started', title: 'ยังไม่ถึงวันเริ่มใช้งาน', detail: contactAdmin(`เริ่ม ${formatDate(grant.validFrom)}`) };
    if (Number.isFinite(expiry) && now >= expiry) return { allowed: false, reason: 'tool_expired', title: 'สิทธิ์โปรแกรมหมดอายุแล้ว', detail: contactAdmin(`หมดอายุ ${formatDate(grant.validUntil)}`) };
    return { allowed: true, reason: 'active_tool', title: 'สิทธิ์พร้อมใช้งาน', detail: grant.validUntil ? `ใช้งานได้ถึง ${formatDate(grant.validUntil)}` : 'สิทธิ์รายโปรแกรมเป็น Active' };
  }

  async function readAccount(user) {
    const direct = await firebase.get(firebase.ref(database, `${ROOT}/accounts/${user.uid}`));
    if (direct.exists()) return direct.val();
    if (!adminEmail(user)) return null;
    const all = await firebase.get(firebase.ref(database, `${ROOT}/accounts`));
    const email = String(user.email || '').trim().toLowerCase();
    return Object.values(all.val() || {}).find((item) => String(item?.email || '').trim().toLowerCase() === email) || null;
  }

  async function loadFirebase() {
    if (firebase) return firebase;
    const base = `https://www.gstatic.com/firebasejs/${SDK}`;
    const [appModule, authModule, databaseModule] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-database.js`)
    ]);
    const app = appModule.initializeApp(FIREBASE);
    auth = authModule.getAuth(app);
    database = databaseModule.getDatabase(app);
    firebase = { ...appModule, ...authModule, ...databaseModule };
    return firebase;
  }

  async function refreshAccess() {
    if (!firebase || !auth || !database) return;
    if (!currentUser) {
      setLocked('กรุณาเข้าสู่ระบบก่อน', 'ใช้บัญชี Google เดียวกับ PepsLiveTool Launcher');
      return;
    }
    if (refreshButton) refreshButton.disabled = true;
    try {
      const [contentSnapshot, account] = await Promise.all([
        firebase.get(firebase.ref(database, `${ROOT}/content`)),
        readAccount(currentUser)
      ]);
      const result = accessStatus(contentSnapshot.val() || {}, account, currentUser);
      lastResult = result;
      if (result.allowed) setUnlocked(result);
      else setLocked(result.title, result.detail, result.reason.startsWith('invalid_'));
    } catch (error) {
      setLocked('ตรวจสอบสิทธิ์ไม่สำเร็จ', error?.message || 'Firebase ไม่พร้อมใช้งาน กรุณาลองอีกครั้ง', true);
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  async function signIn() {
    if (!firebase || !auth) return;
    if (loginButton) loginButton.disabled = true;
    try {
      await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider());
    } catch (error) {
      setLocked('เข้าสู่ระบบไม่สำเร็จ', error?.message || 'กรุณาอนุญาต Popup และลองอีกครั้ง', true);
    } finally {
      if (loginButton) loginButton.disabled = false;
    }
  }

  async function signOut() {
    if (auth && firebase) await firebase.signOut(auth);
  }

  loginButton?.addEventListener('click', signIn);
  refreshButton?.addEventListener('click', refreshAccess);
  logoutButton?.addEventListener('click', signOut);
  window.__PEPSLIVE_LICENSE__ = Object.freeze({ toolId, allowed: false, refresh: refreshAccess });

  (async () => {
    try {
      const modules = await loadFirebase();
      modules.onAuthStateChanged(auth, (user) => {
        currentUser = usableUser(user);
        updateIdentity();
        if (logoutButton) logoutButton.hidden = !currentUser;
        if (loginButton) loginButton.hidden = !!currentUser;
        if (user && !currentUser) void modules.signOut(auth).catch(() => {});
        void refreshAccess();
      });
      setStatus('รอการเข้าสู่ระบบ', 'ใช้บัญชี Google เดียวกับ PepsLiveTool Launcher');
    } catch (error) {
      setLocked('ระบบสิทธิ์ยังไม่พร้อม', error?.message || 'โหลด Firebase ไม่สำเร็จ', true);
    }
  })();

  window.setInterval(() => { void refreshAccess(); }, 30_000);
})();
