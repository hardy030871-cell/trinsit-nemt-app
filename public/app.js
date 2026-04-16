const state = {
  token: localStorage.getItem('trinsit_token') || '',
  user: null,
  users: [],
  trips: [],
  attendance: [],
  expenses: [],
  equipment: [],
  settings: { payers: [], featureFlags: {} },
  liveLocations: {},
  chat: { direct: [] },
  page: 'dashboard',
  map: null,
  markers: {},
  socket: null,
  locationWatchId: null
};

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...options, headers }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function roleIs(...roles){ return state.user && roles.includes(state.user.role); }
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function toast(msg){ alert(msg); }
function fmtDateTime(v){ if(!v) return ''; const d = new Date(v); return d.toLocaleString(); }
function currentAttendance(userId){ return state.attendance.find(a => a.userId === userId && !a.clockOutAt); }

async function bootstrap(){
  if (!state.token) return renderLogin();
  try {
    const data = await api('/api/bootstrap');
    Object.assign(state, data);
    connectSocket();
    updateLocationTracking();
    renderShell();
  } catch {
    localStorage.removeItem('trinsit_token');
    state.token = '';
    renderLogin();
  }
}

function connectSocket(){
  if (state.socket) return;
  state.socket = io();
  state.socket.on('trip:new', async () => refreshData());
  state.socket.on('trip:assigned', async trip => { await refreshData(); if ((trip.driverIds||[]).includes(state.user.id)) notify('New Trip Assigned', `${trip.patientName} at ${trip.pickupLocation}`); });
  state.socket.on('trip:updated', async () => refreshData());
  state.socket.on('location:update', payload => { state.liveLocations[payload.userId] = payload; if (state.page === 'live-map') renderMap(true); });
  state.socket.on('chat:new', async msg => {
    state.chat.direct.push(msg);
    if (msg.toIds.includes(state.user.id) || msg.fromId === state.user.id) notify('New Message', msg.text);
    if (state.page === 'chat') renderPage();
  });
}

async function refreshData({ render = true } = {}){
  const data = await api('/api/bootstrap');
  Object.assign(state, data);
  updateLocationTracking();
  if (render) renderPage();
}

function notify(title, body){
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }
}

