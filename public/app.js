function tripStatusActions(trip){
  if(!roleIs('driver','contractor_driver')) return '';

  const logs = trip.tripLogs || trip.log || [];
  const hasStatus = (s) =>
    trip.status === s ||
    logs.some(l => l.action === s || l.status === s || l.type === s);

  const hasFacesheet =
    (trip.facesheetFiles || []).length > 0 ||
    hasStatus('facesheet_uploaded');

  const inProgressDone = hasStatus('trip_in_progress');
  const arrivedDone = hasStatus('arrived_pickup');
  const leavingDone = hasStatus('leaving_with_patient');
  const completedDone = hasStatus('completed');

  const canStart = !completedDone && !inProgressDone;
  const canArrive = !completedDone && !arrivedDone && inProgressDone;
  const canUpload = !completedDone && !hasFacesheet && arrivedDone;
  const canLeave = !completedDone && !leavingDone && hasFacesheet;
  const canComplete = !completedDone && leavingDone;

  return `
    <div class="progress-vertical">
      <button class="progress-step-btn ${inProgressDone?'done':''}"
        ${canStart ? '' : 'disabled'}
        onclick="advanceTrip('${trip.id}','trip_in_progress')">
        <span class="step-dot"></span>
        <span class="step-label">Trip In Progress</span>
      </button>

      <button class="progress-step-btn ${arrivedDone?'done':''}"
        ${canArrive ? '' : 'disabled'}
        onclick="advanceTrip('${trip.id}','arrived_pickup')">
        <span class="step-dot"></span>
        <span class="step-label">Arrived for Pick Up</span>
      </button>

      <label class="progress-step ${hasFacesheet?'done':''}">
        <span class="step-dot"></span>
        <span class="step-label">Upload Facesheet</span>
        <input type="file"
          accept="image/*,.pdf"
          ${canUpload ? '' : 'disabled'}
          onchange="uploadFacesheet('${trip.id}', this.files[0])">
      </label>

      <button class="progress-step-btn ${leavingDone?'done':''}"
        ${canLeave ? '' : 'disabled'}
        onclick="advanceTrip('${trip.id}','leaving_with_patient')">
        <span class="step-dot"></span>
        <span class="step-label">Leaving With Patient</span>
      </button>

      <button class="progress-step-btn ${completedDone?'done':''}"
        ${canComplete ? '' : 'disabled'}
        onclick="advanceTrip('${trip.id}','completed')">
        <span class="step-dot"></span>
        <span class="step-label">Trip Completed</span>
      </button>
    </div>
  `;
}
