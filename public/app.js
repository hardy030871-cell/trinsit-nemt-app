const state = {
  token: localStorage.getItem('trinsit_token') || '',
  user: JSON.parse(localStorage.getItem('trinsit_user') || 'null'),
  route: 'dashboard',
  socket: null,
  map: null,
  markers: {},
  autoGpsWatchId: null,
  data: { trips: [], users: [], payers: [], attendance: [], expenses: [], inspections: [], incidents: [], equipment: [], notifications: [], messages: [], gps: [], chatUsers: [], priceSettings: {}, dashboardSummary: null },
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
  if(type==='clock_in'){
    state.route='attendance';
    render();
    toast('Attendance','Use the Attendance page to choose Hourly, Per Trip, or Commission before clock in.');
    return;
  }
  try{
    const pos = await getCurrentPos();
    const address = await reverseGeocode(pos.lat,pos.lng);
    const payload = { type, ...pos, address };
    await apiJson('/api/attendance/clock','POST',payload);
    if(type==='lunch_in') startAutoGps();
    if(type==='clock_out') stopAutoGps();
    await loadAll();
    render();
  }catch(e){ toast('Attendance', e.message); }
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
  state.socket.on('notification', n=>{ state.data.notifications.unshift(n); renderNotificationsBadge(); });
  state.socket.on('message:new', m=>{ state.data.messages.unshift(m); if(state.route==='chat') render(); });
  state.socket.on('trip:updated', ()=>loadTrips().then(()=>{ if(state.route==='trips'||state.route==='dashboard') render(); }));
  state.socket.on('gps:update', g=>{ const idx = state.data.gps.findIndex(x=>x.userId===g.userId); if(idx>=0) state.data.gps[idx]=g; else state.data.gps.push(g); if(state.route==='map') renderMap(true); });
  state.socket.on('gps:clear', g=>{ state.data.gps = state.data.gps.filter(x=>x.userId!==g.userId); if(state.route==='map') renderMap(true); });
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
async function loadGps(){ if(roleIs('admin','manager','dispatcher')) state.data.gps = await apiJson('/api/gps'); else state.data.gps=[]; }
async function loadPriceSettings(){ state.data.priceSettings = await apiJson('/api/price-settings'); }
async function loadDashboardSummary(){ if(roleIs('admin')) state.data.dashboardSummary = await apiJson('/api/dashboard/summary'); else state.data.dashboardSummary = null; }
async function loadAll(){ await Promise.all([loadTrips(),loadUsers(),loadPayers(),loadAttendance(),loadExpenses(),loadInspections(),loadIncidents(),loadEquipment(),loadMessages(),loadChatUsers(),loadGps(),loadPriceSettings(),loadDashboardSummary()]); }

function render(){
  if(!state.user) return renderLogin();
  if(state.user.mustCompleteProfile) return renderFirstLoginProfile();
  const nav = [ ['dashboard','Dashboard'], ['trips','Trips'], ['attendance','Attendance'], ['map','Live Map'], ['expenses','Expenses'], ['inspection','Vehicle Inspection'], ['incidents','Incident Report'], ['chat','Team Chat'] ];
  if(roleIs('admin','manager')) nav.push(['pricing','Pricing']);
  if(roleIs('admin')) nav.push(['users','Users']);
  if(roleIs('admin','manager','dispatcher')) nav.splice(5,0,['equipment','Equipment']);
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><img src="/logo.png" alt="TRINSIT"/><div><strong>TRINSIT</strong><div class="muted small">Operations</div></div></div>
      <div class="userbox"><strong>${escapeHtml(state.user.name)}</strong><div class="muted small">${escapeHtml(state.user.role)} access</div></div>
      <nav>${nav.map(([key,label])=>`<button class="navbtn ${state.route===key?'active':''}" onclick="goRoute('${key}')">${label}</button>`).join('')}</nav>
      <div class="clock-actions">
        <button onclick="quickClock('clock_in')">Clock In</button>
        <button class="secondary" onclick="quickClock('lunch_out')">Lunch Out</button>
        <button class="secondary" onclick="quickClock('lunch_in')">Lunch In</button>
        <button class="danger" onclick="quickClock('clock_out')">Clock Out</button>
        <button class="ghost" onclick="logout()">Logout</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar"><h2>${pageTitle()}</h2><div class="badge" id="notifBadge">${state.data.notifications.filter(x=>!x.read).length} alerts</div></header>
      ${routeView()}
    </main>
  </div>`;
  bindPage();
  if(state.route==='map') setTimeout(()=>renderMap(false), 30);
}
function renderNotificationsBadge(){ const el=document.getElementById('notifBadge'); if(el) el.textContent = `${state.data.notifications.filter(x=>!x.read).length} alerts`; }
function pageTitle(){ return {dashboard:'Admin Dashboard', trips:'Trips', attendance:'Attendance', map:'Live Map', expenses:'Expenses', inspection:'Vehicle Inspection', incidents:'Incident Report', equipment:'Equipment', chat:'Team Chat', pricing:'Pricing Admin', users:'User Admin'}[state.route] || 'TRINSIT'; }
function goRoute(route){ state.route = route; render(); }
window.goRoute = goRoute; window.logout = logout; window.quickClock = quickClock;

function renderLogin(){
  app.innerHTML = `<div class="login-wrap premium"><div class="login-card premium-card"><img class="login-logo" src="/logo.png" alt="TRINSIT"/><div class="eyebrow">TRINSIT Secure Access</div><h1>Enter your passcode</h1><p class="muted">Use your 6 digits plus special symbol.</p><form id="loginForm" class="grid"><label>Passcode<input name="passcode" type="password" inputmode="text" placeholder="••••••!" required></label><button>Unlock App</button></form><div class="small muted center">No email or password required.</div></div></div>`;
  document.getElementById('loginForm').onsubmit = async (e)=>{
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try{ const out = await apiJson('/api/auth/login','POST',body); saveAuth(out.token,out.user); await bootstrap(); }catch(err){ toast('Login', err.message); }
  };
}
function renderFirstLoginProfile(){
  app.innerHTML = `<div class="login-wrap"><div class="login-card wide"><h2>Complete your profile</h2><form id="profileForm" class="grid"><label>Phone Number<input name="phone" required></label><label>Date of Birth<input type="date" name="dateOfBirth" required></label><label>Certificate (if any)<input name="certificate"></label><label>Address<textarea name="address" required></textarea></label><label>Upload Driver License or ID Card<input type="file" name="identityFile" accept="image/*,.pdf" capture="environment" required></label><button>Save Profile</button></form></div></div>`;
  document.getElementById('profileForm').onsubmit = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    try{ const user = await apiForm('/api/me/complete-profile', fd); localStorage.setItem('trinsit_user', JSON.stringify(user)); state.user = user; await loadAll(); render(); }catch(err){ toast('Profile', err.message); }
  };
}

function routeView(){
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
    case 'pricing': return pricingView();
    case 'users': return usersView();
    default: return dashboardView();
  }
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
  return `<div class="table-wrap"><table><thead><tr><th>Trip ID</th><th>Date</th><th>Patient</th><th>Pickup</th><th>Dropoff</th><th>Service</th><th>Drivers</th><th>Status</th>${roleIs('admin','manager','dispatcher')?'<th>Payer</th><th>Mileage</th><th>Gross</th>':''}<th>Actions</th></tr></thead><tbody>${trips.map(t=>{
    const drivers = (t.assignedDriverIds||[]).map(id=>state.data.users.find(u=>u.id===id)?.name||'Unknown').join(', ');
    return `<tr><td>${escapeHtml(t.tripNumber||t.id)}</td><td>${escapeHtml(t.pickupDate)} ${escapeHtml(t.pickupTime||'')}</td><td>${escapeHtml(t.patientName)}</td><td>${escapeHtml(t.pickupLocation)}</td><td>${escapeHtml(t.dropoffLocation)}</td><td>${escapeHtml(t.service)}</td><td>${escapeHtml(drivers)}</td><td>${escapeHtml(String(t.status).replace(/_/g,' '))}</td>${roleIs('admin','manager','dispatcher')?`<td>${escapeHtml(t.payer||'')}</td><td>${Number(t.googleMileage||t.mileage||0).toFixed(1)}</td><td>${money(t.priceBreakdown?.total||0)}</td>`:''}<td><button class="smallbtn" onclick="showTrip('${t.id}')">Open</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function tripStatusActions(trip){
  if(!roleIs('driver','contractor_driver')) return '';
  const hasFacesheet = (trip.facesheetFiles||[]).length > 0;
  const btn = (status,label,disabled=false,kind='') => `<button class="${kind}" ${disabled?'disabled':''} onclick="advanceTrip('${trip.id}','${status}')">${label}</button>`;
  if(trip.status === 'assigned') return btn('trip_in_progress','Trip In Progress');
  if(trip.status === 'trip_in_progress') return btn('arrived_pickup','Arrived for Pick Up');
  if(trip.status === 'arrived_pickup' || trip.status === 'arrived') {
    return `<label class="upload-inline">Upload Facesheet<input type="file" accept="image/*,.pdf" onchange="uploadFacesheet('${trip.id}', this.files[0])"></label>${btn('leaving_with_patient','Leaving With Patient',!hasFacesheet)}`;
  }
  if(trip.status === 'leaving_with_patient') return btn('completed','Complete Trip','');
  return '';
}
function tripsView(){
  const payerOptions = state.data.payers.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  const driverOpts = state.data.users.filter(u=>['driver','contractor_driver'].includes(u.role) && u.accountStatus==='active').map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
  return `<div class="split responsive-top">
    ${roleIs('admin','manager','dispatcher')?`<section class="panel"><h3>Create New Trip</h3><form id="tripForm" class="grid trip-grid">
      <label>Pick Up Date<input type="date" name="pickupDate" required></label>
      <label>Pick Up Time<input type="time" name="pickupTime" required></label>
      <label>Patient Name<input name="patientName" required></label>
      <label>Pick Up Location<input name="pickupLocation" required></label>
      <label>Room Number<input name="roomNumber"></label>
      <label>Service<select name="service" required><option>Wheelchair</option><option>Stretcher</option><option>Climbing Stairs Chair</option><option>Own Wheelchair</option><option>Ambulatory</option></select></label>
      <label>Weight<input type="number" name="weight" required></label>
      <label>Drop Off Location<input name="dropoffLocation" required></label>
      <label>Google Mileage<input type="number" step="0.1" name="googleMileage" required></label>
      <label>Vehicle Unit<input name="vehicleUnit"></label>
      <label>Payer<select name="payer" required>${payerOptions}</select></label>
      <label>Date of Birth<input type="date" name="dateOfBirth" required></label>
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
  const rows = visibleAttendance.map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.type)}</td><td>${fmtDate(a.createdAt)}</td><td>${escapeHtml(a.address||'')}</td><td>${escapeHtml(a.payType || (a.commissionPay ? 'commission' : 'hourly'))}</td><td>${(a.commissionTrips||[]).map(t=>`${escapeHtml(t.firstName||'')} ${escapeHtml(t.lastName||'')} / ${escapeHtml(t.pickupLocation||'')} / ${escapeHtml(t.date||'')} ${escapeHtml(t.time||'')}`).join('<br>')}</td>${roleIs('admin')?`<td><button class="smallbtn" onclick="editAttendance('${a.id}')">Edit</button></td>`:''}</tr>`).join('');
  return `<div class="split responsive-top"><section class="panel"><h3>${clockedIn ? 'You are clocked in' : 'Clock In'}</h3><div class="muted small">Clock in turns on live GPS sharing until clock out. Dispatch sees your live location on the map automatically.</div>${clockedIn ? `<div class="item"><strong>Status:</strong> ${escapeHtml(latestSelf.type)}<div class="small muted">${escapeHtml(latestSelf.address||'')}</div><div class="actions compact-actions"><button class="secondary" onclick="quickClock('lunch_out')">Lunch Out</button><button class="secondary" onclick="quickClock('lunch_in')">Lunch In</button><button class="danger" onclick="quickClock('clock_out')">Clock Out</button></div></div>` : `<form id="clockInForm" class="grid trip-grid compact"><label>Pay Type<select name="payType" id="payTypeSelect"><option value="hourly">Hourly</option><option value="per_trip">Per Trip</option><option value="commission">Commission</option></select></label><div id="commissionWrap" class="full hidden"><div class="sectionhead"><strong>Commission Entries</strong><button type="button" class="smallbtn" id="addCommissionRow">Add Entry</button></div><div id="commissionRows"></div></div><div class="full actions"><button>Clock In Now</button></div></form>`}</section><section class="panel"><h3>Attendance Log</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Type</th><th>Time</th><th>Address</th><th>Pay Type</th><th>Commission Entries</th>${roleIs('admin')?'<th>Edit</th>':''}</tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No attendance yet.</td></tr>'}</tbody></table></div></section></div>`;
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
  <section class="panel"><h3>Expense Log</h3>${state.data.expenses.map(e=>`<div class="item"><strong>${escapeHtml(e.category)}</strong><div>${money(e.amount)} • ${escapeHtml(e.userName||'')}</div><div class="small muted">${escapeHtml(e.expenseDate||'')}</div><div class="small">${escapeHtml(e.note||e.otherText||'')}</div></div>`).join('') || '<div class="muted">No expenses.</div>'}</section></div>`;
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
function equipmentView(){ return `<div class="split responsive-top"><section class="panel"><h3>Equipment Inventory</h3>${roleIs('admin')?`<form id="equipmentForm" class="grid"><label>Name<input name="name" required></label><label>Qty<input type="number" name="qty" required></label><label>Notes<textarea name="notes"></textarea></label><button>Save</button></form>`:''}</section><section class="panel">${state.data.equipment.map(i=>`<div class="item"><strong>${escapeHtml(i.name)}</strong><div>${escapeHtml(i.qty)} units</div><div class="small muted">${escapeHtml(i.notes||'')}</div></div>`).join('') || '<div class="muted">No equipment.</div>'}</section></div>`; }
function chatView(){
  const options = state.data.chatUsers.filter(u=>u.id!==state.user.id && u.accountStatus==='active').map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
  return `<div class="split responsive-top"><section class="panel"><h3>Send Message</h3><div class="muted small">Clocked-in users are automatically available here for private or group text.</div><form id="chatForm" class="grid"><label>Choose one or multiple users<select name="recipientIds" id="recipientIds" multiple size="7">${options}</select></label><label>Message<textarea name="text" required></textarea></label><button>Send</button></form></section><section class="panel"><h3>Conversation</h3><div class="chat-feed">${state.data.messages.slice().reverse().map(m=>`<div class="chatmsg"><strong>${escapeHtml(m.userName)}</strong><div>${escapeHtml(m.text)}</div><div class="small muted">${fmtDate(m.createdAt)} ${m.recipientIds?.length?`• to ${m.recipientIds.map(id=>state.data.users.find(u=>u.id===id)?.name || state.data.chatUsers.find(u=>u.id===id)?.name || '').join(', ')}`:'• broadcast'}</div></div>`).join('')}</div></section></div>`;
}
function pricingView(){ if(!roleIs('admin','manager')) return '<div class=\"panel\">Admin or manager only.</div>'; const s=state.data.priceSettings; return `<div class=\"split responsive-top\"><section class=\"panel premium-panel\"><h3>Pricing</h3><form id=\"pricingForm\" class=\"grid trip-grid\"><label>Ambulatory<input name=\"ambulatory\" type=\"number\" value=\"${s.services?.ambulatory||0}\"></label><label>Wheelchair<input name=\"wheelchair\" type=\"number\" value=\"${s.services?.wheelchair||0}\"></label><label>Stretcher<input name=\"stretcher\" type=\"number\" value=\"${s.services?.stretcher||0}\"></label><label>Stair Chair<input name=\"climbing_stairs_chair\" type=\"number\" value=\"${s.services?.climbing_stairs_chair||0}\"></label><label>Own Wheelchair<input name=\"own_wheelchair\" type=\"number\" value=\"${s.services?.own_wheelchair||0}\"></label><label>Weight Threshold<input name=\"bariatricThreshold\" type=\"number\" value=\"${s.bariatricThreshold||250}\"></label><label>Weight Surcharge<input name=\"weightSurcharge\" type=\"number\" value=\"${s.weightSurcharge||0}\"></label><label>Oxygen Base<input name=\"oxygenBase\" type=\"number\" value=\"${s.oxygen?.base||0}\"></label><label>Oxygen Per Liter<input name=\"oxygenPerLiter\" type=\"number\" value=\"${s.oxygen?.perLiter||0}\"></label><label>Extra Stop<input name=\"extraStop\" type=\"number\" value=\"${s.extraStop||0}\"></label><label>11-39 Mile Rate<input name=\"tier2\" type=\"number\" value=\"${s.mileageTiers?.[1]?.rate||0}\"></label><label>40-99 Mile Rate<input name=\"tier3\" type=\"number\" value=\"${s.mileageTiers?.[2]?.rate||0}\"></label><label>100+ Mile Rate<input name=\"tier4\" type=\"number\" value=\"${s.mileageTiers?.[3]?.rate||0}\"></label><button>Save Pricing</button></form></section><section class=\"panel premium-panel\"><h3>Payers</h3><form id=\"payerForm\" class=\"inline-form\"><input name=\"name\" placeholder=\"Add new payer\"><button>Add</button></form><div class=\"stack-list\">${state.data.payers.map(p=>`<div class=\"item rowline\"><span>${escapeHtml(p)}</span><button class=\"smallbtn danger\" onclick=\"deletePayer('${encodeURIComponent(p)}')\">Delete</button></div>`).join('')}</div></section></div>`; }
function usersView(){ if(!roleIs('admin')) return '<div class=\"panel\">Admin only.</div>'; return `<div class=\"split responsive-top\"><section class=\"panel premium-panel\"><h3>Create User</h3><form id=\"userForm\" class=\"grid\"><label>Name<input name=\"name\" required></label><label>Email (optional)<input name=\"email\" type=\"email\"></label><label>Login Code<input name=\"loginCode\" required placeholder=\"123456!\"></label><label>Role<select name=\"role\"><option>manager</option><option>dispatcher</option><option>driver</option><option>contractor_driver</option><option>admin</option></select></label><button>Create User</button></form></section><section class=\"panel premium-panel\"><h3>Manage Users</h3>${state.data.users.map(u=>`<div class=\"item\"><strong>${escapeHtml(u.name)}</strong><div class=\"small muted\">${escapeHtml(u.role)} • ${escapeHtml(u.accountStatus||'active')}</div><div class=\"actions wrap\"><button class=\"smallbtn\" onclick=\"resetPin('${u.id}')\">Reset Login Code</button><button class=\"smallbtn\" onclick=\"setStatus('${u.id}','active')\">Activate</button><button class=\"smallbtn\" onclick=\"setStatus('${u.id}','suspended')\">Suspend</button><button class=\"smallbtn\" onclick=\"setStatus('${u.id}','closed')\">Close</button><button class=\"smallbtn danger\" onclick=\"setStatus('${u.id}','deleted')\">Delete</button></div></div>`).join('')}</section></div>`; }


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
      try{ await apiJson('/api/trips','POST',obj); await loadTrips(); await loadDashboardSummary(); render(); toast('Trip created'); }catch(err){ toast('Trip', err.message); }
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
    expenseForm.onsubmit = async (e)=>{ e.preventDefault(); try{ await apiForm('/api/expenses', new FormData(expenseForm)); await loadExpenses(); await loadDashboardSummary(); render(); }catch(err){ toast('Expense', err.message); } };
  }
  const inspectionForm = document.getElementById('inspectionForm'); if(inspectionForm) inspectionForm.onsubmit = async e=>{ e.preventDefault(); try{ const fd = new FormData(inspectionForm); [...inspectionForm.images.files].slice(0,6).forEach(f=>fd.append('images',f)); await apiForm('/api/inspections',fd); await loadInspections(); render(); }catch(err){ toast('Inspection', err.message); } };
  const incidentForm = document.getElementById('incidentForm'); if(incidentForm) incidentForm.onsubmit = async e=>{ e.preventDefault(); try{ const fd = new FormData(incidentForm); [...incidentForm.images.files].slice(0,4).forEach(f=>fd.append('images',f)); await apiForm('/api/incidents',fd); await loadIncidents(); render(); }catch(err){ toast('Incident', err.message); } };
  const equipmentForm = document.getElementById('equipmentForm'); if(equipmentForm) equipmentForm.onsubmit = async e=>{ e.preventDefault(); try{ await apiJson('/api/equipment','POST',Object.fromEntries(new FormData(equipmentForm).entries())); await loadEquipment(); render(); }catch(err){ toast('Equipment', err.message); } };
  const chatForm = document.getElementById('chatForm'); if(chatForm) chatForm.onsubmit = async e=>{ e.preventDefault(); const fd = new FormData(chatForm); const text=fd.get('text'); const recipientIds=[...document.getElementById('recipientIds').selectedOptions].map(o=>o.value); try{ await apiJson('/api/messages','POST',{text,recipientIds}); await loadMessages(); render(); }catch(err){ toast('Chat', err.message); } };
  const pricingForm = document.getElementById('pricingForm'); if(pricingForm) pricingForm.onsubmit = async e=>{ e.preventDefault(); const fd = Object.fromEntries(new FormData(pricingForm).entries()); const payload={ services:{ ambulatory:+fd.ambulatory,wheelchair:+fd.wheelchair,stretcher:+fd.stretcher,climbing_stairs_chair:+fd.climbing_stairs_chair,own_wheelchair:+fd.own_wheelchair }, mileageTiers:[{upTo:10,rate:0},{upTo:39,rate:+fd.tier2},{upTo:99,rate:+fd.tier3},{upTo:9999,rate:+fd.tier4}], bariatricThreshold:+fd.bariatricThreshold, weightSurcharge:+fd.weightSurcharge, oxygen:{base:+fd.oxygenBase, perLiter:+fd.oxygenPerLiter}, extraStop:+fd.extraStop }; try{ await apiJson('/api/price-settings','PUT',payload); await loadPriceSettings(); render(); }catch(err){ toast('Pricing', err.message); } };
  const payerForm = document.getElementById('payerForm'); if(payerForm) payerForm.onsubmit = async e=>{ e.preventDefault(); try{ await apiJson('/api/payers','POST',{name:new FormData(payerForm).get('name')}); await loadPayers(); render(); }catch(err){ toast('Payer', err.message); } };
  const userForm = document.getElementById('userForm'); if(userForm) userForm.onsubmit = async e=>{ e.preventDefault(); try{ const out = await apiJson('/api/users','POST',Object.fromEntries(new FormData(userForm).entries())); await loadUsers(); render(); toast('User created', `Login code ${out.plainLoginCode || ''}`); }catch(err){ toast('User', err.message); } };
  const docDownloadForm = document.getElementById('docDownloadForm'); if(docDownloadForm) docDownloadForm.onsubmit = async e=>{ e.preventDefault(); const date = new FormData(docDownloadForm).get('date'); const res = await fetch(`/api/uploads/daily-download?date=${encodeURIComponent(date)}`, { headers: apiHeaders() }); if(!res.ok){ try{ const err = await res.json(); throw new Error(err.error || 'Download failed'); }catch(err){ toast('Documents', err.message); return; } } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `trinsit-uploads-${date}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); toast('Documents', 'Download started'); };
}
window.deletePayer = async encodedName=>{ try{ await apiJson(`/api/payers/${encodedName}`,'DELETE'); await loadPayers(); render(); }catch(err){ toast('Payer', err.message); } };

function markerColorForRole(role){ return ({admin:'#2563eb',manager:'#7c3aed',dispatcher:'#0891b2',driver:'#16a34a',contractor_driver:'#f59e0b'})[role] || '#334155'; }
function markerIconFor(g){
  const isDriver = ['driver','contractor_driver'].includes(g.role);
  const html = `<div class="map-pin ${isDriver?'vehicle':''}" style="background:${markerColorForRole(g.role)}">${isDriver?'🚐':'●'}</div>`;
  return L.divIcon({ className:'custom-map-icon', html, iconSize:[28,28], iconAnchor:[14,14] });
}
function renderMap(refreshOnly){
  if(!document.getElementById('liveMap')) return;
  if(!state.map){
    state.map = L.map('liveMap').setView([28.5383, -81.3792], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
  }
  Object.values(state.markers).forEach(m=>state.map.removeLayer(m));
  state.markers = {};
  state.data.gps.forEach(g=>{
    state.markers[g.userId] = L.marker([g.lat,g.lng], { icon: markerIconFor(g) }).addTo(state.map).bindPopup(`<strong>${escapeHtml(g.name)}</strong><br>${escapeHtml(g.role)}<br>${fmtDate(g.updatedAt)}`);
  });
  if(!refreshOnly && state.data.gps[0]) state.map.setView([state.data.gps[0].lat, state.data.gps[0].lng], 11);
  setTimeout(()=>state.map.invalidateSize(),50);
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
      <div><strong>Pickup</strong><div>${escapeHtml(trip.pickupLocation)}</div></div>
      <div><strong>Dropoff</strong><div>${escapeHtml(trip.dropoffLocation)}</div></div>
      <div><strong>Service</strong><div>${escapeHtml(trip.service)}</div></div>
      ${roleIs('admin','manager','dispatcher')?`<div><strong>Payer</strong><div>${escapeHtml(trip.payer||'')}</div></div><div><strong>Mileage</strong><div>${Number(trip.googleMileage||trip.mileage||0).toFixed(1)} mi</div></div><div><strong>Gross</strong><div>${money(trip.priceBreakdown?.total||0)}</div></div><div><strong>DOB</strong><div>${escapeHtml(trip.dateOfBirth||'')}</div></div><div><strong>MRN</strong><div>${escapeHtml(trip.mrn||'')}</div></div>`:''}
      <div class="full"><strong>Trip Log</strong><div class="listish">${(trip.tripLogs||[]).map(l=>`<div>${escapeHtml(l.status)} • ${escapeHtml(l.by||'')} • ${fmtDate(l.at)}</div>`).join('')}</div></div>
      ${roleIs('driver','contractor_driver')?`<div class="full actions trip-flow">${tripStatusActions(trip)}</div>`:''}
      ${roleIs('admin','manager','dispatcher')?`<form id="tripEditForm" class="full grid trip-grid compact"><label>Pickup Date<input type="date" name="pickupDate" value="${trip.pickupDate||''}"></label><label>Pickup Time<input type="time" name="pickupTime" value="${trip.pickupTime||''}"></label><label>Patient Name<input name="patientName" value="${escapeHtml(trip.patientName)}"></label><label>Status<select name="status">${['open','assigned','trip_in_progress','arrived_pickup','leaving_with_patient','completed','cancelled'].map(s=>`<option value="${s}" ${trip.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Driver 1<select name="driver1"><option value="">None</option>${driverOpts}</select></label><label>Driver 2<select name="driver2"><option value="">None</option>${driverOpts}</select></label><label class="full">Note<textarea name="note">${escapeHtml(trip.note||'')}</textarea></label><div class="full actions"><button>Save</button><button type="button" class="danger" onclick="cancelTrip('${trip.id}')">Cancel Trip</button></div></form>`:''}
    </div></div>`;
  const form = document.getElementById('tripEditForm');
  if(form) form.onsubmit = async (e)=>{ e.preventDefault(); const fd=Object.fromEntries(new FormData(form).entries()); fd.assignedDriverIds=[fd.driver1,fd.driver2].filter(Boolean); delete fd.driver1; delete fd.driver2; try{ await apiJson(`/api/trips/${trip.id}`,'PUT',fd); await loadTrips(); closeTripModal(); render(); }catch(err){ toast('Trip', err.message); } };
};
window.closeTripModal = ()=>{ const m=document.getElementById('tripModal'); if(m){ m.className='modal hidden'; m.innerHTML=''; } };
window.cancelTrip = async id=>{ try{ await apiJson(`/api/trips/${id}`,'PUT',{status:'cancelled',cancelled:true}); await loadTrips(); closeTripModal(); render(); }catch(err){ toast('Cancel', err.message); } };
window.advanceTrip = async (id,status)=>{ try{ await apiJson(`/api/trips/${id}`,'PUT',{status}); await loadTrips(); showTrip(id); render(); }catch(err){ toast('Trip', err.message); } };
window.uploadFacesheet = async (id,file)=>{ if(!file) return; const fd = new FormData(); fd.append('file',file); try{ await apiForm(`/api/trips/${id}/facesheet`, fd); await loadTrips(); showTrip(id); }catch(err){ toast('Facesheet', err.message); } };
window.setStatus = async (id,status)=>{ try{ await apiJson(`/api/users/${id}`,'PUT',{accountStatus:status}); await loadUsers(); render(); }catch(err){ toast('User', err.message); } };
window.resetPin = async id=>{ const pin = prompt('Enter new login code (6 digits + symbol)', '123456!'); if(!pin) return; try{ await apiJson(`/api/users/${id}`,'PUT',{resetLoginCode:pin}); await loadUsers(); toast('Login code reset'); }catch(err){ toast('PIN', err.message); } };
window.editAttendance = async id=>{ const record = state.data.attendance.find(a=>a.id===id); if(!record) return; const createdAt = prompt('Edit time (YYYY-MM-DDTHH:MM)', (record.createdAt||'').slice(0,16)); if(createdAt==null) return; const address = prompt('Edit address', record.address||''); if(address==null) return; const type = prompt('Edit type (clock_in, lunch_out, lunch_in, clock_out)', record.type||''); if(type==null) return; try{ await apiJson(`/api/attendance/${id}`,'PUT',{createdAt:new Date(createdAt).toISOString(), address, type}); await loadAttendance(); render(); toast('Attendance updated'); }catch(err){ toast('Attendance', err.message); } };

render(); if(state.token) bootstrap();

function removeCommissionRow(btn){ btn.closest('.commission-row')?.remove(); }