function renderLogin(){
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand-mark">TRINSIT</div>
        <h1>PIN Login</h1>
        <p>Enter your PIN.</p>
        <form id="loginForm" class="stack">
          <input name="pin" type="password" inputmode="text" autocomplete="current-password" aria-label="PIN" required />
          <button>Login</button>
        </form>
      </div>
    </div>`;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const pin = String(new FormData(e.target).get('pin') || '').trim();
    try {
      const data = await api('/api/login', { method:'POST', body: JSON.stringify({ pin }) });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('trinsit_token', data.token);
      if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
      await bootstrap();
    } catch(err) { toast(err.message); }
  };
}

function navItems(){
  const items = [
    ['dashboard','Dashboard'],
    ['trips', roleIs('driver','contractor_driver') ? 'My Trips' : 'Trips'],
    ['dispatcher', 'Dispatcher Board'],
    ['attendance','Attendance'],
    ['live-map','Live Map'],
    ['chat','Team Chat'],
    ['expenses','Expenses'],
    ['equipment','Equipment'],
    ['users','Users'],
    ['control','Control Panel']
  ];
  return items.filter(([key]) => {
    if (key === 'dispatcher' && !roleIs('admin','dispatcher','manager')) return false;
    if (key === 'users' && !roleIs('admin','dispatcher','manager')) return false;
    if (key === 'control' && !roleIs('admin')) return false;
    return true;
  });
}

function renderShell(){
  document.getElementById('app').innerHTML = `
    <div class="shell">
      <aside class="drawer" id="drawer">
        <div class="drawer-head">
          <div>
            <div class="brand-mark sm">TRINSIT</div>
            <div class="muted">${escapeHtml(state.user.name)} · ${escapeHtml(state.user.role)}</div>
          </div>
          <button class="ghost" onclick="toggleDrawer()">✕</button>
        </div>
        <nav class="nav-list">
          ${navItems().map(([k,l]) => `<button class="nav-btn ${state.page===k?'active':''}" onclick="goPage('${k}')">${l}</button>`).join('')}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="ghost" onclick="toggleDrawer()">☰</button>
          <div class="topbar-title">${pageTitle()}</div>
          <div class="topbar-actions">
            <button class="ghost" onclick="logout()">Logout</button>
          </div>
        </header>
        <section id="page"></section>
      </main>
    </div>`;
  renderPage();
}

function pageTitle(){
  return ({dashboard:'Dashboard',trips:'Trips',dispatcher:'Dispatcher Board',attendance:'Attendance', 'live-map':'Live Map', chat:'Team Chat', expenses:'Expenses', equipment:'Equipment', users:'Users', control:'Control Panel'})[state.page] || 'TRINSIT';
}
function toggleDrawer(){ document.getElementById('drawer')?.classList.toggle('open'); }
function goPage(p){ state.page = p; renderShell(); }
function logout(){
  stopLocationTracking();
  localStorage.removeItem('trinsit_token');
  state.token='';
  state.user=null;
  state.socket?.disconnect();
  state.socket = null;
  renderLogin();
}

function renderPage(){
  const el = document.getElementById('page');
  if (!el) return;
  const map = {
    dashboard: renderDashboard,
    trips: renderTrips,
    dispatcher: renderDispatcher,
    attendance: renderAttendance,
    'live-map': renderMap,
    chat: renderChat,
    expenses: renderExpenses,
    equipment: renderEquipment,
    users: renderUsers,
    control: renderControl
  };
  (map[state.page] || renderDashboard)(false);
}

function renderDashboard(){
  const myTrips = roleIs('driver','contractor_driver') ? state.trips.filter(t => (t.driverIds||[]).includes(state.user.id)) : state.trips;
  const activeAttendance = state.attendance.filter(a => !a.clockOutAt).length;
  document.getElementById('page').innerHTML = `
    <div class="grid two">
      <div class="card stat"><h3>Trips</h3><div class="big">${myTrips.length}</div></div>
      <div class="card stat"><h3>Clocked In</h3><div class="big">${activeAttendance}</div></div>
    </div>
    <div class="card">
      <h3>Recent Trips</h3>
      <div class="list">${myTrips.slice(0,5).map(tripCard).join('')}</div>
    </div>`;
}

function tripCard(trip){
  return `<div class="trip-card">
    <div class="trip-card-head"><strong>${trip.id}</strong><span class="pill">${trip.status}</span></div>
    <div>${escapeHtml(trip.patientName)}</div>
    <div class="muted">${fmtDateTime(trip.pickupTime)}</div>
    <div class="muted">${escapeHtml(trip.pickupLocation)} → ${escapeHtml(trip.dropoffLocation)}</div>
    <div class="actions"><button onclick="openTrip('${trip.id}')">Open</button></div>
  </div>`;
}

function openTrip(id){
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-card"><div class="row between"><h3>${trip.id}</h3><button class="ghost" onclick="this.closest('.modal').remove()">✕</button></div>
    <div class="stack">
      <div><strong>Patient:</strong> ${escapeHtml(trip.patientName)}</div>
      <div><strong>Pickup:</strong> <a target="_blank" href="https://www.google.com/maps?q=${encodeURIComponent(trip.pickupLocation)}">${escapeHtml(trip.pickupLocation)}</a></div>
      <div><strong>Dropoff:</strong> <a target="_blank" href="https://www.google.com/maps?q=${encodeURIComponent(trip.dropoffLocation)}">${escapeHtml(trip.dropoffLocation)}</a></div>
      <div><strong>Service:</strong> ${escapeHtml(trip.service)} | <strong>Weight:</strong> ${escapeHtml(trip.weight)}</div>
      <div><strong>Room:</strong> ${escapeHtml(trip.roomNumber || '-')} | <strong>Caregiver:</strong> ${escapeHtml(trip.caregiverCount || '0')}</div>
      <div><strong>Oxygen:</strong> ${escapeHtml(trip.oxygen)} ${trip.oxygenLiters ? `(${escapeHtml(trip.oxygenLiters)} L)` : ''} ${trip.otherStop ? `| <strong>Stop:</strong> ${escapeHtml(trip.otherStop)}` : ''}</div>
      ${trip.notes ? `<div><strong>Notes:</strong> ${escapeHtml(trip.notes)}</div>` : ''}
      ${tripStatusActions(trip)}
      <div class="stack logs">${(trip.tripLogs||[]).map(l=>`<div class="log-row">${escapeHtml(l.status)} · ${fmtDateTime(l.at)}</div>`).join('')}</div>
    </div></div>`;
  document.body.appendChild(modal);
}

