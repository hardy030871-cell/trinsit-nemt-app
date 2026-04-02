const state = {
  token: localStorage.getItem('trinsit_token') || '',
  user: JSON.parse(localStorage.getItem('trinsit_user') || 'null'),
  route: 'dashboard',
  data: { trips: [], users: [], attendance: [], equipment: [], incidents: [], inspections: [], notifications: [], messages: [], gps: [], priceSettings: null, expenses: [] },
  socket: null,
  map: null
};
const app = document.getElementById('app');
const toastWrap = document.createElement('div');
toastWrap.className = 'toast-wrap';
document.body.appendChild(toastWrap);
const tripSteps = [
  { key: 'received', label: 'Received' },
  { key: 'trip_in_progress', label: 'Trip in Progress' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'facesheet_uploaded', label: 'Facesheet Uploaded' },
  { key: 'leaving_with_patient', label: 'Leaving with Patient' },
  { key: 'drop_off', label: 'Drop Off' },
  { key: 'completed', label: 'Complete' }
];

function toast(title, body='') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<strong>${title}</strong><div class="small muted" style="margin-top:6px; color:#dbeafe">${body}</div>`;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
async function api(path, options={}) {
  const res = await fetch(path, { ...options, headers: { ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiJson(path, method='GET', body) {
  return api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
async function apiForm(path, formData) { return api(path, { method: 'POST', body: formData }); }

function saveSession(token, user) { state.token = token; state.user = user; localStorage.setItem('trinsit_token', token); localStorage.setItem('trinsit_user', JSON.stringify(user)); }
function logout() { state.token=''; state.user=null; localStorage.removeItem('trinsit_token'); localStorage.removeItem('trinsit_user'); if (state.socket) state.socket.disconnect(); render(); }
function roleIs(...roles) { return roles.includes(state.user?.role); }
function formatMoney(v) { return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(v||0)); }
function shortDate(v) { return v ? new Date(v).toLocaleString() : ''; }
function titleCase(text) { return String(text || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase()); }
function currentDriverLatestAttendance() {
  const mine = state.data.attendance.filter(x => x.userId === state.user?.id);
  return mine[0];
}
function isClockedInLocal() {
  const latest = currentDriverLatestAttendance();
  return latest && ['clock_in','lunch_in'].includes(latest.type);
}

function loginScreen() {
  app.innerHTML = `
  <div class="login-shell">
    <div class="login-card">
      <div class="brand">
        <div class="logo logo-lg"><img src="/logo.png" alt="TRINSIT"/></div>
        <h1>TRINSIT NEMT Operations Center</h1>
        <p>Dispatch, GPS attendance, live driver map, trip workflow, inspections, incidents, expenses, and team chat in one web app.</p>
        <div class="demo-box"><strong>Demo logins</strong><br>admin@trinsit.local / Admin123!<br>manager@trinsit.local / Manager123!<br>dispatcher@trinsit.local / Dispatcher123!<br>driver@trinsit.local / Driver123!<br>contractor@trinsit.local / Contract123!</div>
      </div>
      <div class="auth-box">
        <h2>Sign in</h2>
        <div class="grid">
          <div><label>Email</label><input id="email" value="admin@trinsit.local"></div>
          <div><label>Password</label><input id="password" type="password" value="Admin123!"></div>
          <button id="loginBtn">Login</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('loginBtn').onclick = async () => {
    try {
      const data = await apiJson('/api/auth/login', 'POST', { email: document.getElementById('email').value, password: document.getElementById('password').value });
      saveSession(data.token, data.user); await bootstrap();
    } catch (e) { toast('Login failed', e.message); }
  };
}

async function bootstrap() {
  await Promise.all([loadTrips(), loadUsers(), loadAttendance(), loadEquipment(), loadIncidents(), loadInspections(), loadNotifications(), loadMessages(), loadGps(), loadPriceSettings(), loadExpenses()]);
  connectSocket(); render();
}
function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('notification', payload => { state.data.notifications.unshift(payload); toast(payload.title, payload.body); render(); });
  state.socket.on('chat:message', msg => { state.data.messages.unshift(msg); if (state.route === 'chat') render(); });
  state.socket.on('trip:created', async () => { await loadTrips(); render(); });
  state.socket.on('trip:updated', async () => { await loadTrips(); render(); });
  state.socket.on('gps:update', payload => {
    const idx = state.data.gps.findIndex(x => x.userId === payload.userId); if (idx >= 0) state.data.gps[idx] = payload; else state.data.gps.push(payload);
    if (state.route === 'map') setTimeout(initMap, 20);
  });
}

