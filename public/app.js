const state = {
  token: localStorage.getItem('trinsit_token') || '',
  user: JSON.parse(localStorage.getItem('trinsit_user') || 'null'),
  route: 'dashboard',
  socket: null,
  map: null,
  markers: {},
  autoGpsWatchId: null,
  data: { trips: [], users: [], payers: [], attendance: [], expenses: [], inspections: [], incidents: [], equipment: [], notifications: [], messages: [], gps: [], chatUsers: [], directory: [], channels: [], priceSettings: {}, dashboardSummary: null },
  workType: '',
  geoSuggestTimers: {},
  unreadMessages: 0,
  onlineUserIds: [],
  selectedChatTarget: 'broadcast',
  drawerOpen: false,
  featureSettings: { notificationsEnabled: true, commissionEnabled: true, mapEnabled: true },
};
const app = document.getElementById('app');
const tripStepOrder = ['assigned','trip_in_progress','arrived_pickup','leaving_with_patient','completed'];

function roleIs(...roles){ return !!state.user && roles.includes(state.user.role); }
function apiHeaders(extra={}){ return { ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...extra }; }
async function apiJson(url, method='GET', body){
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...apiHeaders() }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiForm(url, formData, method='POST'){
  const res = await fetch(url, { method, headers: apiHeaders(), body: formData });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
function saveAuth(token, user){ state.token = token; state.user = user; localStorage.setItem('trinsit_token', token); localStorage.setItem('trinsit_user', JSON.stringify(user)); }
function logout(){ localStorage.removeItem('trinsit_token'); localStorage.removeItem('trinsit_user'); state.token=''; state.user=null; if(state.socket) state.socket.disconnect(); stopAutoGps(); render(); }
function toast(title, msg=''){ const t=document.createElement('div'); t.className='toast'; t.textContent = msg ? `${title}: ${msg}` : title; document.body.appendChild(t); setTimeout(()=>t.remove(),2800); }
function money(v){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0)); }
function fmtDate(v){ return v ? new Date(v).toLocaleString() : ''; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

function dateDigitsValue(v){ return String(v||'').replace(/[^0-9]/g,'').slice(0,8); }
function displayDob(v){
  const d=dateDigitsValue(v); if(d.length<8) return v||'';
  return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4,8)}`;
}
function normalizeDobInput(v){ return dateDigitsValue(v); }
function safeVibrate(pattern){ try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch{} }
async function ensureNotificationPermission(){ try{ if(!('Notification' in window)) return false; if(Notification.permission==='granted') return true; if(Notification.permission!=='denied') return (await Notification.requestPermission())==='granted'; }catch{} return false; }
function playAlertTone(){
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if(!Ctx) return;
    const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type='sine'; osc.frequency.value=880; gain.gain.value=0.03; osc.connect(gain); gain.connect(ctx.destination); osc.start(); setTimeout(()=>{osc.stop(); ctx.close();},180);
  } catch {}
}
function showDeviceNotification(title, body){
  ensureNotificationPermission().then(ok=>{ if(ok){ try{ new Notification(title,{body,icon:'/logo.png',badge:'/logo.png'}); }catch{} } });
  safeVibrate([180,80,180]);
  playAlertTone();
}
function computeUnreadMessages(){
  if(!state.user) return 0;
  return state.data.messages.filter(m => m.userId !== state.user.id && !m.readBy?.includes?.(state.user.id)).length;
}

async function reverseGeocode(lat,lng){
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data.display_name || `${lat}, ${lng}`;
  } catch { return `${lat}, ${lng}`; }
}
async function getCurrentPos(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}), ()=>reject(new Error('GPS permission denied')), {enableHighAccuracy:true, timeout:10000, maximumAge:5000});
  });
}
function stopAutoGps(){ if(state.autoGpsWatchId != null){ navigator.geolocation.clearWatch(state.autoGpsWatchId); state.autoGpsWatchId = null; } }
function startAutoGps(){
  if(!navigator.geolocation || state.autoGpsWatchId != null) return;
  state.autoGpsWatchId = navigator.geolocation.watchPosition(async p=>{
    try { await apiJson('/api/gps/update','POST',{ lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy }); } catch {}
  }, ()=>{}, { enableHighAccuracy:true, maximumAge:10000, timeout:15000 });
}
async function quickClock(type){
  const labelMap={clock_out:'Clock Out', lunch_out:'Start Break', lunch_in:'End Break'};
  if(!confirm(`Status: ${labelMap[type]||type}. Do you want to proceed with this action?`)) return;
  try{ const pos = await getCurrentPosition(); await apiJson('/api/attendance/clock','POST',{ type, ...pos, address: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` }); await loadAttendance(); await loadGps(); render(); toast('Information entered successfully'); toast(`${labelMap[type]||type} saved successfully`); }catch(err){ toast('Attendance', err.message); }
}