function tripStatusActions(trip){
  if(!roleIs('driver','contractor_driver')) return '';
  const logs = trip.tripLogs || trip.log || [];
  const hasStatus = s => trip.status === s || logs.some(l => l.action === s || l.status === s || l.type === s);
  const hasFacesheet = (trip.facesheetFiles || []).length > 0 || hasStatus('facesheet_uploaded');
  const inProgressDone = hasStatus('trip_in_progress');
  const arrivedDone = hasStatus('arrived_pickup');
  const leavingDone = hasStatus('leaving_with_patient');
  const completedDone = hasStatus('completed');
  const canStart = !completedDone && !inProgressDone;
  const canArrive = !completedDone && !arrivedDone && inProgressDone;
  const canUpload = !completedDone && !hasFacesheet && arrivedDone;
  const canLeave = !completedDone && !leavingDone && hasFacesheet;
  const canComplete = !completedDone && leavingDone;
  return `<div class="progress-vertical">
    <button class="progress-step-btn ${inProgressDone?'done':''}" ${canStart?'':'disabled'} onclick="advanceTrip('${trip.id}','trip_in_progress')">Trip In Progress</button>
    <button class="progress-step-btn ${arrivedDone?'done':''}" ${canArrive?'':'disabled'} onclick="advanceTrip('${trip.id}','arrived_pickup')">Arrived for Pick Up</button>
    <label class="progress-step ${hasFacesheet?'done':''}">Upload Facesheet<input type="file" ${canUpload?'':'disabled'} onchange="uploadFacesheet('${trip.id}', this.files[0])"></label>
    <button class="progress-step-btn ${leavingDone?'done':''}" ${canLeave?'':'disabled'} onclick="advanceTrip('${trip.id}','leaving_with_patient')">Leaving With Patient</button>
    <button class="progress-step-btn ${completedDone?'done':''}" ${canComplete?'':'disabled'} onclick="advanceTrip('${trip.id}','completed')">Trip Completed</button>
  </div>`;
}

async function advanceTrip(tripId, status){
  try {
    await api(`/api/trips/${tripId}/status`, { method:'POST', body: JSON.stringify({ status }) });
    await refreshData();
    toast('Trip updated');
    document.querySelector('.modal')?.remove();
    openTrip(tripId);
  } catch(err){ toast(err.message); }
}

async function uploadFacesheet(tripId, file){
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    await api(`/api/trips/${tripId}/facesheet`, { method:'POST', body: fd });
    await refreshData();
    toast('Facesheet uploaded');
    document.querySelector('.modal')?.remove();
    openTrip(tripId);
  } catch(err){ toast(err.message); }
}

function renderTrips(){
  const trips = roleIs('driver','contractor_driver') ? state.trips.filter(t => (t.driverIds||[]).includes(state.user.id)) : state.trips;
  document.getElementById('page').innerHTML = `
    ${roleIs('admin','dispatcher','manager') ? createTripForm() : ''}
    <div class="card"><h3>${roleIs('driver','contractor_driver') ? 'Assigned Trips' : 'Trips'}</h3><div class="list">${trips.map(tripCard).join('')}</div></div>`;
  const form = document.getElementById('tripForm');
  if (form) form.onsubmit = submitTrip;
}