async function loadTrips(){ state.data.trips = await api('/api/trips'); }
async function loadUsers(){ state.data.users = roleIs('admin','manager','dispatcher') ? await api('/api/users') : []; }
async function loadAttendance(){ state.data.attendance = roleIs('admin','manager','dispatcher') ? await api('/api/attendance') : []; }
async function loadEquipment(){ state.data.equipment = await api('/api/equipment'); }
async function loadIncidents(){ state.data.incidents = await api('/api/incidents'); }
async function loadInspections(){ state.data.inspections = await api('/api/inspections'); }
async function loadNotifications(){ state.data.notifications = await api('/api/notifications'); }
async function loadMessages(){ state.data.messages = await api('/api/messages'); }
async function loadGps(){ state.data.gps = roleIs('admin','manager','dispatcher') ? await api('/api/gps') : []; }
async function loadPriceSettings(){ state.data.priceSettings = await api('/api/price-settings'); }
async function loadExpenses(){ state.data.expenses = await api('/api/expenses'); }

function routeButton(route, label) { return `<button class="${state.route===route?'active':''}" onclick="window.appRoute('${route}')">${label}</button>`; }
window.appRoute = (r) => { state.route = r; render(); if (r==='map') setTimeout(initMap, 80); };
window.logoutApp = logout;
window.requestBrowserNotifications = () => Notification?.requestPermission?.();
window.quickClock = async (type) => {
  try {
    const pos = await getCurrentPos();
    await apiJson('/api/attendance/clock', 'POST', { type, ...pos });
    if (roleIs('admin','manager','dispatcher')) await loadAttendance();
    toast('Attendance saved', titleCase(type));
    render();
  } catch (e) { toast('Attendance error', e.message); }
};