async function bootstrap(){
  if(!state.token) return render();
  try{
    state.user = await apiJson('/api/me');
    connectSocket();
    await loadAll();
    const last = roleIs('driver','contractor_driver') ? null : setInterval(()=>{ if(state.route==='map') loadGps().then(()=>renderMap(true)); }, 12000);
    state._mapPoll = last;
    const att = state.data.attendance.find(a => a.userId === state.user.id);
    if(att && ['clock_in','lunch_in'].includes(att.type)) startAutoGps();
  }catch(e){ logout(); return; }
  render();
}
function connectSocket(){
  if(state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('notification', n=>{ state.data.notifications.unshift(n); renderNotificationsBadge(); showDeviceNotification(n.title, n.body || ''); });
  state.socket.on('message:new', m=>{ state.data.messages.unshift(m); state.unreadMessages = computeUnreadMessages(); renderTopBadges(); if(state.route==='chat') render(); if(m.userId !== state.user?.id) showDeviceNotification('TRINSIT Message', `${m.userName}: ${m.text}`); });
  state.socket.on('trip:updated', ()=>loadTrips().then(()=>{ if(state.route==='trips'||state.route==='dashboard') render(); }));
  state.socket.on('gps:update', g=>{ const idx = state.data.gps.findIndex(x=>x.userId===g.userId); if(idx>=0) state.data.gps[idx]=g; else state.data.gps.push(g); if(state.route==='map') renderMap(true); });
  state.socket.on('gps:clear', g=>{ state.data.gps = state.data.gps.filter(x=>x.userId!==g.userId); if(state.route==='map') renderMap(true); });
  state.socket.on('presence:update', ids=>{ state.onlineUserIds = ids || []; if(state.route==='chat') render(); });
  state.socket.on('channel:new', c=>{ state.data.channels.unshift(c); if(state.route==='chat') render(); });
}
async function loadTrips(){ state.data.trips = await apiJson('/api/trips'); }
async function loadUsers(){ if(roleIs('admin','manager','dispatcher')) state.data.users = await apiJson('/api/users'); }
async function loadPayers(){ state.data.payers = await apiJson('/api/payers'); }
async function loadAttendance(){ state.data.attendance = await apiJson('/api/attendance'); }
async function loadExpenses(){ state.data.expenses = await apiJson('/api/expenses'); }
async function loadInspections(){ state.data.inspections = await apiJson('/api/inspections'); }
async function loadIncidents(){ state.data.incidents = await apiJson('/api/incidents'); }
async function loadEquipment(){ state.data.equipment = await apiJson('/api/equipment'); }
async function loadNotifications(){ state.data.notifications = []; }
async function loadMessages(){ state.data.messages = await apiJson('/api/messages'); }
async function loadChatUsers(){ state.data.chatUsers = await apiJson('/api/chat/users'); }
async function loadDirectory(){ state.data.directory = await apiJson('/api/chat/directory'); }
async function loadChannels(){ state.data.channels = await apiJson('/api/chat/channels'); }
async function loadGps(){ if(roleIs('admin','manager','dispatcher')) state.data.gps = await apiJson('/api/gps'); else state.data.gps=[]; }
async function loadPriceSettings(){ state.data.priceSettings = await apiJson('/api/price-settings'); }
async function loadDashboardSummary(){ if(roleIs('admin')) state.data.dashboardSummary = await apiJson('/api/dashboard/summary'); else state.data.dashboardSummary = null; }
async function loadFeatureSettings(){ if(roleIs('admin')) state.featureSettings = await apiJson('/api/feature-settings'); }
async function loadAll(){ await Promise.all([loadTrips(),loadUsers(),loadPayers(),loadAttendance(),loadExpenses(),loadInspections(),loadIncidents(),loadEquipment(),loadMessages(),loadChatUsers(),loadDirectory(),loadChannels(),loadGps(),loadPriceSettings(),loadDashboardSummary(),loadFeatureSettings()]); state.unreadMessages = computeUnreadMessages(); }

function render(){
  if(!state.user) return renderLogin();
  if(state.user.mustCompleteProfile) return renderFirstLoginProfile();
  const nav = [ ['dashboard','Dashboard'], ['trips','Trips'], ['attendance','Attendance'], ['map','Live Map'], ['expenses','Expenses'], ['inspection','Vehicle Inspection'], ['incidents','Incident Report'], ['chat','Team Chat'] ];
  if(roleIs('admin','manager')) nav.push(['pricing','Pricing']);
  if(roleIs('admin')) nav.push(['control','Control Panel'], ['users','Users']);
  if(roleIs('admin','manager','dispatcher')) nav.splice(5,0,['equipment','Equipment']);
  const drawer = `
    <aside class="drawer ${state.drawerOpen?'open':''}" id="navDrawer">
      <div class="drawer-header">
        <div class="brand"><img src="/logo.png" alt="TRINSIT"/><div><strong>TRINSIT</strong><div class="muted small">Operations</div></div></div>
        <button class="ghost icon-btn" onclick="toggleDrawer(false)">✕</button>
      </div>
      <div class="userbox"><strong>${escapeHtml(state.user.name)}</strong><div class="muted small">${escapeHtml(state.user.role)} access</div></div>
      <nav class="drawer-nav">${nav.map(([key,label])=>`<button class="navbtn ${state.route===key?'active':''}" onclick="goRoute('${key}')">${label}</button>`).join('')}</nav>
      <div class="clock-actions compact-stack">
        <button onclick="quickClock('clock_in')">Clock In</button>
        <button class="secondary" onclick="quickClock('lunch_out')">Lunch Out</button>
        <button class="secondary" onclick="quickClock('lunch_in')">Lunch In</button>
        <button class="danger" onclick="quickClock('clock_out')">Clock Out</button>
        <button class="ghost" onclick="logout()">Logout</button>
      </div>
    </aside>
    <div class="drawer-backdrop ${state.drawerOpen?'show':''}" onclick="toggleDrawer(false)"></div>`;
  app.innerHTML = `
  <div class="shell drawer-shell">
    ${drawer}
    <main class="main">
      <header class="topbar clean-topbar">
        <div class="topbar-left">
          <button class="ghost icon-btn" onclick="toggleDrawer(true)">☰</button>
          <div><h2>${pageTitle()}</h2><div class="muted small">TRINSIT operations control</div></div>
        </div>
        <div class="top-actions"><button class="notif-btn ${state.tripAlertActive?'pulse-alert':''}" onclick="openNotifications()">🚐 <span id="notifBadge" class="notif-pill">${state.data.notifications.filter(x=>!x.read).length}</span></button><button class="notif-btn" onclick="goRoute('chat')">💬 <span id="msgBadge" class="notif-pill">${state.unreadMessages||0}</span></button></div>
      </header>
      ${routeView()}
    </main>
  </div>`;
  bindPage();
  if(state.route==='map') setTimeout(()=>renderMap(false), 80);
}
function renderNotificationsBadge(){ renderTopBadges(); }
function renderTopBadges(){ const el=document.getElementById('notifBadge'); if(el) el.textContent = state.data.notifications.filter(x=>!x.read).length; const msg=document.getElementById('msgBadge'); if(msg) msg.textContent = state.unreadMessages||0; }
function pageTitle(){ return {dashboard: roleIs('driver','contractor_driver') ? 'Driver Home' : 'Admin Dashboard', trips:'Trips', attendance:'Attendance', map:'Live Map', expenses:'Expenses', inspection:'Vehicle Inspection', incidents:'Incident Report', equipment:'Equipment', chat:'Team Chat', commission:'Commission Entry', pricing:'Pricing Admin', control:'Control Panel', users:'User Admin'}[state.route] || 'TRINSIT'; }
function goRoute(route){ state.route = route; render(); }
function toggleDrawer(open){ state.drawerOpen = !!open; const drawer=document.getElementById('navDrawer'); const backdrop=document.querySelector('.drawer-backdrop'); if(drawer) drawer.classList.toggle('open', state.drawerOpen); if(backdrop) backdrop.classList.toggle('show', state.drawerOpen); }
window.goRoute = function(route){ state.route = route; state.drawerOpen = false; render(); }; window.logout = logout; window.quickClock = quickClock; window.toggleDrawer = toggleDrawer; window.selectChatTarget = function(target){ state.selectedChatTarget = target; state.unreadMessages = computeUnreadMessages(); render(); }; window.openNotifications = function(){ state.route='dashboard'; state.data.notifications = state.data.notifications.map(n=>({...n,read:true})); state.tripAlertActive = false; render(); };

function renderLogin(){
  app.innerHTML = `<div class="login-wrap premium"><div class="login-card premium-card"><img class="login-logo" src="/logo.png" alt="TRINSIT"/><div class="eyebrow">TRINSIT Secure Access</div><h1>Enter your passcode</h1><p class="muted">Use your 6 digits plus special symbol.</p><form id="loginForm" class="grid"><label>Passcode<input name="passcode" type="password" inputmode="text" placeholder="••••••!" required></label><button>Unlock App</button></form><div class="small muted center">No email or password required.</div></div></div>`;
  document.getElementById('loginForm').onsubmit = async (e)=>{
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    if(!confirm('Status: ready to sign in. Proceed with login?')) return; try{ const out = await apiJson('/api/auth/login','POST',body); saveAuth(out.token,out.user); await ensureNotificationPermission(); sessionStorage.setItem('trinsit_after_login_refresh','1'); await bootstrap(); if(sessionStorage.getItem('trinsit_after_login_refresh')==='1'){ sessionStorage.setItem('trinsit_after_login_refresh','done'); setTimeout(()=>location.reload(),120); } }catch(err){ toast('Login', err.message); }
  };
}
function renderFirstLoginProfile(){
  app.innerHTML = `<div class="login-wrap"><div class="login-card wide"><h2>Complete your profile</h2><form id="profileForm" class="grid"><label>Phone Number<input name="phone" required></label><label>Date of Birth<input name="dateOfBirth" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" placeholder="MMDDYYYY" required></label><label>Certificate (if any)<input name="certificate"></label><label>Address<textarea name="address" required></textarea></label><label>Upload Driver License or ID Card<input type="file" name="identityFile" accept="image/*,.pdf" capture="environment" required></label><button>Save Profile</button></form></div></div>`;
  document.getElementById('profileForm').onsubmit = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.set('dateOfBirth', normalizeDobInput(fd.get('dateOfBirth')));
    try{ const user = await apiForm('/api/me/complete-profile', fd); localStorage.setItem('trinsit_user', JSON.stringify(user)); state.user = user; await loadAll(); render(); }catch(err){ toast('Profile', err.message); }
  };
}

function routeView(){
  if(state.route==='workselect') return workSelectionView();
  switch(state.route){
    case 'dashboard': return dashboardView();
    case 'trips': return tripsView();
    case 'attendance': return attendanceView();
    case 'map': return mapView();
    case 'expenses': return expensesView();
    case 'inspection': return inspectionView();
    case 'incidents': return incidentsView();
    case 'equipment': return equipmentView();
    case 'chat': return chatView();
    case 'commission': return commissionPageView();
    case 'pricing': return pricingView();
    case 'control': return controlPanelView();
    case 'users': return usersView();
    default: return dashboardView();
  }
}

function workSelectionView(){
  const canCommission = !!state.user?.showCommissionPage && state.featureSettings?.commissionEnabled !== false;
  return `<div class="panel premium-panel"><h3>Select Work Type</h3><div class="muted small">Choose your work mode for this session.</div><form id="workTypeForm" class="grid"><label>Work Type<select name="workType"><option value="hourly">Hourly</option><option value="contractor">Contractor</option>${canCommission?'<option value="commission">Commissions</option>':''}</select></label><div class="actions"><button>Continue</button></div></form></div>`;
}

function commissionPageView(){
  return `<div class="panel premium-panel"><h3>Commission Page</h3><div class="muted small">Add one or more patient commission entries. All fields are required.</div><form id="commissionPageForm" class="grid"><div id="commissionPageRows" class="full">${commissionRow(0)}</div><div class="actions full"><button type="button" class="secondary" id="addCommissionPageRow">Add Patient</button><button>Save Commission Entries</button></div></form></div>`;
}