function createTripForm(){
  return `<div class="card"><h3>Create New Trip</h3>
    <form id="tripForm" class="grid two">
      <input name="patientName" placeholder="Patient Name" required>
      <input type="datetime-local" name="pickupTime" required>
      <input class="long" name="pickupLocation" placeholder="Pickup Address" required>
      <input class="long" name="dropoffLocation" placeholder="Dropoff Address" required>
      <input name="service" placeholder="Service (Wheelchair, Stretcher, etc.)" required>
      <input name="weight" placeholder="Weight" required>
      <input name="roomNumber" placeholder="Room Number">
      <input name="oxygen" placeholder="Oxygen Yes/No" required>
      <input name="oxygenLiters" placeholder="Oxygen Liters">
      <input name="caregiverCount" placeholder="Caregiver Count">
      <input name="otherStop" placeholder="Other Stop">
      <select name="payer">${state.settings.payers.map(p=>`<option>${escapeHtml(p)}</option>`).join('')}</select>
      <input name="notes" placeholder="Notes for Driver / Facility">
      <input name="mileage" placeholder="Mileage">
      <label>Driver 1<select name="driver1">${driverOptions()}</select></label>
      <label>Driver 2<select name="driver2"><option value="">None</option>${driverOptions()}</select></label>
      <div class="full"><button>Create Trip</button></div>
    </form></div>`;
}
function driverOptions(){ return state.users.filter(u=>['driver','contractor_driver'].includes(u.role)).map(u=>`<option value="${u.id}">${escapeHtml(u.name)}</option>`).join(''); }
async function submitTrip(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const driverIds = [fd.get('driver1'), fd.get('driver2')].filter(Boolean);
  const payload = Object.fromEntries(fd.entries());
  payload.driverIds = [...new Set(driverIds)];
  try { await api('/api/trips', { method:'POST', body: JSON.stringify(payload) }); toast('Trip created'); await refreshData(); } catch(err){ toast(err.message); }
}

function renderDispatcher(){
  document.getElementById('page').innerHTML = `<div class="card"><h3>Dispatcher Board</h3><div class="board-grid">${state.trips.map(t=>`
    <div class="trip-card"><div class="trip-card-head"><strong>${t.id}</strong><span class="pill">${t.status}</span></div>
    <div>${escapeHtml(t.patientName)}</div><div class="muted">${escapeHtml(t.pickupLocation)}</div>
    <div class="row"><label>Drivers<select multiple onchange="assignDriver('${t.id}', this)">${state.users.filter(u=>['driver','contractor_driver'].includes(u.role)).map(u=>`<option value="${u.id}" ${(t.driverIds||[]).includes(u.id)?'selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select></label></div>
    <div class="actions"><button onclick="openTrip('${t.id}')">Open</button></div></div>`).join('')}</div></div>`;
}
async function assignDriver(tripId, selectEl){
  const driverIds = [...selectEl.selectedOptions].map(o => o.value).slice(0,2);
  try{ await api('/api/trips/assign', { method:'POST', body: JSON.stringify({ tripId, driverIds })}); toast('Trip assigned'); await refreshData(); } catch(err){ toast(err.message); }
}

function renderAttendance(){
  const current = state.attendance.find(a => a.userId === state.user.id && !a.clockOutAt);
  document.getElementById('page').innerHTML = `<div class="grid two">
    <div class="card"><h3>My Attendance</h3>
      <div class="stack">
        ${current ? `<div class="pill">Clocked in since ${fmtDateTime(current.clockInAt)}</div>` : `<div class="pill">Off duty</div>`}
        <div class="row wrap">
          <button onclick="confirmAction('Clock In', clockIn)" ${current?'disabled':''}>Clock In</button>
          <button onclick="confirmAction('Start Break', breakStart)" ${!current?'disabled':''}>Start Break</button>
          <button onclick="confirmAction('End Break', breakEnd)" ${!current?'disabled':''}>End Break</button>
          <button onclick="confirmAction('Clock Out', clockOut)" ${!current?'disabled':''}>Clock Out</button>
        </div>
      </div>
    </div>
    ${roleIs('admin') ? `<div class="card"><h3>Admin Manual Attendance</h3>
      <form id="manualAttendance" class="stack">
        <select name="userId">${state.users.map(u=>`<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}</select>
        <select name="action"><option value="clock_in">Manual Clock In</option><option value="clock_out">Manual Clock Out</option></select>
        <input type="datetime-local" name="time" required>
        <input name="note" placeholder="Reason" required>
        <button>Save</button>
      </form></div>` : ''}
  </div>
  <div class="card"><h3>Attendance Log</h3><div class="list">${state.attendance.slice().reverse().map(a=>`<div class="list-row"><strong>${escapeHtml(a.userName)}</strong><span>${fmtDateTime(a.clockInAt)} ${a.clockOutAt?`→ ${fmtDateTime(a.clockOutAt)}`:''}</span><span>${a.manualOverride?'Manual':''}</span></div>`).join('')}</div></div>`;
  const form = document.getElementById('manualAttendance');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await api('/api/attendance/admin-adjust', { method:'POST', body: JSON.stringify(Object.fromEntries(fd.entries()))}); toast('Attendance updated'); await refreshData(); } catch(err){ toast(err.message); }
  };
}
function confirmAction(label, fn){ if(confirm(`You selected ${label}. Proceed?`)) fn(); }
async function clockIn(){
  const type = prompt('Enter work type: Hourly / Contractor / Commissions', 'Hourly') || 'Hourly';
  let commissionEntries = [];
  if (type.toLowerCase() === 'commissions') {
    const patientName = prompt('Patient Full Name');
    const date = prompt('Date (YYYY-MM-DD)');
    const time = prompt('Time (HH:MM)');
    if (!patientName || !date || !time) return toast('Commission fields required');
    commissionEntries = [{ patientName, date, time }];
  }
  try {
    await api('/api/attendance/clock-in', { method:'POST', body: JSON.stringify({ type, location:'Manual', commissionEntries }) });
    toast('Clocked in');
    await refreshData();
    await sendLiveLocation();
  } catch(err){ toast(err.message); }
}
async function breakStart(){ try{ await api('/api/attendance/break-start', { method:'POST', body: JSON.stringify({})}); toast('Break started'); await refreshData(); }catch(err){ toast(err.message);} }
async function breakEnd(){ try{ await api('/api/attendance/break-end', { method:'POST', body: JSON.stringify({})}); toast('Break ended'); await refreshData(); }catch(err){ toast(err.message);} }
async function clockOut(){ try{ await api('/api/attendance/clock-out', { method:'POST', body: JSON.stringify({ location:'Manual' })}); toast('Clocked out'); await refreshData(); }catch(err){ toast(err.message);} }