function render() {
  if (!state.user) return loginScreen();
  const nav = [['dashboard','Dashboard'],['trips','Trips'],['attendance','Attendance'],['map','Live Map'],['expenses','Expenses'],['inspection','Vehicle Inspection'],['equipment','Equipment'],['incidents','Incident Reports'],['chat','Team Chat']];
  if (roleIs('admin')) nav.push(['pricing','Pricing Admin'],['users','User Admin']);
  app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="logo"><img src="/logo.png" alt="TRINSIT"/><span>TRINSIT</span></div>
      <div class="muted" style="margin:10px 0 18px">${state.user.name}<br><span class="small">${titleCase(state.user.role)}</span></div>
      <div class="nav">${nav.map(([r,l])=>routeButton(r,l)).join('')}</div>
      <div style="margin-top:20px" class="grid">
        <button class="secondary" onclick="window.quickClock('clock_in')">Clock In</button>
        <button class="secondary" onclick="window.quickClock('lunch_out')">Lunch Out</button>
        <button class="secondary" onclick="window.quickClock('lunch_in')">Lunch In</button>
        <button class="secondary" onclick="window.quickClock('clock_out')">Clock Out</button>
        <button class="ghost" onclick="window.requestBrowserNotifications()">Enable Alerts</button>
        <button class="danger" onclick="window.logoutApp()">Logout</button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div><h2 style="margin:0">${titleForRoute()}</h2><div class="muted">TRINSIT live operations workspace</div></div>
        <div class="actions"><span class="badge">Unread ${state.data.notifications.filter(x=>!x.read).length}</span><span class="badge">Trips ${state.data.trips.length}</span></div>
      </div>
      ${routeContent()}
    </main>
  </div>`;
  bindPageActions();
}
function titleForRoute() {
  return { dashboard:'Dashboard', trips:'Trip Management', attendance:'Attendance & GPS', map:'Live Driver Map', expenses:'Expenses', pricing:'Pricing Admin', equipment:'Equipment Inventory', inspection:'Vehicle Inspection', incidents:'Incident Reports', chat:'Team Chat', users:'User Management' }[state.route] || 'TRINSIT';
}
function routeContent(){ switch(state.route){ case 'dashboard': return dashboardView(); case 'trips': return tripsView(); case 'attendance': return attendanceView(); case 'map': return mapView(); case 'expenses': return expensesView(); case 'pricing': return pricingView(); case 'equipment': return equipmentView(); case 'inspection': return inspectionView(); case 'incidents': return incidentsView(); case 'chat': return chatView(); case 'users': return usersView(); default: return dashboardView(); } }

function dashboardView() {
  return `
  <div class="cards">
    <div class="card"><div class="muted">Assigned Trips</div><div class="metric">${state.data.trips.filter(t=>t.status==='assigned').length}</div></div>
    <div class="card"><div class="muted">Drivers Reporting GPS</div><div class="metric">${state.data.gps.length}</div></div>
    <div class="card"><div class="muted">Open Expenses</div><div class="metric">${state.data.expenses.length}</div></div>
    <div class="card"><div class="muted">Incident Reports</div><div class="metric">${state.data.incidents.length}</div></div>
  </div>
  <div class="two-col" style="margin-top:16px">
    <div class="panel" style="padding:18px"><h3 class="section-title">Recent Trips</h3><div class="list">${state.data.trips.slice(0,6).map(tripCard).join('') || '<div class="muted">No trips yet.</div>'}</div></div>
    <div class="panel" style="padding:18px"><h3 class="section-title">Notifications</h3><div class="list">${state.data.notifications.slice(0,8).map(n=>`<div class="item"><strong>${n.title}</strong><div class="muted small">${n.body}</div><div class="small muted">${shortDate(n.createdAt)}</div></div>`).join('') || '<div class="muted">No alerts yet.</div>'}</div></div>
  </div>`;
}
function tripCard(trip){ return `<div class="item"><div class="flex-between"><h4>${trip.patientName}</h4><span class="badge">${titleCase(trip.status)}</span></div><div class="small muted">${trip.pickupDate} ${trip.pickupTime} • ${trip.service}</div><div class="small">${trip.pickupLocation} → ${trip.dropoffLocation}</div><div class="small muted">Price ${formatMoney(trip.priceBreakdown?.total || 0)}</div></div>`; }
function tripFormFields() {
  const driverOptions = state.data.users.filter(u => ['driver','contractor_driver'].includes(u.role)).map(u => `<option value="${u.id}">${u.name} (${titleCase(u.role)})</option>`).join('');
  return `
  <div class="grid grid-3">
    <div><label>Pick Up Date</label><input name="pickupDate" type="date" required></div>
    <div><label>Pick Up Time</label><input name="pickupTime" type="time" required></div>
    <div><label>Patient Name</label><input name="patientName" required></div>
    <div><label>Pick Up Location</label><input name="pickupLocation" required></div>
    <div><label>Room Number</label><input name="roomNumber"></div>
    <div><label>Service</label><select name="service"><option>Wheelchair</option><option>Stretcher</option><option>Climbing Stairs Chair</option><option>Own Wheelchair</option><option>Ambulatory</option></select></div>
    <div><label>Weight</label><input name="weight" type="number"></div>
    <div><label>Drop Off Location</label><input name="dropoffLocation" required></div>
    <div><label>Mileage</label><input name="mileage" type="number" step="0.1"></div>
    <div><label>Additional Stop #1</label><input name="stop1"></div>
    <div><label>Additional Stop #2</label><input name="stop2"></div>
    <div><label>Oxygen</label><select name="oxygen"><option value="No">No</option><option value="Yes">Yes</option></select></div>
    <div><label>Oxygen Liters</label><input name="oxygenLiters" type="number"></div>
    <div><label>Caregiver On Board</label><select name="caregiverOnBoard"><option value="No">No</option><option value="Yes">Yes</option></select></div>
    <div><label>Caregiver Count</label><input name="caregiverCount" type="number"></div>
    <div><label>Date of Birth</label><input name="dateOfBirth" type="date"></div>
    <div><label>MRN</label><input name="mrn"></div>
    <div><label>Payer</label><input name="payer"></div>
    <div><label>Assign Driver</label><select name="assignedDriverId"><option value="">Unassigned</option>${driverOptions}</select></div>
  </div><div style="margin-top:12px"><label>Note</label><textarea name="note"></textarea></div>`;
}
function nextStepForTrip(trip){
  return tripSteps.find(step => step.key === 'facesheet_uploaded' ? !(trip.facesheetFiles||[]).length && trip.status === 'arrived' ? false : step.key !== trip.status && tripSteps[tripSteps.findIndex(x=>x.key===trip.status)+1]?.key === step.key : true);
}
function workflowButtons(trip) {
  const currentIndex = tripSteps.findIndex(s => s.key === trip.status);
  const next = currentIndex === -1 ? tripSteps[0] : tripSteps[currentIndex + 1];
  const facesheetNeeded = trip.status === 'arrived';
  return `<div class="driver-actions">${next ? `<button class="secondary" onclick="window.advanceTrip('${trip.id}','${next.key}')">${next.label}</button>` : ''}${facesheetNeeded ? `<label class="upload-btn"><input type="file" accept="image/*,.pdf" onchange="window.uploadFacesheet('${trip.id}', this)">Upload Facesheet</label>` : ''}</div>`;
}
function tripsView() {
  const canCreate = roleIs('admin','manager','dispatcher');
  return `<div class="two-col">
    <div class="panel" style="padding:18px">
      <h3 class="section-title">${canCreate ? 'Create New Trip' : 'My Assigned Trips'}</h3>
      ${canCreate ? `<form id="tripForm">${tripFormFields()}<div class="flex" style="margin-top:14px"><button>Create Trip</button><button type="button" class="ghost" id="calcTripBtn">Preview Price</button></div><div id="calcResult" class="muted small" style="margin-top:10px"></div></form>` : `<div class="item"><strong>Driver workflow required</strong><div class="small muted">Driver must clock in before trip actions. Required order: Received → Trip in Progress → Arrived → Upload Facesheet → Leaving with Patient → Drop Off → Complete.</div></div>`}
    </div>
    <div class="panel" style="padding:18px">
      <h3 class="section-title">Trip List</h3>
      <div class="list">${state.data.trips.map(trip => `
        <div class="item">
          <div class="flex-between"><div><strong>${trip.patientName}</strong><div class="small muted">${trip.pickupDate} ${trip.pickupTime}</div></div><span class="badge">${titleCase(trip.status)}</span></div>
          <div class="small" style="margin-top:8px">${trip.pickupLocation} → ${trip.dropoffLocation}</div>
          <div class="small">Service: ${trip.service} • Weight: ${trip.weight || 0} lbs • Oxygen: ${trip.oxygen ? 'Yes' : 'No'} ${trip.oxygenLiters ? `(${trip.oxygenLiters}L)` : ''}</div>
          ${trip.additionalStops?.length ? `<div class="small">Stops: ${trip.additionalStops.join(' | ')}</div>` : ''}
          <div class="small">Caregiver: ${trip.caregiverOnBoard} ${trip.caregiverCount ? `(${trip.caregiverCount})` : ''}</div>
          ${trip.note ? `<div class="small muted">Note: ${trip.note}</div>` : ''}
          <div class="small muted">Price: ${formatMoney(trip.priceBreakdown?.total || 0)}</div>
          ${trip.facesheetFiles?.length ? `<div class="small"><a href="${trip.facesheetFiles[0].googleDrive?.viewLink || trip.facesheetFiles[0].localUrl}" target="_blank">View Facesheet</a></div>` : ''}
          ${roleIs('driver','contractor_driver') && trip.status !== 'completed' ? workflowButtons(trip) : ''}
        </div>`).join('') || '<div class="muted">No trips available.</div>'}</div>
    </div>
  </div>`;
}
window.advanceTrip = async (id, status) => {
  try {
    if (!isClockedInLocal()) throw new Error('Clock in before starting trip workflow');
    await apiJson(`/api/trips/${id}`, 'PUT', { status });
    await loadTrips(); render();
  } catch (e) { toast('Trip update failed', e.message); }
};
window.uploadFacesheet = async (tripId, input) => {
  try {
    if (!input.files?.[0]) return;
    const fd = new FormData(); fd.append('file', input.files[0]);
    await apiForm(`/api/trips/${tripId}/facesheet`, fd);
    await loadTrips();
    toast('Facesheet uploaded', 'Now tap Facesheet Uploaded');
    render();
  } catch (e) { toast('Facesheet upload failed', e.message); }
};

function attendanceView() {
  return `<div class="two-col">
    <div class="panel" style="padding:18px"><h3 class="section-title">Clock & GPS Attendance</h3>
      <div class="grid grid-2"><button onclick="window.quickClock('clock_in')">Clock In</button><button class="secondary" onclick="window.quickClock('clock_out')">Clock Out</button><button class="warn" onclick="window.quickClock('lunch_out')">Lunch Out</button><button class="secondary" onclick="window.quickClock('lunch_in')">Lunch In</button></div>
      <div class="muted small" style="margin-top:14px">Drivers must clock in before they can tap trip steps. GPS is captured with each attendance action.</div>
      <div class="flex" style="margin-top:14px"><button onclick="window.startTripTracking()">Start Live Trip Tracking</button><button class="ghost" onclick="window.stopTripTracking()">Stop Tracking</button></div>
    </div>
    <div class="panel" style="padding:18px"><h3 class="section-title">Attendance Log</h3><div class="list">${(state.data.attendance || []).slice(0,20).map(a=>`<div class="item"><strong>${a.name}</strong> <span class="badge">${titleCase(a.type)}</span><div class="small muted">${shortDate(a.createdAt)}</div><div class="small">${a.lat || ''}, ${a.lng || ''}</div></div>`).join('') || '<div class="muted">Attendance is visible to admin, manager, and dispatcher.</div>'}</div></div>
  </div>`;
}
let trackingInterval = null;
window.startTripTracking = async () => { if (trackingInterval) clearInterval(trackingInterval); trackingInterval = setInterval(sendGpsUpdate, 15000); await sendGpsUpdate(); toast('Trip tracking started','GPS will update every 15 seconds.'); };
window.stopTripTracking = () => { clearInterval(trackingInterval); trackingInterval = null; toast('Trip tracking stopped'); };
async function sendGpsUpdate() { try { const pos = await getCurrentPos(); const activeTrip = state.data.trips.find(t => ['assigned','received','trip_in_progress','arrived','facesheet_uploaded','leaving_with_patient','drop_off'].includes(t.status)); await apiJson('/api/gps/update','POST',{...pos, tripId: activeTrip?.id || null}); } catch(e){} }

function mapView() {
  if (!roleIs('admin','manager','dispatcher')) return '<div class="panel" style="padding:18px">Only admin, manager, and dispatcher can view the live map.</div>';
  return `<div class="panel" style="padding:18px"><div class="flex-between"><h3 class="section-title">Live Driver Positions</h3><button class="secondary" onclick="window.refreshMap()">Refresh</button></div><div id="map" class="map"></div><div class="list" style="margin-top:14px">${state.data.gps.map(g=>`<div class="item"><strong>${g.name}</strong><div class="small">${titleCase(g.role)} ${g.tripId ? '• On Trip' : ''}</div><div class="small muted">Updated ${shortDate(g.updatedAt)}</div></div>`).join('') || '<div class="muted">No GPS positions reported yet.</div>'}</div></div>`;
}
window.refreshMap = async ()=>{ await loadGps(); render(); };
function initMap(){ const mapEl=document.getElementById('map'); if(!mapEl) return; if(state.map) state.map.remove(); state.map=L.map('map').setView([29.1872,-82.1401],10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(state.map); const bounds=[]; state.data.gps.forEach(g=>{ if(g.lat && g.lng){ L.marker([g.lat,g.lng]).addTo(state.map).bindPopup(`<strong>${g.name}</strong><br>${titleCase(g.role)}<br>${g.tripId?'On trip':'Available'}`); bounds.push([g.lat,g.lng]); } }); if(bounds.length) state.map.fitBounds(bounds,{padding:[30,30]}); }

function expensesView() {
  return `<div class="two-col">
    <div class="panel" style="padding:18px"><h3 class="section-title">Submit Expense</h3>
      <form id="expenseForm" class="grid">
        <div><label>Expense For</label><input name="description" required></div>
        <div class="grid grid-2"><div><label>Date</label><input name="expenseDate" type="date" required></div><div><label>Amount</label><input name="amount" type="number" step="0.01" required></div></div>
        <div><label>Receipt Photo</label><input name="receipt" type="file" accept="image/*,.pdf" capture="environment"></div>
        <button>Save Expense</button>
        <div class="small muted">Receipts will upload to Google Drive when Drive credentials are configured on the server. Otherwise they are saved locally until Drive is connected.</div>
      </form>
    </div>
    <div class="panel" style="padding:18px"><h3 class="section-title">Expense Log</h3><div class="list">${state.data.expenses.map(e=>`<div class="item"><strong>${e.description}</strong><div class="small">${formatMoney(e.amount)} • ${e.expenseDate || ''}</div><div class="small muted">${e.userName || ''}</div>${e.receipt ? `<div class="small"><a href="${e.receipt.googleDrive?.viewLink || e.receipt.localUrl}" target="_blank">View receipt</a> • ${e.receipt.storage === 'google_drive' ? 'Google Drive' : 'Local storage'}</div>` : ''}</div>`).join('') || '<div class="muted">No expenses yet.</div>'}</div></div>
  </div>`;
}

function pricingView() {
  if (!roleIs('admin')) return '<div class="panel" style="padding:18px">Only admin can manage pricing.</div>';
  const s = state.data.priceSettings;
  return `<div class="two-col"><div class="panel" style="padding:18px"><h3 class="section-title">Pricing Controls</h3><form id="priceForm" class="grid"><div class="grid grid-3">
  <div><label>Wheelchair</label><input name="wheelchair" type="number" value="${s.services.wheelchair}"></div>
  <div><label>Stretcher</label><input name="stretcher" type="number" value="${s.services.stretcher}"></div>
  <div><label>Climbing Stairs Chair</label><input name="climbing_stairs_chair" type="number" value="${s.services.climbing_stairs_chair}"></div>
  <div><label>Own Wheelchair</label><input name="own_wheelchair" type="number" value="${s.services.own_wheelchair}"></div>
  <div><label>Ambulatory</label><input name="ambulatory" type="number" value="${s.services.ambulatory}"></div>
  <div><label>Bariatric Threshold</label><input name="bariatricThreshold" type="number" value="${s.bariatricThreshold}"></div>
  <div><label>Weight Surcharge</label><input name="weightSurcharge" type="number" value="${s.weightSurcharge}"></div>
  <div><label>Oxygen Base</label><input name="oxygenBase" type="number" value="${s.oxygen.base}"></div>
  <div><label>Oxygen Per Liter</label><input name="oxygenPerLiter" type="number" value="${s.oxygen.perLiter}"></div>
  <div><label>Extra Stop</label><input name="extraStop" type="number" value="${s.extraStop}"></div>
  <div><label>11-39 Rate</label><input name="tier2" type="number" step="0.1" value="${s.mileageTiers[1].rate}"></div>
  <div><label>40-99 Rate</label><input name="tier3" type="number" step="0.1" value="${s.mileageTiers[2].rate}"></div>
  <div><label>100+ Rate</label><input name="tier4" type="number" step="0.1" value="${s.mileageTiers[3].rate}"></div>
  </div><button>Save Pricing</button></form></div><div class="panel" style="padding:18px"><h3 class="section-title">Current Formula</h3><div class="item">Base service + mileage tier fees + bariatric surcharge + oxygen fees + extra stop fees</div></div></div>`;
}
function equipmentView() {
  return `<div class="two-col"><div class="panel" style="padding:18px"><h3 class="section-title">Equipment Inventory</h3>${roleIs('admin') ? `<form id="equipmentForm" class="grid grid-2"><div><label>Name</label><input name="name"></div><div><label>Quantity</label><input name="quantity" type="number"></div><div><label>Vehicle / Location</label><input name="location"></div><div><label>Status</label><input name="status" placeholder="Ready, repair, missing"></div><div style="grid-column:1/-1"><button>Add Equipment</button></div></form>` : '<div class="muted">Read only for non-admin roles.</div>'}</div><div class="panel" style="padding:18px"><div class="list">${state.data.equipment.map(e=>`<div class="item"><strong>${e.name}</strong><div class="small">Qty: ${e.quantity}</div><div class="small">Location: ${e.location || '-'}</div><div class="small muted">Status: ${e.status || '-'}</div></div>`).join('') || '<div class="muted">No equipment entered yet.</div>'}</div></div></div>`;
}
function inspectionView() {
  return `<div class="two-col"><div class="panel" style="padding:18px"><h3 class="section-title">Vehicle Inspection</h3><form id="inspectionForm" class="grid"><div class="grid grid-2"><div><label>Vehicle Unit</label><input name="vehicleUnit" required></div><div><label>Odometer</label><input name="odometer"></div><div><label>Tires</label><select name="tires"><option>Pass</option><option>Needs Attention</option></select></div><div><label>Brakes</label><select name="brakes"><option>Pass</option><option>Needs Attention</option></select></div><div><label>Lights</label><select name="lights"><option>Pass</option><option>Needs Attention</option></select></div><div><label>Lift / Ramp</label><select name="ramp"><option>Pass</option><option>Needs Attention</option></select></div></div><div><label>Notes</label><textarea name="notes"></textarea></div><div><label>Images (up to 6)</label><input name="images" type="file" accept="image/*" capture="environment" multiple></div><button>Submit Inspection</button></form></div><div class="panel" style="padding:18px"><div class="list">${state.data.inspections.map(i=>`<div class="item"><strong>${i.vehicleUnit}</strong><div class="small">By ${i.userName} • ${shortDate(i.createdAt)}</div><div class="small">Tires ${i.tires} • Brakes ${i.brakes} • Lights ${i.lights} • Lift ${i.ramp}</div><div class="small muted">${i.notes || ''}</div>${(i.images||[]).length ? `<div class="small">${i.images.length} image(s) uploaded • <a href="${i.images[0].googleDrive?.viewLink || i.images[0].localUrl}" target="_blank">Open first image</a></div>` : ''}</div>`).join('') || '<div class="muted">No inspections yet.</div>'}</div></div></div>`;
}
function incidentsView() {
  return `<div class="two-col"><div class="panel" style="padding:18px"><h3 class="section-title">Incident Report</h3><form id="incidentForm" class="grid"><div class="grid grid-2"><div><label>Trip ID (optional)</label><input name="tripId"></div><div><label>Category</label><select name="category"><option>Patient</option><option>Vehicle</option><option>Safety</option><option>Staff</option></select></div></div><div><label>Summary</label><input name="summary" required></div><div><label>Details</label><textarea name="details"></textarea></div><div><label>Images (optional)</label><input name="images" type="file" accept="image/*" capture="environment" multiple></div><button>Submit Incident</button></form></div><div class="panel" style="padding:18px"><div class="list">${state.data.incidents.map(i=>`<div class="item"><strong>${i.summary}</strong><div class="small">${i.category} • ${i.userName}</div><div class="small muted">${shortDate(i.createdAt)}</div><div class="small">${i.details || ''}</div>${(i.images||[]).length ? `<div class="small">${i.images.length} image(s) uploaded • <a href="${i.images[0].googleDrive?.viewLink || i.images[0].localUrl}" target="_blank">Open first image</a></div>` : ''}</div>`).join('') || '<div class="muted">No incidents yet.</div>'}</div></div></div>`;
}
function chatView(){ return `<div class="panel" style="padding:18px"><div class="chat-box"><div class="chat-feed" id="chatFeed">${state.data.messages.slice().reverse().map(m=>`<div class="chat-msg"><strong>${m.userName}</strong> <span class="small muted">${titleCase(m.role)}</span><div>${m.text}</div><div class="small muted">${shortDate(m.createdAt)}</div></div>`).join('')}</div><form id="chatForm" class="flex" style="margin-top:12px"><input name="text" placeholder="Message your team in real time"><button>Send</button></form></div></div>`; }
function usersView(){ if (!roleIs('admin')) return '<div class="panel" style="padding:18px">Only admin can manage users.</div>'; return `<div class="two-col"><div class="panel" style="padding:18px"><h3 class="section-title">Create User</h3><form id="userForm" class="grid"><div><label>Name</label><input name="name"></div><div><label>Email</label><input name="email"></div><div><label>Password</label><input name="password"></div><div><label>Role</label><select name="role"><option>manager</option><option>dispatcher</option><option>driver</option><option>contractor_driver</option><option>admin</option></select></div><button>Create User</button></form></div><div class="panel" style="padding:18px"><div class="list">${state.data.users.map(u=>`<div class="item"><strong>${u.name}</strong><div class="small">${u.email}</div><div class="small muted">${titleCase(u.role)}</div></div>`).join('')}</div></div></div>`; }

function bindPageActions(){
  const tripForm = document.getElementById('tripForm');
  if (tripForm) {
    tripForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = formToJson(tripForm); data.additionalStops = [data.stop1, data.stop2].filter(Boolean); data.oxygen = data.oxygen === 'Yes'; delete data.stop1; delete data.stop2;
      try { await apiJson('/api/trips', 'POST', data); tripForm.reset(); await loadTrips(); render(); toast('Trip created'); } catch (err) { toast('Trip create failed', err.message); }
    };
    const calcBtn = document.getElementById('calcTripBtn');
    if (calcBtn) calcBtn.onclick = async () => {
      try { const data = formToJson(tripForm); data.additionalStops = [data.stop1, data.stop2].filter(Boolean); data.oxygen = data.oxygen === 'Yes'; const result = await apiJson('/api/pricing/calculate', 'POST', data); document.getElementById('calcResult').innerText = `Total: ${formatMoney(result.total)} | Base ${formatMoney(result.base)} | Mileage ${formatMoney(result.mileageFee)} | Weight ${formatMoney(result.weightFee)} | Oxygen ${formatMoney(result.oxygenFee)} | Stops ${formatMoney(result.stopFee)}`; } catch (err) { toast('Pricing failed', err.message); }
    };
  }
  const equipmentForm = document.getElementById('equipmentForm'); if (equipmentForm) equipmentForm.onsubmit = async (e)=>{ e.preventDefault(); try { await apiJson('/api/equipment','POST', formToJson(equipmentForm)); equipmentForm.reset(); await loadEquipment(); render(); } catch(err){ toast('Equipment failed', err.message);} };
  const inspectionForm = document.getElementById('inspectionForm'); if (inspectionForm) inspectionForm.onsubmit = async (e)=>{ e.preventDefault(); try { const fd = new FormData(inspectionForm); const files = inspectionForm.querySelector('[name="images"]').files; [...files].slice(0,6).forEach(f=>fd.append('images', f)); await apiForm('/api/inspections', fd); inspectionForm.reset(); await loadInspections(); render(); } catch(err){ toast('Inspection failed', err.message);} };
  const incidentForm = document.getElementById('incidentForm'); if (incidentForm) incidentForm.onsubmit = async (e)=>{ e.preventDefault(); try { const fd = new FormData(incidentForm); const files = incidentForm.querySelector('[name="images"]').files; [...files].slice(0,4).forEach(f=>fd.append('images', f)); await apiForm('/api/incidents', fd); incidentForm.reset(); await loadIncidents(); render(); } catch(err){ toast('Incident failed', err.message);} };
  const expenseForm = document.getElementById('expenseForm'); if (expenseForm) expenseForm.onsubmit = async (e)=>{ e.preventDefault(); try { const fd = new FormData(expenseForm); const file = expenseForm.querySelector('[name="receipt"]').files[0]; if (file) fd.append('receipt', file); await apiForm('/api/expenses', fd); expenseForm.reset(); await loadExpenses(); render(); toast('Expense saved'); } catch(err){ toast('Expense failed', err.message);} };
  const chatForm = document.getElementById('chatForm'); if (chatForm) chatForm.onsubmit = async (e)=>{ e.preventDefault(); const text = chatForm.elements.text.value.trim(); if (!text) return; try { await apiJson('/api/messages','POST',{text}); chatForm.reset(); } catch(err){ toast('Chat failed', err.message);} };
  const userForm = document.getElementById('userForm'); if (userForm) userForm.onsubmit = async (e)=>{ e.preventDefault(); try { await apiJson('/api/users','POST', formToJson(userForm)); userForm.reset(); await loadUsers(); render(); } catch(err){ toast('User create failed', err.message);} };
  const priceForm = document.getElementById('priceForm'); if (priceForm) priceForm.onsubmit = async (e)=>{ e.preventDefault(); const form = formToJson(priceForm); const payload = { services: { wheelchair:Number(form.wheelchair), stretcher:Number(form.stretcher), climbing_stairs_chair:Number(form.climbing_stairs_chair), own_wheelchair:Number(form.own_wheelchair), ambulatory:Number(form.ambulatory) }, mileageTiers: [{upTo:10,rate:0},{upTo:39,rate:Number(form.tier2)},{upTo:99,rate:Number(form.tier3)},{upTo:9999,rate:Number(form.tier4)}], bariatricThreshold:Number(form.bariatricThreshold), weightSurcharge:Number(form.weightSurcharge), oxygen:{ base:Number(form.oxygenBase), perLiter:Number(form.oxygenPerLiter) }, extraStop:Number(form.extraStop) }; try { await apiJson('/api/price-settings','PUT', payload); await loadPriceSettings(); toast('Pricing saved'); render(); } catch(err){ toast('Pricing save failed', err.message);} };
  if (state.route === 'map') setTimeout(initMap, 50);
}
function formToJson(form){ return Object.fromEntries(new FormData(form).entries()); }
function getCurrentPos(){ return new Promise((resolve, reject)=>{ if(!navigator.geolocation) return reject(new Error('Geolocation not supported')); navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy}), ()=>reject(new Error('GPS permission denied')), { enableHighAccuracy:true, maximumAge:5000, timeout:10000 }); }); }
if (state.user && state.token) bootstrap(); else render();