function dashboardView(){
  const summary = state.data.dashboardSummary;
  const cards = summary ? `
    <div class="cards">
      <div class="card"><div class="small muted">Daily Gross</div><div class="metric">${money(summary.gross.daily)}</div></div>
      <div class="card"><div class="small muted">Weekly Gross</div><div class="metric">${money(summary.gross.weekly)}</div></div>
      <div class="card"><div class="small muted">Monthly Gross</div><div class="metric">${money(summary.gross.monthly)}</div></div>
      <div class="card"><div class="small muted">Weekly Net</div><div class="metric">${money(summary.net.weekly)}</div></div>
      <div class="card"><div class="small muted">Monthly Net</div><div class="metric">${money(summary.net.monthly)}</div></div>
    </div>
    <div class="split"><section class="panel"><h3>Expenses by User</h3>${summary.expenses.byUser.map(x=>`<div class="rowline"><span>${escapeHtml(x.userName)}</span><strong>${money(x.total)}</strong></div>`).join('') || '<div class="muted">No expenses.</div>'}</section>
    <section class="panel"><h3>Vehicle Mileage</h3>${summary.vehicleMileage.map(x=>`<div class="rowline"><span>${escapeHtml(x.vehicleUnit)}</span><strong>${Number(x.mileage||0).toFixed(1)} mi</strong></div>`).join('') || '<div class="muted">No mileage.</div>'}</section></div>
    <div class="panel"><h3>Daily Uploaded Documents</h3><div class="muted small">Download all documents uploaded by users for a selected day.</div><form id="docDownloadForm" class="inline-form"><label>Date<input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></label><button type="submit">Download Documents</button></form></div>` : '';
  return `${cards}<div class="panel"><h3>Recent Trips</h3>${tripTable(state.data.trips.slice(0,10))}</div>`;
}
function tripTable(trips){
  if(roleIs('driver','contractor_driver')){
    return `<div class="driver-cards">${trips.map(t=>`<article class="trip-card-mobile"><div class="trip-card-head"><div><div class="trip-time">${escapeHtml(t.pickupTime||'')}</div><div class="trip-id">${escapeHtml(t.tripNumber||t.id)}</div></div><span class="status-pill ${escapeHtml(String(t.status||'').replace(/_/g,'-'))}">${escapeHtml(String(t.status).replace(/_/g,' '))}</span></div><div class="trip-card-body"><div><label>Patient</label><strong>${escapeHtml(t.patientName)}</strong></div><div><label>Pickup</label><strong>${escapeHtml(t.pickupLocation)}</strong></div><div><label>Service</label><strong>${escapeHtml(t.service)}</strong></div><div><label>Weight</label><strong>${escapeHtml(t.weight)}</strong></div><div><label>Drop-off</label><strong>${escapeHtml(t.dropoffLocation)}</strong></div><div><label>Oxygen</label><strong>${escapeHtml(t.oxygen)} ${t.oxygen==='Yes' ? `(${escapeHtml(t.oxygenLiters)}L)` : ''}</strong></div>${(t.additionalStops||[]).length?`<div class="full"><label>Other Stop</label><strong>${escapeHtml((t.additionalStops||[]).join(', '))}</strong></div>`:''}</div><div class="actions"><button class="open-trip-btn" onclick="showTrip('${t.id}')">Open</button></div></article>`).join('') || '<div class="muted">No assigned trips.</div>'}</div>`;
  }
  return `<div class="table-wrap"><table><thead><tr><th>Trip ID</th><th>Date</th><th>Patient</th><th>Pickup</th><th>Dropoff</th><th>Service</th><th>Drivers</th><th>Status</th>${roleIs('admin','manager','dispatcher')?'<th>Payer</th><th>Mileage</th><th>Gross</th>':''}<th>Actions</th></tr></thead><tbody>${trips.map(t=>{
    const drivers = (t.assignedDriverIds||[]).map(id=>state.data.users.find(u=>u.id===id)?.name||'Unknown').join(', ');
    return `<tr><td>${escapeHtml(t.tripNumber||t.id)}</td><td>${escapeHtml(t.pickupDate)} ${escapeHtml(t.pickupTime||'')}</td><td>${escapeHtml(t.patientName)}</td><td>${escapeHtml(t.pickupLocation)}</td><td>${escapeHtml(t.dropoffLocation)}</td><td>${escapeHtml(t.service)}</td><td>${escapeHtml(drivers)}</td><td>${escapeHtml(String(t.status).replace(/_/g,' '))}</td>${roleIs('admin','manager','dispatcher')?`<td>${escapeHtml(t.payer||'')}</td><td>${Number(t.googleMileage||t.mileage||0).toFixed(1)}</td><td>${money(t.priceBreakdown?.total||0)}</td>`:''}<td><button class="smallbtn" onclick="showTrip('${t.id}')">Open</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function tripStatusActions(trip){
  if(!roleIs('driver','contractor_driver')) return '';
  const logs = trip.tripLogs || [];
  const logged = status => trip.status === status || logs.some(l => l.status === status);
  const hasFacesheet = (trip.facesheetFiles||[]).length > 0 || logged('facesheet_uploaded');

  const inProgressDone = logged('trip_in_progress');
  const arrivedDone = logged('arrived_pickup');
  const leavingDone = logged('leaving_with_patient');
  const completedDone = logged('completed');

  const canStart = !completedDone && !inProgressDone;
  const canArrive = !completedDone && !arrivedDone && (inProgressDone || hasFacesheet || leavingDone);
  const canUpload = !completedDone && !hasFacesheet && (arrivedDone || leavingDone);
  const canLeave = !completedDone && !leavingDone && hasFacesheet;
  const canComplete = !completedDone && (leavingDone || trip.status === 'leaving_with_patient');

  return `<div class="progress-vertical">
    <button class="progress-step-btn ${inProgressDone?'done':''} ${canStart?'':'locked'}" ${canStart?'':'disabled'} onclick="advanceTrip('${trip.id}','trip_in_progress')"><span class="step-dot"></span><span class="step-label">Trip In Progress</span></button>
    <button class="progress-step-btn ${arrivedDone?'done':''} ${canArrive?'':'locked'}" ${canArrive?'':'disabled'} onclick="advanceTrip('${trip.id}','arrived_pickup')"><span class="step-dot"></span><span class="step-label">Arrived for Pick Up</span></button>
    <label class="progress-step ${hasFacesheet?'done':'current'}"><span class="step-dot"></span><span class="step-label">Upload Facesheet</span><input type="file" accept="image/*,.pdf" ${canUpload?'':'disabled'} onchange="uploadFacesheet('${trip.id}', this.files[0])"></label>
    <button class="progress-step-btn ${leavingDone?'done':''} ${canLeave?'':'locked'}" ${canLeave?'':'disabled'} onclick="advanceTrip('${trip.id}','leaving_with_patient')"><span class="step-dot"></span><span class="step-label">Leaving With Patient</span></button>
    <button class="progress-step-btn ${completedDone?'done':''} ${canComplete?'':'locked'}" ${canComplete?'':'disabled'} onclick="advanceTrip('${trip.id}','completed')"><span class="step-dot"></span><span class="step-label">Trip Completed</span></button>
  </div>`;
}
function tripsView(){
  const payerOptions = state.data.payers.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  const driverOpts = state.data.users.filter(u=>['driver','contractor_driver'].includes(u.role) && u.accountStatus==='active').map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
  return `<div class="split responsive-top">
    ${roleIs('admin','manager','dispatcher')?`<section class="panel"><h3>Create New Trip</h3><form id="tripForm" class="grid trip-grid">
      <label>Pick Up Date<input type="date" name="pickupDate" required></label>
      <label>Pick Up Time<input type="time" name="pickupTime" required></label>
      <label>Patient Name<input name="patientName" required></label>
      <label class="full">Pick Up Location<input name="pickupLocation" id="pickupLocationInput" list="pickupSuggestions" required autocomplete="off"></label><datalist id="pickupSuggestions"></datalist>
      <label>Room Number<input name="roomNumber"></label>
      <label>Service<select name="service" required><option>Wheelchair</option><option>Stretcher</option><option>Climbing Stairs Chair</option><option>Own Wheelchair</option><option>Ambulatory</option></select></label>
      <label>Weight<input type="number" name="weight" required></label>
      <label class="full">Drop Off Location<input name="dropoffLocation" id="dropoffLocationInput" list="dropoffSuggestions" required autocomplete="off"></label><datalist id="dropoffSuggestions"></datalist>
      <label>Auto Mileage<input type="number" step="0.1" name="googleMileage" id="googleMileageInput" required readonly></label>
      <label>Vehicle Unit<input name="vehicleUnit"></label>
      <label>Payer<select name="payer" required>${payerOptions}</select></label>
      <label>Date of Birth<input name="dateOfBirth" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" placeholder="MMDDYYYY" required></label>
      <label>MRN<input name="mrn"></label>
      <label>Caregiver On Board<select name="caregiverOnBoard" id="caregiverSelect" required><option value="No">No</option><option value="Yes">Yes</option></select></label>
      <label id="caregiverCountWrap">Caregiver Count<input type="number" name="caregiverCount"></label>
      <label>Oxygen<select name="oxygen" id="oxygenSelect" required><option value="No">No</option><option value="Yes">Yes</option></select></label>
      <label id="oxygenLitersWrap">Oxygen Liters<input type="number" name="oxygenLiters"></label>
      <label>Additional Stop?<select id="hasStop"><option value="No">No</option><option value="Yes">Yes</option></select></label>
      <div id="stopWrap"></div>
      <label>Driver 1<select name="driver1"><option value="">None</option>${driverOpts}</select></label>
      <label>Driver 2<select name="driver2"><option value="">None</option>${driverOpts}</select></label>
      <label class="full">Note<textarea name="note" required></textarea></label>
      <div class="full actions"><button>Create Trip</button><button type="button" class="secondary" id="addPayerBtn">Add New Payer</button></div>
    </form></section>`:''}
    <section class="panel"><h3>Trip Log</h3>${tripTable(state.data.trips)}</section>
  </div>
  <div id="tripModal" class="modal hidden"></div>`;
}
function attendanceView(){
  const latestSelf = state.data.attendance.find(a=>a.userId===state.user.id);
  const clockedIn = !!latestSelf && ['clock_in','lunch_in','lunch_out'].includes(latestSelf.type);
  const visibleAttendance = roleIs('admin','manager','dispatcher') ? state.data.attendance : state.data.attendance.filter(a=>a.userId===state.user.id);
  const rows = visibleAttendance.map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.type)}</td><td>${fmtDate(a.createdAt)}</td><td>${escapeHtml(a.address||'')}</td><td>${escapeHtml(a.payType || (a.commissionPay ? 'commission' : 'hourly'))}</td><td>${(a.commissionTrips||[]).map(t=>`${escapeHtml(t.firstName||'')} ${escapeHtml(t.lastName||'')} / ${escapeHtml(t.pickupLocation||'')} / ${escapeHtml(t.date||'')} ${escapeHtml(t.time||'')}`).join('<br>')}</td>${roleIs('admin')?`<td><div class="actions compact-actions"><button class="smallbtn" onclick="editAttendance('${a.id}')">Edit</button><button class="smallbtn danger" onclick="deleteAttendance('${a.id}')">Delete</button></div></td>`:''}</tr>`).join('');
  return `<div class="split responsive-top"><section class="panel"><h3>${clockedIn ? 'You are clocked in' : 'Clock In'}</h3><div class="muted small">Clock in turns on live GPS sharing until clock out. Dispatch sees your live location on the map automatically.</div>${clockedIn ? `<div class="item"><strong>Status:</strong> ${escapeHtml(latestSelf.type)}<div class="small muted">${escapeHtml(latestSelf.address||'')}</div><div class="actions compact-actions"><button class="secondary" onclick="quickClock('lunch_out')">Lunch Out</button><button class="secondary" onclick="quickClock('lunch_in')">Lunch In</button><button class="danger" onclick="quickClock('clock_out')">Clock Out</button></div></div>` : `<form id="clockInForm" class="grid trip-grid compact"><label>Pay Type<select name="payType" id="payTypeSelect"><option value="hourly">Hourly</option><option value="per_trip">Per Trip</option><option value="commission">Commission</option></select></label><div id="commissionWrap" class="full hidden"><div class="sectionhead"><strong>Commission Entries</strong><button type="button" class="smallbtn" id="addCommissionRow">Add Entry</button></div><div id="commissionRows"></div></div><div class="full actions"><button>Clock In Now</button></div></form>`}</section><section class="panel"><h3>Attendance Log</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Type</th><th>Time</th><th>Address</th><th>Pay Type</th><th>Commission Entries</th>${roleIs('admin')?'<th>Actions</th>':''}</tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No attendance yet.</td></tr>'}</tbody></table></div></section></div>`;
}
function commissionRow(index){
  return `<div class="commission-row" data-index="${index}"><label>Patient First Name<input name="firstName" required></label><label>Patient Last Name<input name="lastName" required></label><label>Pick Up Location<input name="pickupLocation" required></label><label>Date<input type="date" name="date" required></label><label>Date and Time<input type="time" name="time" required></label><button type="button" class="smallbtn danger" onclick="removeCommissionRow(this)">Remove</button></div>`;
}
function mapView(){ return `<section class="map-full"><div class="map-toolbar"><span><span class="dot admin"></span>Admin</span><span><span class="dot dispatcher"></span>Dispatcher</span><span><span class="dot manager"></span>Manager</span><span><span class="dot driver"></span>Driver</span></div><div id="liveMap"></div></section>`; }
function expensesView(){
  return `<div class="split responsive-top"><section class="panel"><h3>New Expense</h3><form id="expenseForm" class="grid">
  <label>Category<select name="category" id="expenseCategory"><option>Gas</option><option>Oil Change</option><option>Change Tires</option><option>Car Wash</option><option>Maintenance</option><option>Other</option></select></label>
  <label>Date<input type="date" name="expenseDate" required></label>
  <label>Amount<input type="number" step="0.01" name="amount" required></label>
  <label id="expenseOtherWrap">Other Text<input name="otherText"></label>
  <label class="full" id="expenseNoteWrap">Note<textarea name="note"></textarea></label>
  <label>Receipt<input type="file" name="receipt" accept="image/*,.pdf" capture="environment"></label>
  <button>Save Expense</button></form></section>
  <section class="panel"><h3>Expense Log</h3>${state.data.expenses.map(e=>`<div class="item"><strong>${escapeHtml(e.category)}</strong><div>${money(e.amount)} • ${escapeHtml(e.userName||'')}</div><div class="small muted">${escapeHtml(e.expenseDate||'')}</div><div class="small">${escapeHtml(e.note||e.otherText||'')}</div>${roleIs('admin')?`<div class="actions compact-actions"><button class="smallbtn" onclick="editExpense('${e.id}')">Edit</button><button class="smallbtn danger" onclick="deleteExpense('${e.id}')">Delete</button></div>`:''}</div>`).join('') || '<div class="muted">No expenses.</div>'}</section></div>`;
}
function inspectionView(){ return `<div class="split responsive-top"><section class="panel"><h3>Vehicle Inspection</h3><form id="inspectionForm" class="grid trip-grid">
<label>Date<input type="date" name="date" required></label><label>Time<input type="time" name="time" required></label><label>Inspector / Driver<input name="inspectorName" value="${escapeHtml(state.user.name)}" required></label><label>Vehicle Number<input name="vehicleNumber" required></label><label>Odometer Reading<input name="odometerReading" required></label>
<label>Brakes<select name="brakes"><option>Pass</option><option>Needs Attention</option></select></label><label>Tires<select name="tires"><option>Pass</option><option>Needs Attention</option></select></label><label>Steering<select name="steering"><option>Pass</option><option>Needs Attention</option></select></label><label>Lights<select name="lights"><option>Pass</option><option>Needs Attention</option></select></label><label>Fluid Levels<select name="fluidLevels"><option>Pass</option><option>Needs Attention</option></select></label>
<label>Wheelchair Lift<select name="wheelchairLift"><option>Pass</option><option>Needs Attention</option></select></label><label>Ramp Condition<select name="rampCondition"><option>Pass</option><option>Needs Attention</option></select></label><label>Lift Interlock<select name="liftInterlock"><option>Pass</option><option>Needs Attention</option></select></label><label>4-Point Securement<select name="securementSystem"><option>Pass</option><option>Needs Attention</option></select></label>
<label>Seat Belts<select name="seatBelts"><option>Pass</option><option>Needs Attention</option></select></label><label>Seat Condition<select name="seatCondition"><option>Pass</option><option>Needs Attention</option></select></label><label>Mirrors<select name="mirrors"><option>Pass</option><option>Needs Attention</option></select></label><label>Wipers<select name="wipers"><option>Pass</option><option>Needs Attention</option></select></label><label>Horn<select name="horn"><option>Pass</option><option>Needs Attention</option></select></label><label>Tie-Downs<select name="tieDowns"><option>Pass</option><option>Needs Attention</option></select></label><label>Interior Cleanliness<select name="interiorCleanliness"><option>Pass</option><option>Needs Attention</option></select></label><label>Exterior Safety<select name="exteriorSafety"><option>Pass</option><option>Needs Attention</option></select></label>
<label class="full">Defects / Repairs Needed<textarea name="defects"></textarea></label><label class="full">Corrective Action Taken<textarea name="correctiveActionTaken"></textarea></label><label>Upload up to 6 images<input type="file" name="images" accept="image/*" multiple capture="environment"></label><button>Submit Inspection</button></form></section>
<section class="panel"><h3>Submitted Inspections</h3>${state.data.inspections.map(i=>`<div class="item"><strong>${escapeHtml(i.vehicleNumber)}</strong><div>${escapeHtml(i.userName)} • ${escapeHtml(i.date)} ${escapeHtml(i.time)}</div><div class="small muted">Odometer ${escapeHtml(i.odometerReading||'')}</div></div>`).join('') || '<div class="muted">No inspections.</div>'}</section></div>`; }
function incidentsView(){ return `<div class="split responsive-top"><section class="panel"><h3>Incident Report</h3><form id="incidentForm" class="grid trip-grid">
<label>What to Report<select name="whatToReport"><option>Vehicle accidents</option><option>Passenger injuries (falls, cuts)</option><option>Medical emergencies (sudden illness)</option><option>Near misses</option></select></label>
<label>Event Date<input type="date" name="eventDate" required></label><label>Exact Time<input type="time" name="eventTime" required></label><label>Location<input name="location" required></label><label>Weather Conditions<input name="weather" required></label>
<label class="full">Passenger / Witness / Driver Contact Info<textarea name="driverContact" required placeholder="Names, phone numbers, addresses"></textarea></label>
<label class="full">Detailed Objective Description<textarea name="description" required></textarea></label>
<label class="full">Damages / Injuries / Medical Aid<textarea name="damagesInjuries" required></textarea></label><label class="full">Corrective Action Taken<textarea name="correctiveAction"></textarea></label>
<label>Images<input type="file" name="images" accept="image/*" multiple capture="environment"></label><button>Submit Incident</button></form></section>
<section class="panel"><h3>Submitted Incidents</h3>${state.data.incidents.map(i=>`<div class="item"><strong>${escapeHtml(i.whatToReport)}</strong><div>${escapeHtml(i.location)} • ${escapeHtml(i.eventDate)} ${escapeHtml(i.eventTime)}</div><div class="small muted">${escapeHtml(i.userName)}</div></div>`).join('') || '<div class="muted">No incidents.</div>'}</section></div>`; }
function equipmentView(){ return `<div class="split responsive-top"><section class="panel"><h3>Equipment Inventory</h3>${roleIs('admin')?`<form id="equipmentForm" class="grid"><label>Name<input name="name" required></label><label>Qty<input type="number" name="qty" required></label><label>Notes<textarea name="notes"></textarea></label><button>Save</button></form>`:'<div class="muted small">Complete item status and upload up to 4 images if needed.</div>'}</section><section class="panel">${state.data.equipment.map(i=>`<div class="item"><strong>${escapeHtml(i.name)}</strong><div>${escapeHtml(i.qty)} units</div><div class="small muted">${escapeHtml(i.notes||'')}</div>${roleIs('driver','contractor_driver')?`<form class="grid compact equipment-check-form" data-id="${i.id}"><label>Status<select name="status"><option>OK</option><option>Missing</option><option>Needs Service</option><option>Damaged</option></select></label><label class="full">Note<textarea name="note"></textarea></label><label class="full">Images<input type="file" name="images" accept="image/*" multiple capture="environment"></label><button>Submit Status</button></form>`:''}</div>`).join('') || '<div class="muted">No equipment.</div>'}</section></div>`; }
function chatView(){
  const directory = state.data.directory || [];
  const query = (state.chatSearch || '').toLowerCase();
  const people = directory.filter(u => u.id !== state.user.id && (`${u.name} ${u.role}`.toLowerCase().includes(query)));
  const channels = state.data.channels || [];
  const active = state.selectedChatTarget || 'broadcast';
  const filteredMessages = state.data.messages.slice().reverse().filter(m => {
    if(active === 'broadcast') return !m.channelId && (!m.recipientIds?.length);
    if(active.startsWith('user:')) { const uid = active.split(':')[1]; return !m.channelId && ((m.userId===uid && m.recipientIds?.includes(state.user.id)) || (m.userId===state.user.id && m.recipientIds?.includes(uid))); }
    if(active.startsWith('channel:')) return m.channelId === active.split(':')[1];
    return true;
  });
  const peopleHtml = people.map(u=>`<button class="chat-target ${active===`user:${u.id}`?'active':''}" onclick="selectChatTarget('user:${u.id}')"><span>${escapeHtml(u.name)}</span><small>${escapeHtml(u.role)}</small><span class="presence ${state.onlineUserIds.includes(u.id)?'online':'offline'}"></span></button>`).join('') || '<div class="muted">No teammates found.</div>';
  const channelHtml = channels.map(c=>`<button class="chat-target ${active===`channel:${c.id}`?'active':''}" onclick="selectChatTarget('channel:${c.id}')"><span># ${escapeHtml(c.name)}</span><small>${(c.memberIds||[]).length} members</small></button>`).join('') || '<div class="muted">No group channels.</div>';
  const title = active==='broadcast' ? 'Broadcast Channel' : active.startsWith('user:') ? (directory.find(u=>u.id===active.split(':')[1])?.name || 'Private Chat') : `# ${channels.find(c=>c.id===active.split(':')[1])?.name || 'Channel'}`;
  return `<div class="chat-layout"><aside class="chat-sidebar panel"><div class="sectionhead"><h3>Contacts</h3><input id="chatSearch" placeholder="Search teammates" value="${escapeHtml(state.chatSearch||'')}"></div><button class="chat-target ${active==='broadcast'?'active':''}" onclick="selectChatTarget('broadcast')"><span>Announcement Feed</span><small>All logged-in users</small></button><div class="chat-section-title">Direct Messages</div>${peopleHtml}<div class="chat-section-title">Group Channels</div>${channelHtml}<form id="newChannelForm" class="grid compact"><label>New channel name<input name="name" required></label><label>Members<select id="channelMembers" multiple size="5">${directory.filter(u=>u.id!==state.user.id).map(u=>`<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}</select></label><button>Create Group Channel</button></form></aside><section class="panel chat-main"><div class="chat-title"><h3>${escapeHtml(title)}</h3><div class="muted small">Red dot means unread. Green means online.</div></div><div class="chat-feed rich">${filteredMessages.map(m=>`<div class="chatmsg ${m.userId===state.user.id?'me':''}"><strong>${escapeHtml(m.userName)}</strong><div>${escapeHtml(m.text)}</div><div class="small muted">${fmtDate(m.createdAt)}</div></div>`).join('') || '<div class="muted">No messages yet.</div>'}</div><form id="chatForm" class="chat-compose"><textarea name="text" required placeholder="Type your message"></textarea><button>Send</button></form></section></div>`;
}


function controlPanelView(){
  if(!roleIs('admin')) return '<div class="panel">Admin only.</div>';
  const toggles = state.featureSettings || {};
  return `<div class="split responsive-top"><section class="panel premium-panel"><h3>Feature Controls</h3><form id="featureSettingsForm" class="grid trip-grid compact">
    <label class="switchrow"><span>Notifications</span><select name="notificationsEnabled"><option value="true" ${toggles.notificationsEnabled!==false?'selected':''}>Enabled</option><option value="false" ${toggles.notificationsEnabled===false?'selected':''}>Disabled</option></select></label>
    <label class="switchrow"><span>Commission Page</span><select name="commissionEnabled"><option value="true" ${toggles.commissionEnabled!==false?'selected':''}>Enabled</option><option value="false" ${toggles.commissionEnabled===false?'selected':''}>Disabled</option></select></label>
    <label class="switchrow"><span>Live Map</span><select name="mapEnabled"><option value="true" ${toggles.mapEnabled!==false?'selected':''}>Enabled</option><option value="false" ${toggles.mapEnabled===false?'selected':''}>Disabled</option></select></label>
    <div class="full actions"><button>Save Controls</button></div>
  </form></section>
  <section class="panel premium-panel"><h3>User Permissions</h3><div class="stack-list">${state.data.users.map(u=>`<div class="item clean-item"><div><strong>${escapeHtml(u.name)}</strong><div class="small muted">${escapeHtml(u.role)} • ${escapeHtml(u.accountStatus||'active')}</div></div><div class="actions wrap"><select onchange="changeUserRole('${u.id}', this.value)">${['admin','manager','dispatcher','driver','contractor_driver'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}</select><label class="checkboxline"><input type="checkbox" ${u.showCommissionPage?'checked':''} onchange="toggleCommissionPage('${u.id}', this.checked)"> Commission</label><button class="smallbtn danger" onclick="deleteUser('${u.id}')">Delete</button></div></div>`).join('')}</div></section></div>`;
}
function pricingView(){ if(!roleIs('admin','manager')) return '<div class=\"panel\">Admin or manager only.</div>'; const s=state.data.priceSettings; return `<div class=\"split responsive-top\"><section class=\"panel premium-panel\"><h3>Pricing</h3><form id=\"pricingForm\" class=\"grid trip-grid\"><label>Ambulatory<input name=\"ambulatory\" type=\"number\" value=\"${s.services?.ambulatory||0}\"></label><label>Wheelchair<input name=\"wheelchair\" type=\"number\" value=\"${s.services?.wheelchair||0}\"></label><label>Stretcher<input name=\"stretcher\" type=\"number\" value=\"${s.services?.stretcher||0}\"></label><label>Stair Chair<input name=\"climbing_stairs_chair\" type=\"number\" value=\"${s.services?.climbing_stairs_chair||0}\"></label><label>Own Wheelchair<input name=\"own_wheelchair\" type=\"number\" value=\"${s.services?.own_wheelchair||0}\"></label><label>Weight Threshold<input name=\"bariatricThreshold\" type=\"number\" value=\"${s.bariatricThreshold||250}\"></label><label>Weight Surcharge<input name=\"weightSurcharge\" type=\"number\" value=\"${s.weightSurcharge||0}\"></label><label>Oxygen Base<input name=\"oxygenBase\" type=\"number\" value=\"${s.oxygen?.base||0}\"></label><label>Oxygen Per Liter<input name=\"oxygenPerLiter\" type=\"number\" value=\"${s.oxygen?.perLiter||0}\"></label><label>Extra Stop<input name=\"extraStop\" type=\"number\" value=\"${s.extraStop||0}\"></label><label>11-39 Mile Rate<input name=\"tier2\" type=\"number\" value=\"${s.mileageTiers?.[1]?.rate||0}\"></label><label>40-99 Mile Rate<input name=\"tier3\" type=\"number\" value=\"${s.mileageTiers?.[2]?.rate||0}\"></label><label>100+ Mile Rate<input name=\"tier4\" type=\"number\" value=\"${s.mileageTiers?.[3]?.rate||0}\"></label><button>Save Pricing</button></form></section><section class=\"panel premium-panel\"><h3>Payers</h3><form id=\"payerForm\" class=\"inline-form\"><input name=\"name\" placeholder=\"Add new payer\"><button>Add</button></form><div class=\"stack-list\">${state.data.payers.map(p=>`<div class=\"item rowline\"><span>${escapeHtml(p)}</span><button class=\"smallbtn danger\" onclick=\"deletePayer('${encodeURIComponent(p)}')\">Delete</button></div>`).join('')}</div></section></div>`; }
function usersView(){ if(!roleIs('admin')) return '<div class="panel">Admin only.</div>'; return `<div class="split responsive-top"><section class="panel premium-panel"><h3>Create User</h3><form id="userForm" class="grid trip-grid compact"><label>Name<input name="name" required></label><label>Email (optional)<input name="email" type="email"></label><label>Login Code<input name="loginCode" required placeholder="123456!"></label><label>Role<select name="role"><option>manager</option><option>dispatcher</option><option>driver</option><option>contractor_driver</option><option>admin</option></select></label><button>Create User</button></form></section><section class="panel premium-panel"><h3>Manage Users</h3><div class="stack-list">${state.data.users.map(u=>`<div class="item clean-item"><div><strong>${escapeHtml(u.name)}</strong><div class="small muted">${escapeHtml(u.role)} • ${escapeHtml(u.accountStatus||'active')}</div></div><div class="actions wrap"><select onchange="changeUserRole('${u.id}', this.value)">${['admin','manager','dispatcher','driver','contractor_driver'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}</select><button class="smallbtn" onclick="resetPin('${u.id}')">Reset Login Code</button><button class="smallbtn" onclick="setStatus('${u.id}','active')">Activate</button><button class="smallbtn" onclick="setStatus('${u.id}','suspended')">Suspend</button><button class="smallbtn" onclick="setStatus('${u.id}','closed')">Close</button><button class="smallbtn danger" onclick="deleteUser('${u.id}')">Delete</button></div></div>`).join('')}</div></section></div>`; }


function bindPage(){
  const tripForm = document.getElementById('tripForm');
  if(tripForm){
    const stopSelect = document.getElementById('hasStop');
    const stopWrap = document.getElementById('stopWrap');
    const oxygenSelect = document.getElementById('oxygenSelect');
    const oxygenLitersWrap = document.getElementById('oxygenLitersWrap');
    const caregiverSelect = document.getElementById('caregiverSelect');
    const caregiverCountWrap = document.getElementById('caregiverCountWrap');
    const syncTripFields = ()=>{
      stopWrap.innerHTML = stopSelect && stopSelect.value === 'Yes' ? '<label class="full">Additional Stop Address<input name="additionalStopAddress" required></label>' : '';
      if(oxygenLitersWrap){ oxygenLitersWrap.style.display = oxygenSelect && oxygenSelect.value === 'Yes' ? 'block' : 'none'; const input = oxygenLitersWrap.querySelector('input'); if(input) input.required = oxygenSelect && oxygenSelect.value === 'Yes'; }
      if(caregiverCountWrap){ caregiverCountWrap.style.display = caregiverSelect && caregiverSelect.value === 'Yes' ? 'block' : 'none'; const input = caregiverCountWrap.querySelector('input'); if(input) input.required = caregiverSelect && caregiverSelect.value === 'Yes'; }
    };
    stopSelect && (stopSelect.onchange = syncTripFields);
    oxygenSelect && (oxygenSelect.onchange = syncTripFields);
    caregiverSelect && (caregiverSelect.onchange = syncTripFields);
    syncTripFields();
    tripForm.onsubmit = async (e)=>{
      e.preventDefault();
      const obj = Object.fromEntries(new FormData(tripForm).entries());
      obj.additionalStops = obj.additionalStopAddress ? [obj.additionalStopAddress] : [];
      delete obj.additionalStopAddress;
      obj.oxygen = obj.oxygen === 'Yes';
      obj.assignedDriverIds = [obj.driver1, obj.driver2].filter(Boolean);
      delete obj.driver1; delete obj.driver2;
      obj.mileage = Number(obj.googleMileage || 0);
      try{ await apiJson('/api/trips','POST',obj); await loadTrips(); await loadDashboardSummary(); render(); toast('Trip created successfully'); }catch(err){ toast('Trip', err.message); }
    };
    const addPayerBtn = document.getElementById('addPayerBtn');
    if(addPayerBtn) addPayerBtn.onclick = async ()=>{ const name = prompt('New payer name'); if(!name) return; try{ await apiJson('/api/payers','POST',{name}); await loadPayers(); render(); }catch(e){ toast('Payer', e.message); } };
  }
  const payTypeSelect = document.getElementById('payTypeSelect');
  const commissionWrap = document.getElementById('commissionWrap');
  const commissionRows = document.getElementById('commissionRows');
  const addCommissionRowBtn = document.getElementById('addCommissionRow');
  const syncAttendance = ()=>{ if(!payTypeSelect || !commissionWrap) return; const show = payTypeSelect.value === 'commission'; commissionWrap.classList.toggle('hidden', !show); if(show && commissionRows && !commissionRows.children.length) commissionRows.insertAdjacentHTML('beforeend', commissionRow(0)); };
  if(payTypeSelect){ payTypeSelect.onchange = syncAttendance; syncAttendance(); }
  if(addCommissionRowBtn && commissionRows) addCommissionRowBtn.onclick = ()=> commissionRows.insertAdjacentHTML('beforeend', commissionRow(commissionRows.children.length));
  const clockInForm = document.getElementById('clockInForm');
  if(clockInForm){
    clockInForm.onsubmit = async (e)=>{
      e.preventDefault();
      try{
        const pos = await getCurrentPos();
        const address = await reverseGeocode(pos.lat,pos.lng);
        const fd = new FormData(clockInForm);
        const commissionTrips = [...document.querySelectorAll('.commission-row')].map(row => ({
          firstName: row.querySelector('[name="firstName"]').value,
          lastName: row.querySelector('[name="lastName"]').value,
          pickupLocation: row.querySelector('[name="pickupLocation"]').value,
          date: row.querySelector('[name="date"]').value,
          time: row.querySelector('[name="time"]').value,
        }));
        await apiJson('/api/attendance/clock','POST',{ type:'clock_in', ...pos, address, payType: fd.get('payType'), commissionTrips });
        startAutoGps();
        await loadAll(); render();
      }catch(err){ toast('Attendance', err.message); }
    };
  }
  const expenseForm = document.getElementById('expenseForm');
  if(expenseForm){
    const setExpenseFields=()=>{ const cat=document.getElementById('expenseCategory').value; const noteWrap = document.getElementById('expenseNoteWrap'); const otherWrap=document.getElementById('expenseOtherWrap'); if(noteWrap){ noteWrap.style.display = cat==='Maintenance'?'block':'none'; const ta=noteWrap.querySelector('textarea'); if(ta) ta.required = cat==='Maintenance'; } if(otherWrap){ otherWrap.style.display = cat==='Other'?'block':'none'; const inp=otherWrap.querySelector('input'); if(inp) inp.required = cat==='Other'; } };
    document.getElementById('expenseCategory').onchange = setExpenseFields; setExpenseFields();
    expenseForm.onsubmit = async (e)=>{ e.preventDefault(); try{ await apiForm('/api/expenses', new FormData(expenseForm)); await loadExpenses(); await loadDashboardSummary(); render(); toast('Expense saved successfully'); }catch(err){ toast('Expense', err.message); } };
  }
  const inspectionForm = document.getElementById('inspectionForm'); if(inspectionForm) inspectionForm.onsubmit = async e=>{ e.preventDefault(); try{ const fd = new FormData(inspectionForm); [...inspectionForm.images.files].slice(0,6).forEach(f=>fd.append('images',f)); await apiForm('/api/inspections',fd); await loadInspections(); render(); }catch(err){ toast('Inspection', err.message); } };
  const incidentForm = document.getElementById('incidentForm'); if(incidentForm) incidentForm.onsubmit = async e=>{ e.preventDefault(); try{ const fd = new FormData(incidentForm); [...incidentForm.images.files].slice(0,4).forEach(f=>fd.append('images',f)); await apiForm('/api/incidents',fd); await loadIncidents(); render(); }catch(err){ toast('Incident', err.message); } };
  const equipmentForm = document.getElementById('equipmentForm'); if(equipmentForm) equipmentForm.onsubmit = async e=>{ e.preventDefault(); try{ await apiJson('/api/equipment','POST',Object.fromEntries(new FormData(equipmentForm).entries())); await loadEquipment(); render(); }catch(err){ toast('Equipment', err.message); } };
  const chatForm = document.getElementById('chatForm'); if(chatForm) chatForm.onsubmit = async e=>{ e.preventDefault(); const fd = new FormData(chatForm); const text=fd.get('text'); const active = state.selectedChatTarget || 'broadcast'; const body={text}; if(active.startsWith('user:')) body.recipientIds=[active.split(':')[1]]; else if(active.startsWith('channel:')) body.channelId=active.split(':')[1]; try{ await apiJson('/api/messages','POST',body); chatForm.reset(); await loadMessages(); state.unreadMessages = computeUnreadMessages(); render(); }catch(err){ toast('Chat', err.message); } }; const newChannelForm = document.getElementById('newChannelForm'); if(newChannelForm) newChannelForm.onsubmit = async e=>{ e.preventDefault(); const memberIds=[...document.getElementById('channelMembers').selectedOptions].map(o=>o.value); const name=new FormData(newChannelForm).get('name'); try{ await apiJson('/api/chat/channels','POST',{name,memberIds}); await loadChannels(); newChannelForm.reset(); render(); }catch(err){ toast('Channel', err.message); } }; const chatSearch = document.getElementById('chatSearch'); if(chatSearch) chatSearch.oninput = e=>{ state.chatSearch = e.target.value; render(); };
  const pricingForm = document.getElementById('pricingForm'); if(pricingForm) pricingForm.onsubmit = async e=>{ e.preventDefault(); const fd = Object.fromEntries(new FormData(pricingForm).entries()); const payload={ services:{ ambulatory:+fd.ambulatory,wheelchair:+fd.wheelchair,stretcher:+fd.stretcher,climbing_stairs_chair:+fd.climbing_stairs_chair,own_wheelchair:+fd.own_wheelchair }, mileageTiers:[{upTo:10,rate:0},{upTo:39,rate:+fd.tier2},{upTo:99,rate:+fd.tier3},{upTo:9999,rate:+fd.tier4}], bariatricThreshold:+fd.bariatricThreshold, weightSurcharge:+fd.weightSurcharge, oxygen:{base:+fd.oxygenBase, perLiter:+fd.oxygenPerLiter}, extraStop:+fd.extraStop }; try{ await apiJson('/api/price-settings','PUT',payload); await loadPriceSettings(); render(); }catch(err){ toast('Pricing', err.message); } };
  const payerForm = document.getElementById('payerForm'); if(payerForm) payerForm.onsubmit = async e=>{ e.preventDefault(); try{ await apiJson('/api/payers','POST',{name:new FormData(payerForm).get('name')}); await loadPayers(); render(); }catch(err){ toast('Payer', err.message); } };
  const userForm = document.getElementById('userForm'); if(userForm) userForm.onsubmit = async e=>{ e.preventDefault(); try{ const out = await apiJson('/api/users','POST',Object.fromEntries(new FormData(userForm).entries())); await loadUsers(); render(); toast('User created', `Login code ${out.plainLoginCode || ''}`); }catch(err){ toast('User', err.message); } };
  const docDownloadForm = document.getElementById('docDownloadForm'); if(docDownloadForm) docDownloadForm.onsubmit = async e=>{ e.preventDefault(); const date = new FormData(docDownloadForm).get('date'); const res = await fetch(`/api/uploads/daily-download?date=${encodeURIComponent(date)}`, { headers: apiHeaders() }); if(!res.ok){ try{ const err = await res.json(); throw new Error(err.error || 'Download failed'); }catch(err){ toast('Documents', err.message); return; } } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `trinsit-uploads-${date}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); toast('Documents', 'Download started'); };
}

window.editExpense = async id=>{ const e = state.data.expenses.find(x=>x.id===id); if(!e) return; const amount = prompt('Edit amount', e.amount); if(amount==null) return; const expenseDate = prompt('Edit date (YYYY-MM-DD)', e.expenseDate||''); if(expenseDate==null) return; const note = prompt('Edit note', e.note||e.otherText||''); if(note==null) return; try{ await apiJson(`/api/expenses/${id}`,'PUT',{ amount:Number(amount), expenseDate, note }); await loadExpenses(); await loadDashboardSummary(); render(); toast('Expense updated successfully'); }catch(err){ toast('Expense', err.message); } };
window.deleteExpense = async id=>{ if(!confirm('Delete this expense?')) return; try{ await apiJson(`/api/expenses/${id}`,'DELETE'); await loadExpenses(); await loadDashboardSummary(); render(); toast('Expense deleted successfully'); }catch(err){ toast('Expense', err.message); } };
window.toggleCommissionPage = async (id, value)=>{ try{ await apiJson(`/api/users/${id}`,'PUT',{ showCommissionPage: value===true || value==='true' }); await loadUsers(); render(); toast('User setting saved successfully'); }catch(err){ toast('User', err.message); } };
window.deletePayer = async encodedName=>{ try{ await apiJson(`/api/payers/${encodedName}`,'DELETE'); await loadPayers(); render(); }catch(err){ toast('Payer', err.message); } };


async function fetchAddressSuggestions(query){ if(!query || query.length < 3) return []; return apiJson(`/api/geo/suggest?q=${encodeURIComponent(query)}`); }
function bindAddressSuggest(inputId, listId){ const input=document.getElementById(inputId); const list=document.getElementById(listId); if(!input || !list) return; input.addEventListener('input', ()=>{ clearTimeout(state.geoSuggestTimers[inputId]); state.geoSuggestTimers[inputId]=setTimeout(async ()=>{ try{ const results = await fetchAddressSuggestions(input.value); list.innerHTML = (results||[]).map(s=>`<option value="${escapeHtml(s.display_name || '')}"></option>`).join(''); }catch(err){} }, 250); }); }

function markerColorForRole(role){ return ({admin:'#2563eb',manager:'#7c3aed',dispatcher:'#0891b2',driver:'#16a34a',contractor_driver:'#f59e0b'})[role] || '#334155'; }
function markerIconFor(g){
  const isDriver = ['driver','contractor_driver'].includes(g.role);
  const html = `<div class="map-pin ${isDriver?'vehicle':''}" style="background:${markerColorForRole(g.role)}">${isDriver?'🚐':'●'}</div>`;
  return L.divIcon({ className:'custom-map-icon', html, iconSize:[28,28], iconAnchor:[14,14] });
}
function renderMap(refreshOnly){
  const mapEl = document.getElementById('liveMap');
  if(!mapEl) return;
  const points = (state.data.gps||[]).filter(g=>Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng)));
  try {
    if(state.map && !mapEl._leaflet_id){ try{ state.map.remove(); }catch{} state.map = null; state.markers = {}; }
    if(!state.map){
      state.map = L.map('liveMap', { preferCanvas:true, zoomControl:true }).setView([28.5383, -81.3792], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution:'© OpenStreetMap' }).addTo(state.map);
    }
    Object.values(state.markers).forEach(m=>{ try{ state.map.removeLayer(m); }catch{} });
    state.markers = {};
    points.forEach(g=>{
      state.markers[g.userId] = L.marker([Number(g.lat),Number(g.lng)], { icon: markerIconFor(g) }).addTo(state.map).bindPopup(`<strong>${escapeHtml(g.name)}</strong><br>${escapeHtml(g.role)}<br>${fmtDate(g.updatedAt)}`);
    });
    if(points.length){
      const bounds = L.latLngBounds(points.map(g=>[Number(g.lat),Number(g.lng)]));
      if(!refreshOnly) state.map.fitBounds(bounds.pad(0.25));
    } else if(!refreshOnly) {
      state.map.setView([28.5383,-81.3792],8);
    }
    requestAnimationFrame(()=>{ try{ state.map.invalidateSize(true); }catch{} });
    setTimeout(()=>{ try{ state.map.invalidateSize(true); }catch{} }, 220);
    window.dispatchEvent(new Event('resize'));
  } catch(err){
    mapEl.innerHTML = `<div class="map-empty"><strong>Map is reloading…</strong><div class="muted small">Live locations will appear here when users are clocked in.</div></div>`;
    state.map = null;
  }
}


window.showTrip = function(id){
  const trip = state.data.trips.find(t=>t.id===id); if(!trip) return;
  const users = state.data.users;
  const driverOpts = users.filter(u=>['driver','contractor_driver'].includes(u.role) && u.accountStatus==='active').map(u=>`<option value="${u.id}" ${(trip.assignedDriverIds||[]).includes(u.id)?'selected':''}>${escapeHtml(u.name)}</option>`).join('');
  const modal = document.getElementById('tripModal');
  modal.className='modal';
  modal.innerHTML = `<div class="modal-card"><div class="modal-head"><h3>${escapeHtml(trip.tripNumber||trip.id)}</h3><button onclick="closeTripModal()">✕</button></div>
    <div class="grid trip-grid compact">
      <div><strong>Patient</strong><div>${escapeHtml(trip.patientName)}</div></div>
      <div><strong>Status</strong><div>${escapeHtml(trip.status)}</div></div>
      <div><strong>Date</strong><div>${escapeHtml(trip.pickupDate)} ${escapeHtml(trip.pickupTime||'')}</div></div>
      <div><strong>Pickup</strong><div><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.pickupLocation||'')}">${escapeHtml(trip.pickupLocation)}</a></div></div>
      <div><strong>Dropoff</strong><div><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.dropoffLocation||'')}">${escapeHtml(trip.dropoffLocation)}</a></div></div>
      <div><strong>Service</strong><div>${escapeHtml(trip.service)}</div></div>
      ${roleIs('admin','manager','dispatcher')?`<div><strong>Payer</strong><div>${escapeHtml(trip.payer||'')}</div></div><div><strong>Mileage</strong><div>${Number(trip.googleMileage||trip.mileage||0).toFixed(1)} mi</div></div><div><strong>Gross</strong><div>${money(trip.priceBreakdown?.total||0)}</div></div><div><strong>DOB</strong><div>${escapeHtml(trip.dateOfBirth||'')}</div></div><div><strong>MRN</strong><div>${escapeHtml(trip.mrn||'')}</div></div>`:''}
      <div class="full"><strong>Trip Log</strong><div class="listish trip-log-colored">${(trip.tripLogs||[]).map(l=>`<div class="trip-log-row status-${escapeHtml(String(l.status||'').replace(/_/g,'-'))}">${escapeHtml(String(l.status).replace(/_/g,' '))} • ${escapeHtml(l.by||'')} • ${fmtDate(l.at)}</div>`).join('')}</div></div>
      ${roleIs('driver','contractor_driver')?`<div class="full trip-progress-wrap">${tripStatusActions(trip)}</div>`:''}
      ${roleIs('admin','manager','dispatcher')?`<form id="tripEditForm" class="full grid trip-grid compact"><label>Pickup Date<input type="date" name="pickupDate" value="${trip.pickupDate||''}"></label><label>Pickup Time<input type="time" name="pickupTime" value="${trip.pickupTime||''}"></label><label>Patient Name<input name="patientName" value="${escapeHtml(trip.patientName)}"></label><label class="full">Pickup Address<input name="pickupLocation" value="${escapeHtml(trip.pickupLocation||'')}"></label><label class="full">Dropoff Address<input name="dropoffLocation" value="${escapeHtml(trip.dropoffLocation||'')}"></label><label>Google Mileage<input name="googleMileage" type="number" step="0.1" value="${escapeHtml(trip.googleMileage||trip.mileage||0)}"></label><label>Status<select name="status">${['open','assigned','trip_in_progress','arrived_pickup','leaving_with_patient','completed','cancelled'].map(s=>`<option value="${s}" ${trip.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Driver 1<select name="driver1"><option value="">None</option>${driverOpts}</select></label><label>Driver 2<select name="driver2"><option value="">None</option>${driverOpts}</select></label><label class="full">Note<textarea name="note">${escapeHtml(trip.note||'')}</textarea></label><div class="full actions"><button>Save</button><button type="button" class="danger" onclick="cancelTrip('${trip.id}')">Cancel Trip</button></div></form>`:''}
    </div></div>`;
  const form = document.getElementById('tripEditForm');
  if(form) form.onsubmit = async (e)=>{ e.preventDefault(); const fd=Object.fromEntries(new FormData(form).entries()); fd.assignedDriverIds=[fd.driver1,fd.driver2].filter(Boolean); delete fd.driver1; delete fd.driver2; try{ await apiJson(`/api/trips/${trip.id}`,'PUT',fd); await loadTrips(); closeTripModal(); render(); }catch(err){ toast('Trip', err.message); } };
const featureForm = document.getElementById('featureSettingsForm');
if(featureForm) featureForm.onsubmit = async (e)=>{ e.preventDefault(); const fd = Object.fromEntries(new FormData(featureForm).entries()); fd.notificationsEnabled = fd.notificationsEnabled === 'true'; fd.commissionEnabled = fd.commissionEnabled === 'true'; fd.mapEnabled = fd.mapEnabled === 'true'; try{ await apiJson('/api/feature-settings','PUT',fd); await loadFeatureSettings(); render(); toast('Control panel saved'); }catch(err){ toast('Controls', err.message); } };
};
window.closeTripModal = ()=>{ const m=document.getElementById('tripModal'); if(m){ m.className='modal hidden'; m.innerHTML=''; } };
window.cancelTrip = async id=>{ try{ await apiJson(`/api/trips/${id}`,'PUT',{status:'cancelled',cancelled:true}); await loadTrips(); closeTripModal(); render(); }catch(err){ toast('Cancel', err.message); } };
window.advanceTrip = async (id,status)=>{ try{ await apiJson(`/api/trips/${id}`,'PUT',{status}); await loadTrips(); showTrip(id); render(); }catch(err){ toast('Trip', err.message); } };
window.uploadFacesheet = async (id,file)=>{ if(!file) return; const fd = new FormData(); fd.append('file',file); try{ await apiForm(`/api/trips/${id}/facesheet`, fd); await loadTrips(); showTrip(id); }catch(err){ toast('Facesheet', err.message); } };
window.setStatus = async (id,status)=>{ try{ await apiJson(`/api/users/${id}`,'PUT',{accountStatus:status}); await loadUsers(); render(); }catch(err){ toast('User', err.message); } };
window.resetPin = async id=>{ const pin = prompt('Enter new login code (6 digits + symbol)', '123456!'); if(!pin) return; try{ await apiJson(`/api/users/${id}`,'PUT',{resetLoginCode:pin}); await loadUsers(); toast('Login code reset'); }catch(err){ toast('PIN', err.message); } };
window.editAttendance = async id=>{ const record = state.data.attendance.find(a=>a.id===id); if(!record) return; const createdAt = prompt('Edit time (YYYY-MM-DDTHH:MM)', (record.createdAt||'').slice(0,16)); if(createdAt==null) return; const address = prompt('Edit address', record.address||''); if(address==null) return; const type = prompt('Edit type (clock_in, lunch_out, lunch_in, clock_out)', record.type||''); if(type==null) return; try{ await apiJson(`/api/attendance/${id}`,'PUT',{createdAt:new Date(createdAt).toISOString(), address, type}); await loadAttendance(); render(); toast('Attendance updated'); }catch(err){ toast('Attendance', err.message); } };

window.deleteAttendance = async id=>{ if(!confirm('Delete this attendance record?')) return; try{ await apiJson(`/api/attendance/${id}`,'DELETE'); await loadAttendance(); render(); toast('Attendance deleted'); }catch(err){ toast('Attendance', err.message); } };
window.changeUserRole = async (id, role)=>{ try{ await apiJson(`/api/users/${id}`,'PUT',{ role }); await loadUsers(); render(); toast('User role updated'); }catch(err){ toast('User', err.message); } };
window.deleteUser = async id=>{ if(!confirm('Permanently delete this user account? History records will remain.')) return; try{ await apiJson(`/api/users/${id}`,'DELETE'); await loadUsers(); render(); toast('User deleted permanently'); }catch(err){ toast('User', err.message); } };


render(); if(state.token) bootstrap();

function removeCommissionRow(btn){ btn.closest('.commission-row')?.remove(); }