function renderMap(refreshOnly=false){
  const page = document.getElementById('page');
  if (!refreshOnly) page.innerHTML = `<div class="card map-card"><div class="row between"><h3>Live Map</h3><button class="ghost" onclick="refreshLiveMap()">Refresh</button></div><div id="liveMap"></div><div class="muted map-status" id="mapStatus"></div></div>`;
  const mapEl = document.getElementById('liveMap');
  if (!mapEl) return;
  if (state.map && !mapEl._leaflet_id) {
    try{ state.map.remove(); }catch{}
    state.map = null; state.markers = {};
  }
  if (!state.map) {
    state.map = L.map('liveMap').setView([29.1872, -82.1401], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
  }
  Object.values(state.markers).forEach(m => { try{ state.map.removeLayer(m); }catch{} });
  state.markers = {};
  const points = Object.values(state.liveLocations || {}).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  points.forEach(p => {
    const marker = L.marker([p.lat, p.lng]).addTo(state.map).bindPopup(`${escapeHtml(p.name)} · ${escapeHtml(p.role)}<br>${fmtDateTime(p.at)}`);
    state.markers[p.userId] = marker;
  });
  const status = document.getElementById('mapStatus');
  if (status) status.textContent = points.length ? `${points.length} active location${points.length === 1 ? '' : 's'} · refreshed ${new Date().toLocaleTimeString()}` : 'No clocked-in users are sharing location right now.';
  if (points.length) {
    const group = L.featureGroup(Object.values(state.markers));
    state.map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 14 });
  }
  setTimeout(()=> state.map.invalidateSize(), 200);
}
async function refreshLiveMap(){
  try {
    await refreshData({ render: false });
    renderMap(true);
  } catch(err){ toast(err.message); }
}
setInterval(() => { if (state.page === 'live-map' && state.token) refreshLiveMap(); }, 12000);

function renderChat(){
  const contacts = state.users.filter(u => u.id !== state.user.id);
  const msgs = state.chat.direct.filter(m => m.fromId === state.user.id || (m.toIds||[]).includes(state.user.id));
  document.getElementById('page').innerHTML = `<div class="grid two"><div class="card"><h3>Contacts</h3><div class="list">${contacts.map(u=>`<label class="check"><input type="checkbox" value="${u.id}" class="chat-user-check"> ${escapeHtml(u.name)} <span class="muted">${u.status||''}</span></label>`).join('')}</div></div>
  <div class="card"><h3>Messages</h3><div class="chat-box">${msgs.map(m=>`<div class="msg ${m.fromId===state.user.id?'mine':''}"><strong>${escapeHtml(m.fromName)}</strong><div>${escapeHtml(m.text)}</div><div class="muted">${fmtDateTime(m.at)}</div></div>`).join('')}</div>
  <form id="chatForm" class="row"><input name="text" placeholder="Type message" required><button>Send</button></form></div></div>`;
  document.getElementById('chatForm').onsubmit = async e => {
    e.preventDefault();
    const toIds = [...document.querySelectorAll('.chat-user-check:checked')].map(i=>i.value);
    const text = new FormData(e.target).get('text');
    if (!toIds.length) return toast('Select at least one user');
    try { await api('/api/chat/send', { method:'POST', body: JSON.stringify({ toIds, text })}); e.target.reset(); await refreshData(); } catch(err){ toast(err.message); }
  };
}

