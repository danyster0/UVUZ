
/* ===== UVUZ LIFE / HP HUD ===== */
const MAX_LIVES = 5;
function progressToLives(progress){return Math.max(1,Math.min(MAX_LIVES,Math.ceil((Number(progress)||0)/20)));}
function updateLives(progress=0){
  const box=document.getElementById("healthLives");
  const counter=document.getElementById("lifeCounter");
  if(!box)return;
  const lives=progressToLives(progress);
  [...box.querySelectorAll(".game-heart")].forEach((h,i)=>{
    h.classList.toggle("full",i<lives);
    h.classList.toggle("empty",i>=lives);
  });
  if(counter)counter.textContent=`${lives}/${MAX_LIVES}`;
}

const STORAGE_KEY = "myPlannerData_v1";

const defaultData = {
  yearly: [],
  monthly: [],
  weekly: [],
  tasks: [],
  notes: [],
  folders: ["All Notes", "Ideas", "Programming", "University", "Personal"],
  settings: {theme:"dark"}
};

let data = loadData();
let currentView = "dashboard";
let selectedNoteId = data.notes[0]?.id || null;
let mediaRecorder = null;
let audioChunks = [];

let recordingNoteId = null;
let mediaDBPromise = null;

function openMediaDB() {
  if (mediaDBPromise) return mediaDBPromise;
  mediaDBPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("UVUZMediaDB_v1", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("media")) {
        db.createObjectStore("media", {keyPath:"id"});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return mediaDBPromise;
}

async function mediaPut(blob, meta={}) {
  const id = uid("media");
  const db = await openMediaDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").put({
      id, blob,
      name: meta.name || "attachment",
      type: meta.type || blob.type || "application/octet-stream",
      size: blob.size,
      created: new Date().toISOString()
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

async function mediaGet(id) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction("media", "readonly").objectStore("media").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function mediaDelete(id) {
  if (!id) return;
  const db = await openMediaDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("media", "readwrite");
    tx.objectStore("media").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteNoteMedia(note) {
  for (const item of (note?.media || [])) {
    try { await mediaDelete(item.id); } catch {}
  }
}

function noteMediaList(note) {
  if (!note.media) note.media = [];
  return note.media;
}

function formatBytes(bytes=0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}


function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const result = {...defaultData, ...saved};
    result.notes = Array.isArray(result.notes) ? result.notes : [];
    result.notes.forEach(n => {
      if (!Array.isArray(n.tags)) n.tags = [];
      if (!Array.isArray(n.media)) n.media = [];
      if (!n.folder) n.folder = "Personal";
    });
    return result;
  } catch {
    return structuredClone(defaultData);
  }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function uid(prefix="id") { return prefix + Math.random().toString(36).slice(2,9); }
function todayISO() { return new Date().toISOString().slice(0,10); }
function esc(s="") { return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
function pct(n) { return Math.max(0, Math.min(100, Number(n)||0)); }
function showToast(msg) {
  const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 1800);
}
function setView(view) {
  currentView = view;
  document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active", x.dataset.view===view));
  document.getElementById("breadcrumb").textContent = ({
    dashboard:"Dashboard", yearly:"Yearly Goals", monthly:"Monthly Goals", weekly:"Weekly Goals",
    daily:"Daily Tasks", notes:"Notes", progress:"Progress", calendar:"Calendar", settings:"Settings"
  })[view] || "Dashboard";
  render();
  document.getElementById("sidebar").classList.remove("open");
}
function render() {
  const root = document.getElementById("content");
  const views = {dashboard:renderDashboard, yearly:renderYearly, monthly:renderMonthly, weekly:renderWeekly, daily:renderDaily, notes:renderNotes, progress:renderProgress, calendar:renderCalendar, settings:renderSettings};
  root.innerHTML = (views[currentView] || renderDashboard)();
  bindViewEvents();
  updateSidebarProgress();
}

function progressBar(value, green=false) {
  return `<div class="progress ${green?"green":""}"><i style="width:${pct(value)}%"></i></div>`;
}
function priorityBadge(p) {
  const map={high:["red","High"],medium:["yellow","Medium"],low:["green","Low"]};
  const [c,t]=map[p]||map.medium; return `<span class="badge ${c}">${t}</span>`;
}
function taskHTML(t) {
  return `<div class="task ${t.done?"done":""}">
    <button class="check ${t.done?"done":""}" data-task-toggle="${t.id}">${t.done?"✓":""}</button>
    <div class="task-main"><strong class="task-text">${esc(t.title)}</strong><span>${esc(t.time||"No time")} · #${esc(t.tag||"General")}</span></div>
    <div class="task-right">${priorityBadge(t.priority)}</div>
  </div>`;
}

function renderDashboard() {
  const today = todayISO();
  const todays = data.tasks.filter(t=>t.date===today);
  const done = todays.filter(t=>t.done).length;
  const yearAvg = data.yearly.length ? Math.round(data.yearly.reduce((a,g)=>a+pct(g.progress),0)/data.yearly.length) : 0;
  return `
    <div class="page-head">
      <div><div class="eyebrow">Productivity HQ</div><h1>Good morning 👋</h1><p>Plan the day. Build the future.</p></div>
      <div class="pixel-label">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</div>
    </div>
    <div class="stats">
      <div class="stat-card"><span>Year progress</span><b>${yearAvg}%</b>${progressBar(yearAvg)}</div>
      <div class="stat-card"><span>Today's tasks</span><b>${done}/${todays.length}</b><small class="muted">completed</small></div>
      <div class="stat-card"><span>Active goals</span><b>${data.yearly.length}</b><small class="muted">yearly goals</small></div>
      <div class="stat-card"><span>Notes</span><b>${data.notes.length}</b><small class="muted">saved ideas</small></div>
    </div>

    <div class="dashboard-grid">
      <div class="grid">
        <div class="card">
          <div class="card-title"><h3>🎯 Yearly Goals</h3><button class="ghost-btn" data-add-type="yearly">＋ New goal</button></div>
          <div class="grid grid-2">${data.yearly.map(g=>`
            <div class="goal-card">
              <div class="stat-row"><span class="badge cyan">YEARLY</span><b>${pct(g.progress)}%</b></div>
              <h3>${esc(g.title)}</h3><div class="goal-meta">${esc(g.start)} → ${esc(g.end)}</div>
              ${progressBar(g.progress)}
              <div class="roadmap">${g.steps.map((s,i)=>`<div class="step ${i<g.current?"done":i===g.current?"current":""}">
                <div class="step-dot">${i<g.current?"✓":i+1}</div><small>${esc(s)}</small>
              </div>${i<g.steps.length-1?'<div class="step-line"></div>':""}`).join("")}</div>
            </div>`).join("")}</div>
        </div>
        <div class="card">
          <div class="card-title"><h3>📅 This Week</h3><button class="ghost-btn" data-view-btn="weekly">View all</button></div>
          <div class="list-card">${data.weekly.slice(0,4).map(w=>`
            <div class="list-item"><div><div class="title">${esc(w.title)}</div><div class="desc">${esc(w.week)} · ${w.progress}% complete</div></div>${progressBar(w.progress)}</div>`).join("")}</div>
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <div class="card-title"><h3>☀ Today's Tasks</h3><span class="badge">${done}/${todays.length}</span></div>
          <div class="task-list">${todays.length?todays.map(taskHTML).join(""):`<div class="empty"><div class="empty-icon">✓</div>No tasks today.</div>`}</div>
          <button class="primary-btn" style="margin-top:12px;width:100%" data-add-type="task">＋ Add task</button>
        </div>
        <div class="card">
          <div class="card-title"><h3>📝 Recent Notes</h3><button class="ghost-btn" data-view-btn="notes">Open</button></div>
          <div class="list-card">${data.notes.slice(0,3).map(n=>`<div class="list-item"><div><div class="title">${esc(n.title)}</div><div class="desc">${esc(n.body.slice(0,90))}${n.body.length>90?"…":""}</div></div><span class="badge cyan">${esc(n.folder)}</span></div>`).join("")}</div>
        </div>
      </div>
    </div>`;
}

function renderYearly() {
  return `<div class="page-head"><div><div class="eyebrow">Long-term planning</div><h1>Yearly Goals</h1><p>Turn big ambitions into a clear roadmap.</p></div><button class="primary-btn" data-add-type="yearly">＋ Add yearly goal</button></div>
  <div class="section-grid">${data.yearly.map(g=>`
    <div class="card goal-card">
      <div class="stat-row"><span class="badge cyan">2026</span><b>${g.progress}%</b></div>
      <h3>${esc(g.title)}</h3><div class="goal-meta">${esc(g.start)} → ${esc(g.end)}</div>
      <p class="muted small">${esc(g.description)}</p>${progressBar(g.progress)}
      <div class="roadmap">${g.steps.map((s,i)=>`<div class="step ${i<g.current?"done":i===g.current?"current":""}"><div class="step-dot">${i<g.current?"✓":i+1}</div><small>${esc(s)}</small></div>${i<g.steps.length-1?'<div class="step-line"></div>':""}`).join("")}</div>
      <div class="media-row"><span class="media-chip">🖼 Attachments</span><span class="media-chip">🎙 Voice note</span><span class="media-chip">🔗 Links</span></div>
      <p class="small muted" style="margin-bottom:0">📝 ${esc(g.note)}</p>
      <div class="list-actions" style="margin-top:12px"><button class="ghost-btn" data-edit-type="yearly" data-id="${g.id}">Edit</button><button class="ghost-btn" data-delete-type="yearly" data-id="${g.id}">Delete</button></div>
    </div>`).join("")}</div>`;
}

function renderMonthly() {
  const month = "2026-08";
  return `<div class="page-head"><div><div class="eyebrow">Break it down</div><h1>Monthly Goals</h1><p>Monthly targets connected to your yearly direction.</p></div><button class="primary-btn" data-add-type="monthly">＋ Add monthly goal</button></div>
  <div class="section-grid">${data.monthly.map(m=>{const parent=data.yearly.find(y=>y.id===m.parent); return `<div class="card">
    <div class="stat-row"><span class="badge cyan">${m.month}</span><b>${m.progress}%</b></div><h3>${esc(m.title)}</h3><div class="goal-meta">↳ ${esc(parent?.title||"No parent goal")}</div>
    ${progressBar(m.progress)}<p class="small muted">${esc(m.note)}</p>
    <div class="list-actions"><button class="ghost-btn" data-edit-type="monthly" data-id="${m.id}">Edit</button><button class="ghost-btn" data-delete-type="monthly" data-id="${m.id}">Delete</button></div>
  </div>`}).join("")}</div>`;
}

function renderWeekly() {
  return `<div class="page-head"><div><div class="eyebrow">Short-term focus</div><h1>Weekly Goals</h1><p>Focus your week on a few meaningful outcomes.</p></div><button class="primary-btn" data-add-type="weekly">＋ Add weekly goal</button></div>
  <div class="section-grid">${data.weekly.map(w=>{const parent=data.monthly.find(m=>m.id===w.parent); return `<div class="card">
    <div class="stat-row"><span class="badge yellow">${esc(w.week)}</span><b>${w.progress}%</b></div><h3>${esc(w.title)}</h3><div class="goal-meta">↳ ${esc(parent?.title||"No parent goal")}</div>
    ${progressBar(w.progress)}<p class="small muted">${esc(w.note)}</p>
    <div class="list-actions"><button class="ghost-btn" data-edit-type="weekly" data-id="${w.id}">Edit</button><button class="ghost-btn" data-delete-type="weekly" data-id="${w.id}">Delete</button></div>
  </div>`}).join("")}</div>`;
}

function renderDaily() {
  const date = window.dailyDate || todayISO();
  const tasks = data.tasks.filter(t=>t.date===date);
  return `<div class="page-head"><div><div class="eyebrow">Execution</div><h1>Daily Tasks</h1><p>${new Date(date+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p></div><button class="primary-btn" data-add-type="task">＋ Add task</button></div>
  <div class="toolbar"><button class="filter-btn" id="prevDay">←</button><input id="dailyDate" type="date" value="${date}" style="background:#101a2d;color:white;border:1px solid var(--line);padding:8px;border-radius:8px"><button class="filter-btn" id="nextDay">→</button></div>
  <div class="card"><div class="toolbar"><span class="badge">ALL</span><span class="badge red">HIGH</span><span class="badge green">COMPLETED</span></div>
  <div class="task-list">${tasks.length?tasks.map(taskHTML).join(""):`<div class="empty"><div class="empty-icon">☀</div>Your day is clear. Add something meaningful.</div>`}</div></div>`;
}

function renderNotes() {
  const folder = window.noteFolder || "All Notes";
  const visible = data.notes.filter(n => folder === "All Notes" || n.folder === folder);
  const selected = data.notes.find(n => n.id===selectedNoteId) || visible[0] || data.notes[0];

  if (selected) selectedNoteId = selected.id;

  const noteList = visible.map(n => `
    <button class="note-list-item ${n.id===selected?.id?"active":""}" data-select-note="${n.id}">
      <span class="note-list-icon">${(n.media||[]).some(m=>m.type.startsWith("audio/"))?"🎙":(n.media||[]).some(m=>m.type.startsWith("image/"))?"🖼":"📝"}</span>
      <span class="note-list-copy">
        <b>${esc(n.title || "Untitled")}</b>
        <small>${esc((n.body||"").replace(/\s+/g," ").slice(0,58) || "No content yet")}</small>
      </span>
    </button>`).join("");

  return `<div class="page-head">
    <div><div class="eyebrow">Capture everything</div><h1>Notes</h1><p>Write, record, attach images and keep everything in one place.</p></div>
    <button class="primary-btn" id="newNote">＋ New note</button>
  </div>

  <div class="card notes-layout">
    <aside class="note-folders">
      ${data.folders.map(f=>`<button class="folder ${folder===f?"active":""}" data-folder="${esc(f)}">📁 ${esc(f)}</button>`).join("")}
    </aside>

    <div class="note-list-panel">
      <div class="note-list-head"><span>${visible.length} notes</span><span class="muted small">Local & private</span></div>
      <div class="note-list">${noteList || `<div class="empty small"><div class="empty-icon">📝</div>No notes here yet.</div>`}</div>
    </div>

    <div class="note-editor">
      ${selected ? `
        <div class="note-editor-head">
          <div>
            <span class="badge cyan">${esc(selected.folder)}</span>
            <span class="muted small" id="noteSaveState">Saved ${esc(selected.updated || todayISO())}</span>
          </div>
          <button class="ghost-btn" data-delete-type="note" data-id="${selected.id}">🗑 Delete</button>
        </div>

        <input class="note-title-input" id="noteTitle" value="${esc(selected.title)}" placeholder="Note title" />
        <textarea class="note-body" id="noteBody" placeholder="Start writing...">${esc(selected.body)}</textarea>

        <div class="note-meta-row">
          <label class="note-folder-select">Folder
            <select id="noteFolderSelect">
              ${data.folders.filter(x=>x!=="All Notes").map(f=>`<option value="${esc(f)}" ${selected.folder===f?"selected":""}>${esc(f)}</option>`).join("")}
            </select>
          </label>
          <input class="note-tags-input" id="noteTags" value="${esc(selected.tags.join(", "))}" placeholder="Tags: Ideas, Work, SQL" />
        </div>

        <input id="noteImageInput" type="file" accept="image/*" multiple hidden>
        <input id="noteFileInput" type="file" multiple hidden>

        <div class="media-toolbar">
          <button class="media-chip media-action" data-note-action="image">🖼 Add image</button>
          <button class="media-chip media-action" data-note-action="voice">🎙 Record voice</button>
          <button class="media-chip media-action" data-note-action="file">📎 Attach file</button>
        </div>

        <div class="note-attachments" id="noteAttachments">
          <div class="muted small">Loading attachments…</div>
        </div>
      ` : `
        <div class="empty"><div class="empty-icon">📝</div>Create your first note.</div>
      `}
    </div>
  </div>`;
}

function renderProgress() {
  const avg = data.yearly.length ? Math.round(data.yearly.reduce((a,g)=>a+g.progress,0)/data.yearly.length) : 0;
  const taskDone = data.tasks.filter(t=>t.done).length;
  return `<div class="page-head"><div><div class="eyebrow">See the momentum</div><h1>Progress</h1><p>Your goals are moving forward one step at a time.</p></div></div>
  <div class="stats"><div class="stat-card"><span>Overall</span><b>${avg}%</b>${progressBar(avg)}</div><div class="stat-card"><span>Tasks done</span><b>${taskDone}</b></div><div class="stat-card"><span>Monthly avg</span><b>${data.monthly.length?Math.round(data.monthly.reduce((a,x)=>a+x.progress,0)/data.monthly.length):0}%</b></div><div class="stat-card"><span>Weekly avg</span><b>${data.weekly.length?Math.round(data.weekly.reduce((a,x)=>a+x.progress,0)/data.weekly.length):0}%</b></div></div>
  <div class="card"><div class="card-title"><h3>Goal progress</h3><span class="pixel-label">2026</span></div><div class="list-card">${data.yearly.map(g=>`<div class="list-item"><div style="min-width:180px"><div class="title">${esc(g.title)}</div><div class="desc">${g.progress}% complete</div></div><div style="flex:1">${progressBar(g.progress)}</div><b>${g.progress}%</b></div>`).join("")}</div></div>`;
}

function renderCalendar() {
  const now = new Date(); const y=now.getFullYear(), m=now.getMonth();
  const first=new Date(y,m,1).getDay(); const days=new Date(y,m+1,0).getDate();
  let cells="";
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d=>cells+=`<div class="cal-head">${d}</div>`);
  for(let i=0;i<first;i++) cells+=`<div class="cal-day"></div>`;
  for(let d=1;d<=days;d++){
    const iso=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const events=data.tasks.filter(t=>t.date===iso).slice(0,3);
    cells+=`<div class="cal-day ${iso===todayISO()?"today":""}"><b>${d}</b>${events.map(e=>`<div class="cal-event">${esc(e.title)}</div>`).join("")}</div>`;
  }
  return `<div class="page-head"><div><div class="eyebrow">Plan visually</div><h1>Calendar</h1><p>Tasks and deadlines at a glance.</p></div></div><div class="card calendar-wrap"><div class="calendar">${cells}</div></div>`;
}

function renderSettings() {
  return `<div class="page-head"><div><div class="eyebrow">Customize your workspace</div><h1>Settings</h1><p>Keep the planner comfortable and yours.</p></div></div>
  <div class="section-grid">
    <div class="card"><div class="card-title"><h3>Appearance</h3></div><div class="list-item"><div><div class="title">Dark workspace</div><div class="desc">The default focused theme.</div></div><span class="badge green">ON</span></div></div>
    <div class="card"><div class="card-title"><h3>Data</h3></div><button class="ghost-btn" id="exportData">Export planner JSON</button> <button class="ghost-btn" id="resetData">Reset demo data</button></div>
  </div>`;
}

function openModal(html) { document.getElementById("modal").innerHTML=html; document.getElementById("modalBackdrop").classList.remove("hidden"); }
function closeModal() { document.getElementById("modalBackdrop").classList.add("hidden"); }

function goalForm(type, existing={}) {
  const isYear=type==="yearly";
  const isMonth=type==="monthly";
  const isWeek=type==="weekly";
  const collection=isYear?"yearly":isMonth?"monthly":"weekly";
  const title=isYear?"Yearly goal":isMonth?"Monthly goal":"Weekly goal";
  return `<div class="modal-head"><h2>${existing.id?"Edit":"Add"} ${title}</h2><button class="icon-btn" id="closeModal">×</button></div>
  <form id="entityForm" class="form-grid">
    <div class="field full"><label>Title</label><input name="title" required value="${esc(existing.title||"")}" placeholder="e.g. Build my portfolio" /></div>
    ${isYear?`<div class="field"><label>Start date</label><input name="start" type="date" value="${existing.start||"2026-01-01"}"></div><div class="field"><label>End date</label><input name="end" type="date" value="${existing.end||"2026-12-31"}"></div>
    <div class="field full"><label>Roadmap steps (comma separated)</label><input name="steps" value="${esc((existing.steps||[]).join(", "))}" placeholder="Research, Build, Test, Launch"></div>`:""}
    ${isMonth?`<div class="field"><label>Month</label><input name="month" type="month" value="${existing.month||"2026-08"}"></div><div class="field"><label>Parent yearly goal</label><select name="parent">${data.yearly.map(y=>`<option value="${y.id}" ${existing.parent===y.id?"selected":""}>${esc(y.title)}</option>`).join("")}</select></div>`:""}
    ${isWeek?`<div class="field"><label>Week</label><input name="week" value="${esc(existing.week||"2026-W32")}"></div><div class="field"><label>Parent monthly goal</label><select name="parent">${data.monthly.map(m=>`<option value="${m.id}" ${existing.parent===m.id?"selected":""}>${esc(m.title)}</option>`).join("")}</select></div>`:""}
    <div class="field"><label>Progress %</label><input name="progress" type="number" min="0" max="100" value="${existing.progress??0}"></div>
    <div class="field full"><label>Plan / Notes</label><textarea name="note" placeholder="How will you execute this?">${esc(existing.note||"")}</textarea></div>
    <div class="field full"><button class="primary-btn" type="submit">Save ${type} goal</button></div>
  </form>`;
}

function taskForm(existing={}) {
  return `<div class="modal-head"><h2>${existing.id?"Edit":"Add"} daily task</h2><button class="icon-btn" id="closeModal">×</button></div>
  <form id="entityForm" class="form-grid">
    <div class="field full"><label>Task</label><input name="title" required value="${esc(existing.title||"")}" placeholder="What needs to get done?"></div>
    <div class="field"><label>Date</label><input name="date" type="date" value="${existing.date||todayISO()}"></div>
    <div class="field"><label>Time</label><input name="time" type="time" value="${existing.time||""}"></div>
    <div class="field"><label>Priority</label><select name="priority">${["high","medium","low"].map(x=>`<option ${existing.priority===x?"selected":""}>${x}</option>`).join("")}</select></div>
    <div class="field"><label>Tag</label><input name="tag" value="${esc(existing.tag||"General")}"></div>
    <div class="field full"><button class="primary-btn" type="submit">Save task</button></div>
  </form>`;
}

function noteForm() {
  return `<div class="modal-head"><h2>New note</h2><button class="icon-btn" id="closeModal">×</button></div>
  <form id="entityForm" class="form-grid"><div class="field full"><label>Title</label><input name="title" required placeholder="Note title"></div>
  <div class="field"><label>Folder</label><select name="folder">${data.folders.filter(x=>x!=="All Notes").map(x=>`<option>${esc(x)}</option>`).join("")}</select></div>
  <div class="field"><label>Tags</label><input name="tags" placeholder="Ideas, Work, SQL"></div>
  <div class="field full"><label>Content</label><textarea name="body" placeholder="Write your note..."></textarea></div>
  <div class="field full"><button class="primary-btn" type="submit">Create note</button></div></form>`;
}

function openCreate(type, existing={}) {
  if(type==="task") openModal(taskForm(existing));
  else if(type==="note") openModal(noteForm());
  else openModal(goalForm(type, existing));
  document.getElementById("closeModal")?.addEventListener("click", closeModal);
  document.getElementById("entityForm")?.addEventListener("submit", e=>handleForm(e,type,existing));
}
function handleForm(e,type,existing) {
  e.preventDefault(); const fd=new FormData(e.target); const o=Object.fromEntries(fd.entries());
  if(type==="task"){
    const item={id:existing.id||uid("t"),title:o.title,date:o.date,time:o.time,priority:o.priority,tag:o.tag,done:existing.done||false};
    if(existing.id) data.tasks=data.tasks.map(x=>x.id===existing.id?item:x); else data.tasks.push(item);
  } else if(type==="note"){
    data.notes.unshift({id:uid("n"),folder:o.folder,title:o.title,body:o.body,tags:o.tags.split(",").map(x=>x.trim()).filter(Boolean),media:[],updated:todayISO()});
    selectedNoteId=data.notes[0].id;
  } else {
    const item={...existing,id:existing.id||uid(type[0]),title:o.title,progress:Number(o.progress)||0,note:o.note};
    if(type==="yearly") Object.assign(item,{start:o.start,end:o.end,steps:o.steps.split(",").map(x=>x.trim()).filter(Boolean),current:existing.current||0,description:existing.description||o.note});
    if(type!=="yearly") Object.assign(item,{parent:o.parent,[type==="monthly"?"month":"week"]:o[type==="monthly"?"month":"week"]});
    data[type]=existing.id?data[type].map(x=>x.id===existing.id?item:x):[...data[type],item];
  }
  save(); closeModal(); render(); showToast("Saved successfully");
}

async function deleteEntity(type,id){
  if(!confirm("Delete this item?")) return;
  if(type==="note"){
    const note=data.notes.find(x=>x.id===id);
    await deleteNoteMedia(note);
    data.notes=data.notes.filter(x=>x.id!==id);
    if(selectedNoteId===id) selectedNoteId=data.notes[0]?.id||null;
  } else {
    data[type]=data[type].filter(x=>x.id!==id);
  }
  save(); render(); showToast("Deleted");
}

function bindViewEvents() {
  document.querySelectorAll("[data-view-btn]").forEach(b=>b.onclick=()=>setView(b.dataset.viewBtn));
  document.querySelectorAll("[data-add-type]").forEach(b=>b.onclick=()=>openCreate(b.dataset.addType));
  document.querySelectorAll("[data-edit-type]").forEach(b=>b.onclick=()=>openCreate(b.dataset.editType, data[b.dataset.editType].find(x=>x.id===b.dataset.id)));
  document.querySelectorAll("[data-delete-type]").forEach(b=>b.onclick=()=>deleteEntity(b.dataset.deleteType,b.dataset.id));
  document.querySelectorAll("[data-task-toggle]").forEach(b=>b.onclick=()=>{const t=data.tasks.find(x=>x.id===b.dataset.taskToggle);if(t){t.done=!t.done;save();render();}});
  document.querySelectorAll("[data-folder]").forEach(b=>b.onclick=()=>{window.noteFolder=b.dataset.folder;render();});
  document.querySelectorAll("[data-select-note]").forEach(b=>b.onclick=()=>{selectedNoteId=b.dataset.selectNote;render();});

  const nt=document.getElementById("noteTitle");
  const nb=document.getElementById("noteBody");
  const tags=document.getElementById("noteTags");
  const folderSelect=document.getElementById("noteFolderSelect");

  const autosaveNote = () => {
    const n=data.notes.find(x=>x.id===selectedNoteId);
    if(!n) return;
    n.title=nt?.value?.trim() || "Untitled note";
    n.body=nb?.value || "";
    n.tags=(tags?.value||"").split(",").map(x=>x.trim()).filter(Boolean);
    n.updated=todayISO();
    save();
    const state=document.getElementById("noteSaveState");
    if(state) state.textContent="Saved just now";
  };

  if(nt && selectedNoteId){
    let timer;
    const schedule=()=>{
      clearTimeout(timer);
      const state=document.getElementById("noteSaveState");
      if(state) state.textContent="Saving…";
      timer=setTimeout(autosaveNote,350);
    };
    nt.oninput=schedule;
    nb.oninput=schedule;
    tags.oninput=schedule;
    folderSelect.onchange=()=>{
      const n=data.notes.find(x=>x.id===selectedNoteId);
      if(!n)return;
      n.folder=folderSelect.value;
      n.updated=todayISO();
      save();
      render();
    };
  }

  document.getElementById("newNote")?.addEventListener("click",()=>openCreate("note"));
  document.getElementById("dailyDate")?.addEventListener("change",e=>{window.dailyDate=e.target.value;render();});
  document.getElementById("prevDay")?.addEventListener("click",()=>changeDay(-1));
  document.getElementById("nextDay")?.addEventListener("click",()=>changeDay(1));
  document.getElementById("exportData")?.addEventListener("click",exportData);
  document.getElementById("resetData")?.addEventListener("click",()=>{if(confirm("Reset all planner data to the demo?")){data=structuredClone(defaultData);save();render();showToast("Demo data restored");}});

  document.querySelector('[data-note-action="image"]')?.addEventListener("click",()=>document.getElementById("noteImageInput")?.click());
  document.querySelector('[data-note-action="file"]')?.addEventListener("click",()=>document.getElementById("noteFileInput")?.click());
  document.querySelector('[data-note-action="voice"]')?.addEventListener("click",()=>startNoteVoice(selectedNoteId));

  document.getElementById("noteImageInput")?.addEventListener("change",e=>handleNoteFiles([...e.target.files], true));
  document.getElementById("noteFileInput")?.addEventListener("change",e=>handleNoteFiles([...e.target.files], false));

  if(selectedNoteId) hydrateNoteMedia(selectedNoteId);
}
async function handleNoteFiles(files, imagesOnly=false){
  const note=data.notes.find(n=>n.id===selectedNoteId);
  if(!note || !files.length) return;
  noteMediaList(note);

  try{
    for(const file of files){
      if(imagesOnly && !file.type.startsWith("image/")) continue;
      const id=await mediaPut(file,{name:file.name,type:file.type});
      note.media.push({id,name:file.name,type:file.type,size:file.size,created:todayISO()});
    }
    note.updated=todayISO();
    save();
    render();
    showToast(`${files.length} attachment${files.length>1?"s":""} added`);
  }catch(err){
    console.error(err);
    showToast("Could not save the attachment.");
  }
}

async function hydrateNoteMedia(noteId){
  const box=document.getElementById("noteAttachments");
  const note=data.notes.find(n=>n.id===noteId);
  if(!box || !note) return;

  const items=[];
  for(const meta of (note.media||[])){
    const record=await mediaGet(meta.id).catch(()=>null);
    if(!record) continue;
    const url=URL.createObjectURL(record.blob);
    items.push({meta,record,url});
  }

  if(!items.length){
    box.innerHTML='<div class="attachment-empty">No attachments yet. Add an image, record a voice note, or attach a file.</div>';
    return;
  }

  box.innerHTML=items.map(({meta,record,url})=>{
    if(meta.type?.startsWith("image/")){
      return `<div class="attachment-card image-attachment">
        <img src="${url}" alt="${esc(meta.name)}" data-open-media="${meta.id}" data-media-url="${url}">
        <div class="attachment-info"><b>${esc(meta.name)}</b><small>${formatBytes(meta.size)}</small></div>
        <button class="attachment-delete" data-remove-media="${meta.id}" title="Remove">×</button>
      </div>`;
    }

    if(meta.type?.startsWith("audio/")){
      return `<div class="attachment-card audio-attachment">
        <div class="attachment-icon">🎙</div>
        <div class="attachment-info"><b>${esc(meta.name)}</b><small>${formatBytes(meta.size)}</small><audio controls preload="metadata" src="${url}"></audio></div>
        <button class="attachment-delete" data-remove-media="${meta.id}" title="Remove">×</button>
      </div>`;
    }

    return `<div class="attachment-card file-attachment">
      <div class="attachment-icon">📎</div>
      <div class="attachment-info"><b>${esc(meta.name)}</b><small>${formatBytes(meta.size)}</small></div>
      <a class="ghost-btn attachment-open" href="${url}" target="_blank" rel="noopener">Open</a>
      <button class="attachment-delete" data-remove-media="${meta.id}" title="Remove">×</button>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-remove-media]").forEach(btn=>{
    btn.onclick=async()=>{
      const id=btn.dataset.removeMedia;
      await mediaDelete(id).catch(()=>{});
      note.media=note.media.filter(m=>m.id!==id);
      note.updated=todayISO();
      save();
      render();
      showToast("Attachment removed");
    };
  });

  box.querySelectorAll("[data-open-media]").forEach(img=>{
    img.onclick=()=>{
      openModal(`<div class="modal-head"><h2>${esc(img.alt)}</h2><button class="icon-btn" id="closeModal">×</button></div>
        <img class="image-viewer" src="${img.dataset.mediaUrl}" alt="${esc(img.alt)}">
        <div style="margin-top:12px"><button class="ghost-btn" id="closeViewer">Close</button></div>`);
      document.getElementById("closeModal")?.addEventListener("click",closeModal);
      document.getElementById("closeViewer")?.addEventListener("click",closeModal);
    };
  });
}

async function startNoteVoice(noteId){
  if(mediaRecorder?.state==="recording"){
    showToast("A recording is already in progress.");
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==="undefined"){
    showToast("Voice recording is not supported here.");
    return;
  }

  const note=data.notes.find(n=>n.id===noteId);
  if(!note) return;

  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimeTypes=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"];
    const mimeType=mimeTypes.find(t=>MediaRecorder.isTypeSupported?.(t))||"";
    mediaRecorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    audioChunks=[];
    recordingNoteId=noteId;

    mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data);};
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const id=await mediaPut(blob,{name:`Voice note · ${new Date().toLocaleString()}`,type:blob.type});
      noteMediaList(note).push({id,name:`Voice note · ${new Date().toLocaleString()}`,type:blob.type,size:blob.size,created:todayISO()});
      note.tags=[...new Set([...(note.tags||[]),"Voice"])];
      note.updated=todayISO();
      recordingNoteId=null;
      save();
      render();
      showToast("Voice recording saved to this note");
    };

    mediaRecorder.start();
    showToast("Recording… press the mic again to stop");
  }catch(err){
    console.error(err);
    showToast("Microphone permission was denied or unavailable.");
  }
}

function changeDay(delta){const d=new Date((window.dailyDate||todayISO())+"T12:00:00");d.setDate(d.getDate()+delta);window.dailyDate=d.toISOString().slice(0,10);render();}
function updateSidebarProgress(){const avg=data.yearly.length?Math.round(data.yearly.reduce((a,g)=>a+pct(g.progress),0)/data.yearly.length):0;document.getElementById("sidebarProgress").textContent=avg+"%";updateLives(avg);}
function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="my-planner-backup.json";a.click();URL.revokeObjectURL(a.href);}

async function startVoice() {
  if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==="undefined"){
    showToast("Voice recording is not supported here.");
    return;
  }

  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimeTypes=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"];
    const mimeType=mimeTypes.find(t=>MediaRecorder.isTypeSupported?.(t))||"";
    mediaRecorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    audioChunks=[];
    recordingNoteId=null;

    mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data);};
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const url=URL.createObjectURL(blob);

      openModal(`<div class="modal-head"><h2>Quick voice note</h2><button class="icon-btn" id="closeModal">×</button></div>
        <p class="muted">Preview your recording, then save it as a real attachment.</p>
        <audio controls playsinline style="width:100%" src="${url}"></audio>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="ghost-btn" id="discardVoice">Discard</button>
          <button class="primary-btn" id="saveVoice">Save to Notes</button>
        </div>`);

      document.getElementById("closeModal").onclick=()=>{URL.revokeObjectURL(url);closeModal();};
      document.getElementById("discardVoice").onclick=()=>{URL.revokeObjectURL(url);closeModal();showToast("Recording discarded");};
      document.getElementById("saveVoice").onclick=async()=>{
        const note={
          id:uid("n"), folder:"Personal",
          title:"Voice note · "+new Date().toLocaleString(),
          body:"Voice recording attached.",
          tags:["Voice"], media:[], updated:todayISO()
        };
        data.notes.unshift(note);
        const id=await mediaPut(blob,{name:note.title,type:blob.type});
        note.media.push({id,name:note.title,type:blob.type,size:blob.size,created:todayISO()});
        selectedNoteId=note.id;
        save();
        URL.revokeObjectURL(url);
        closeModal();
        setView("notes");
        showToast("Voice note saved");
      };
    };

    mediaRecorder.start();
    updateVoiceButton?.(true);
    showToast("Recording… click the mic again to stop");
  }catch(err){
    console.error(err);
    showToast("Microphone permission was denied or unavailable.");
  }
}

document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
document.getElementById("goalsToggle").onclick=()=>document.getElementById("goalsSubnav").classList.toggle("open");
document.getElementById("openSidebar").onclick=()=>document.getElementById("sidebar").classList.add("open");
document.getElementById("closeSidebar").onclick=()=>document.getElementById("sidebar").classList.remove("open");
document.getElementById("quickAdd").onclick=()=>openCreate("task");
document.getElementById("quickVoice").onclick=()=>{if(mediaRecorder?.state==="recording"){mediaRecorder.stop();updateVoiceButton?.(false);}else startVoice();};
document.getElementById("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal();});
document.getElementById("globalSearch").addEventListener("input",e=>{
  const q=e.target.value.trim().toLowerCase(); if(!q)return;
  const matches=[...data.yearly,...data.monthly,...data.weekly,...data.tasks,...data.notes].filter(x=>(x.title||"").toLowerCase().includes(q));
  if(matches.length){showToast(`${matches.length} match${matches.length>1?"es":""} found`);}
});
render();


/* =========================================================
   UVUZ MOTION ENGINE — page transitions + tiny UX details
========================================================= */
(function initMotionEngine(){
  const root=document.getElementById("content");
  const topbar=document.querySelector(".topbar");
  if(!root)return;

  // Animate view changes without interfering with the existing render system.
  const originalRender=window.render;
  if(typeof originalRender==="function"){
    window.render=function(){
      root.classList.remove("view-enter","view-leave");
      void root.offsetWidth;
      originalRender.apply(this,arguments);
      root.classList.add("view-enter");
      setTimeout(()=>root.classList.remove("view-enter"),550);
    };
  }

  // Sticky header gets a subtle depth change after scrolling.
  const onScroll=()=>{
    if(topbar) topbar.classList.toggle("scrolled",window.scrollY>8);
  };
  window.addEventListener("scroll",onScroll,{passive:true});
  onScroll();

  // Ripple feedback for clickable controls.
  document.addEventListener("click",e=>{
    const target=e.target.closest("button,.filter-btn,.media-chip.media-action,.nav-list-item");
    if(!target || target.disabled)return;
    const rect=target.getBoundingClientRect();
    const ripple=document.createElement("span");
    ripple.className="uvuz-ripple";
    ripple.style.left=(e.clientX-rect.left)+"px";
    ripple.style.top=(e.clientY-rect.top)+"px";
    target.appendChild(ripple);
    setTimeout(()=>ripple.remove(),500);
  });

  // Gentle reveal for dynamically-rendered cards/items.
  const observer=new MutationObserver(()=>{
    const nodes=root.querySelectorAll(".card,.stat-card,.list-item,.task,.note-list-item,.attachment-card");
    nodes.forEach((el,i)=>{
      if(el.dataset.motionReady)return;
      el.dataset.motionReady="1";
      el.style.setProperty("--delay",Math.min(i*35,280)+"ms");
      el.classList.add("motion-item");
    });
  });
  observer.observe(root,{childList:true,subtree:true});
})();

// Add ripple styles from JS so the feature stays self-contained.
const motionStyle=document.createElement("style");
motionStyle.textContent=`
  button,.filter-btn,.media-chip.media-action{position:relative;overflow:hidden}
  .uvuz-ripple{position:absolute;width:10px;height:10px;border-radius:50%;pointer-events:none;
    background:rgba(255,255,255,.28);transform:translate(-50%,-50%) scale(0);
    animation:uvuzRipple .5s ease-out forwards}
  .motion-item{animation:itemReveal .45s var(--ease-out) var(--delay) both}
  @keyframes uvuzRipple{to{transform:translate(-50%,-50%) scale(22);opacity:0}}
  @keyframes itemReveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;
document.head.appendChild(motionStyle);

/* ===== FINAL MICRO-INTERACTIONS ===== */
(() => {
  const root = document.documentElement;

  const updateScrollState = () => {
    root.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', updateScrollState, { passive: true });
  updateScrollState();

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('button, .btn, [role="button"]');
    if (!target) return;
    target.classList.add('is-pressed');
    window.setTimeout(() => target.classList.remove('is-pressed'), 140);
  }, { passive: true });
})();