function renderExpenses(){
  document.getElementById('page').innerHTML = `<div class="grid two"><div class="card"><h3>New Expense</h3><form id="expenseForm" class="stack"><select name="category"><option>Gas</option><option>Oil Change</option><option>Change Tires</option><option>Car Wash</option><option>Maintenance</option><option>Other</option></select><input name="amount" placeholder="Amount" required><input name="date" type="date" required><input name="note" placeholder="Note"><input name="receipt" type="file"><button>Save Expense</button></form></div>
  <div class="card"><h3>Expense Log</h3><div class="list">${state.expenses.map(e=>`<div class="list-row"><span>${escapeHtml(e.userName)} · ${escapeHtml(e.category)} · $${escapeHtml(e.amount)}</span>${roleIs('admin')?`<span><button class="ghost" onclick="deleteExpense('${e.id}')">Delete</button></span>`:''}</div>`).join('')}</div></div></div>`;
  document.getElementById('expenseForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await api('/api/expenses', { method:'POST', body: fd }); toast('Expense entered successfully'); await refreshData(); } catch(err){ toast(err.message); }
  };
}
async function deleteExpense(id){ if(!confirm('Delete expense?')) return; try{ await api(`/api/expenses/${id}`, { method:'DELETE' }); toast('Deleted'); await refreshData(); }catch(err){ toast(err.message); } }

function renderEquipment(){
  document.getElementById('page').innerHTML = `<div class="grid two">
    ${roleIs('admin') ? `<div class="card"><h3>Add Equipment</h3><form id="equipmentForm" class="stack"><input name="name" placeholder="Equipment name" required><label class="check"><input type="checkbox" name="required"> Required item</label><button>Save Equipment</button></form></div>` : ''}
    <div class="card"><h3>Equipment Inventory</h3><div class="list">${state.equipment.map(i=>`<div class="list-row"><span>${escapeHtml(i.name)} · ${i.required?'Required':'Optional'}</span>${roleIs('admin')?`<span><button class="ghost" onclick="editEquipment('${i.id}')">Edit</button><button class="ghost danger" onclick="deleteEquipment('${i.id}')">Delete</button></span>`:`<span>${i.required?'Required':'Optional'}</span>`}</div>`).join('')}</div></div>
  </div>`;
  const form = document.getElementById('equipmentForm');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/equipment', { method:'POST', body: JSON.stringify({ name: fd.get('name'), required: fd.get('required') === 'on' }) });
      toast('Equipment saved');
      await refreshData();
    } catch(err){ toast(err.message); }
  };
}
async function editEquipment(id){
  const item = state.equipment.find(e => e.id === id);
  if (!item) return;
  const name = prompt('Equipment name', item.name);
  if (name === null) return;
  const required = confirm('Mark this equipment as required?');
  try {
    await api(`/api/equipment/${id}`, { method:'PUT', body: JSON.stringify({ name, required }) });
    toast('Equipment updated');
    await refreshData();
  } catch(err){ toast(err.message); }
}
async function deleteEquipment(id){
  if (!confirm('Delete this equipment item?')) return;
  try {
    await api(`/api/equipment/${id}`, { method:'DELETE' });
    toast('Equipment deleted');
    await refreshData();
  } catch(err){ toast(err.message); }
}

function renderUsers(){
  document.getElementById('page').innerHTML = `<div class="grid two"><div class="card"><h3>Create User</h3><form id="userForm" class="stack"><input name="name" placeholder="Full Name" required><select name="role"><option value="driver">Driver</option><option value="contractor_driver">Contractor Driver</option><option value="dispatcher">Dispatcher</option><option value="manager">Manager</option><option value="admin">Admin</option></select><input name="pin" placeholder="PIN" required><input name="phone" placeholder="Phone"><input name="address" placeholder="Address"><input name="dob" placeholder="DOB MM/DD/YYYY"><label class="check"><input type="checkbox" name="contractorPermission"> Contractor login allowed</label><button>Create User</button></form></div>
  <div class="card"><h3>User List</h3><div class="list">${state.users.map(u=>`<div class="list-row"><span>${escapeHtml(u.name)} · ${escapeHtml(u.role)}</span><span><button class="ghost" onclick="editUser('${u.id}')">Edit</button><button class="ghost danger" onclick="removeUser('${u.id}')">Delete</button></span></div>`).join('')}</div></div></div>`;
  document.getElementById('userForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.contractorPermission = fd.get('contractorPermission') === 'on';
    try { await api('/api/users', { method:'POST', body: JSON.stringify(payload) }); toast('User created'); await refreshData(); } catch(err){ toast(err.message); }
  };
}
async function editUser(id){
  const u = state.users.find(x=>x.id===id); if(!u) return;
  const role = prompt('Role', u.role) || u.role;
  const contractorPermission = confirm('Allow contractor login?');
  try { await api(`/api/users/${id}`, { method:'PUT', body: JSON.stringify({ role, contractorPermission }) }); toast('User updated'); await refreshData(); } catch(err){ toast(err.message); }
}
async function removeUser(id){ if(!confirm('Delete this user account permanently?')) return; try{ await api(`/api/users/${id}`, { method:'DELETE' }); toast('User deleted'); await refreshData(); }catch(err){ toast(err.message);} }

function renderControl(){
  document.getElementById('page').innerHTML = `<div class="grid two">
    <div class="card"><h3>Add Payer</h3><form id="payerForm" class="stack"><input name="payer" placeholder="Payer name" required><button>Save Payer</button></form></div>
    <div class="card"><h3>Payers</h3><div class="list">${(state.settings.payers||[]).map((p,index)=>`<div class="list-row"><span>${escapeHtml(p)}</span><span><button class="ghost" onclick="editPayer(${index})">Edit</button><button class="ghost danger" onclick="deletePayer(${index})">Delete</button></span></div>`).join('')}</div></div>
    <div class="card"><h3>Feature Flags</h3><div class="list">${Object.entries(state.settings.featureFlags||{}).map(([k,v])=>`<div class="list-row"><span>${escapeHtml(k)}</span><span>${v?'On':'Off'}</span></div>`).join('')}</div></div>
  </div>`;
  document.getElementById('payerForm').onsubmit = async e => {
    e.preventDefault();
    const payer = new FormData(e.target).get('payer');
    try {
      await api('/api/payers', { method:'POST', body: JSON.stringify({ payer }) });
      toast('Payer saved');
      await refreshData();
    } catch(err){ toast(err.message); }
  };
}
async function editPayer(index){
  const current = (state.settings.payers || [])[index];
  if (!current) return;
  const payer = prompt('Payer name', current);
  if (payer === null) return;
  try {
    await api(`/api/payers/${index}`, { method:'PUT', body: JSON.stringify({ payer }) });
    toast('Payer updated');
    await refreshData();
  } catch(err){ toast(err.message); }
}
async function deletePayer(index){
  if (!confirm('Delete this payer?')) return;
  try {
    await api(`/api/payers/${index}`, { method:'DELETE' });
    toast('Payer deleted');
    await refreshData();
  } catch(err){ toast(err.message); }
}

async function sendLiveLocation(){
  if (!state.token || !state.user || !navigator.geolocation || !currentAttendance(state.user.id)) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    try { await api('/api/location', { method:'POST', body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) }); } catch {}
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 });
}
function updateLocationTracking(){
  if (!state.user || !currentAttendance(state.user.id)) return stopLocationTracking();
  if (!navigator.geolocation || state.locationWatchId !== null) return;
  state.locationWatchId = navigator.geolocation.watchPosition(async pos => {
    try {
      await api('/api/location', { method:'POST', body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) });
    } catch {}
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 });
}
function stopLocationTracking(){
  if (state.locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.locationWatchId);
  }
  state.locationWatchId = null;
}
setInterval(() => sendLiveLocation(), 15000);

bootstrap();
