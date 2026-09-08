/* مصلى العياش - تحصيل الاشتراكات
   كل البيانات محفوظة محليًا على الجهاز فقط (localStorage). لا يوجد سيرفر ولا اشتراك. */

const STORAGE_KEY = "musalla_data_v1";

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error("تعذر قراءة البيانات", e); }
  return {
    members: [],
    payments: {}, // weekKey -> { memberId: { amount, paidAt } }
    settings: {
      weekStartDay: 6, // السبت افتراضيًا (بداية أسبوع الجامعة)
      amount: 0.5,
      currency: "دينار",
      lastSeenWeek: null,
      notifiedWeeks: []
    }
  };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();

/* ---------- حساب الأسبوع الحالي ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekStart(refDate = new Date()) {
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const startDay = state.settings.weekStartDay;
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function currentWeekKey() {
  return dateKey(getWeekStart());
}

function weekLabel(weekKey) {
  const start = new Date(weekKey);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatDateArabic(iso) {
  const d = new Date(iso);
  const dayName = DAY_NAMES[d.getDay()];
  const date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const time = d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  return `${dayName} ${date} - ${time}`;
}

/* ---------- الأعضاء والدفعات ---------- */

function activeMembers() {
  return state.members.filter(m => m.active);
}

function isPaid(memberId, weekKey = currentWeekKey()) {
  return !!(state.payments[weekKey] && state.payments[weekKey][memberId]);
}

function recordPayment(memberId, amount) {
  const wk = currentWeekKey();
  if (!state.payments[wk]) state.payments[wk] = {};
  state.payments[wk][memberId] = { amount, paidAt: new Date().toISOString() };
  saveData();
  render();
}

function removePayment(memberId, weekKey = currentWeekKey()) {
  if (state.payments[weekKey]) {
    delete state.payments[weekKey][memberId];
    saveData();
    render();
  }
}

function addMember(name) {
  name = name.trim();
  if (!name) return;
  state.members.push({ id: crypto.randomUUID(), name, active: true, createdAt: new Date().toISOString() });
  saveData();
  render();
}

function archiveMember(id) {
  const m = state.members.find(x => x.id === id);
  if (m) { m.active = false; saveData(); render(); }
}

function restoreMember(id) {
  const m = state.members.find(x => x.id === id);
  if (m) { m.active = true; saveData(); render(); }
}

function deleteMemberForever(id) {
  state.members = state.members.filter(x => x.id !== id);
  Object.values(state.payments).forEach(wk => delete wk[id]);
  saveData();
  render();
}

/* ---------- الإحصائيات ---------- */

function weekTotal(weekKey) {
  const wk = state.payments[weekKey];
  if (!wk) return 0;
  return Object.values(wk).reduce((s, p) => s + (p.amount || 0), 0);
}

function overallTotal() {
  return Object.keys(state.payments).reduce((s, wk) => s + weekTotal(wk), 0);
}

function memberHistory(memberId) {
  const rows = [];
  Object.keys(state.payments).sort().reverse().forEach(wk => {
    if (state.payments[wk][memberId]) rows.push({ week: wk, ...state.payments[wk][memberId] });
  });
  return rows;
}

/* ---------- التنبيهات ---------- */

async function ensureNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

async function fireNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", dir: "rtl", lang: "ar" });
    } else {
      new Notification(title, { body, icon: "icons/icon-192.png" });
    }
  } catch (e) { console.error(e); }
}

function checkWeeklyReminder(force = false) {
  const wk = currentWeekKey();
  const due = activeMembers().filter(m => !isPaid(m.id, wk));
  const alreadyNotified = state.settings.notifiedWeeks.includes(wk);

  if (state.settings.lastSeenWeek !== wk) {
    state.settings.lastSeenWeek = wk;
    saveData();
  }

  if ((force || !alreadyNotified) && due.length > 0 && activeMembers().length > 0) {
    const names = due.map(m => m.name).join("، ");
    fireNotification("حان وقت الاشتراك الأسبوعي 🕌", `دور الدفع هالأسبوع: ${names}`);
    if (!alreadyNotified) {
      state.settings.notifiedWeeks.push(wk);
      state.settings.notifiedWeeks = state.settings.notifiedWeeks.slice(-20);
      saveData();
    }
    return true;
  }
  return false;
}

/* ---------- الواجهة ---------- */

const els = {};

function qs(id) { return document.getElementById(id); }

function render() {
  renderHome();
  renderMembers();
  renderHistory();
  renderSettings();
}

function renderHome() {
  const wk = currentWeekKey();
  const members = activeMembers();
  const due = members.filter(m => !isPaid(m.id, wk));
  const paid = members.filter(m => isPaid(m.id, wk));

  qs("weekLabel").textContent = `أسبوع ${weekLabel(wk)}`;
  qs("statPaidCount").textContent = `${paid.length}/${members.length}`;
  qs("statWeekTotal").textContent = `${weekTotal(wk).toFixed(2)} ${state.settings.currency}`;

  const dueList = qs("dueList");
  const paidList = qs("paidList");
  dueList.innerHTML = "";
  paidList.innerHTML = "";

  if (members.length === 0) {
    qs("homeEmpty").style.display = "block";
  } else {
    qs("homeEmpty").style.display = "none";
  }

  due.forEach(m => {
    dueList.appendChild(memberRow(m, false));
  });
  paid.forEach(m => {
    paidList.appendChild(memberRow(m, true));
  });

  qs("dueSection").style.display = due.length ? "block" : "none";
  qs("paidSection").style.display = paid.length ? "block" : "none";
}

function memberRow(m, paid) {
  const row = document.createElement("div");
  row.className = "member-row";
  const history = memberHistory(m.id);
  const wk = currentWeekKey();
  const last = paid ? history.find(p => p.week !== wk) : history[0];
  const metaText = paid
    ? (last ? "قبلها دفع أسبوع " + weekLabel(last.week) : "أول دفعة إله")
    : (last ? "آخر دفعة: أسبوع " + weekLabel(last.week) : "لسا ما دفع أبدًا");
  row.innerHTML = `
    <div class="row-info" data-id="${m.id}" style="cursor:pointer; flex:1;">
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="meta">${metaText}</div>
    </div>
    <button class="pill ${paid ? "paid" : "due"}" data-id="${m.id}">${paid ? "✓ دفع" : "لسا"}</button>
  `;
  row.querySelector(".row-info").addEventListener("click", () => openMemberDetail(m.id));
  row.querySelector("button").addEventListener("click", () => openPayModal(m.id));
  return row;
}

function renderMembers() {
  const list = qs("membersList");
  list.innerHTML = "";
  const active = state.members.filter(m => m.active);
  const archived = state.members.filter(m => !m.active);

  if (state.members.length === 0) {
    qs("membersEmpty").style.display = "block";
  } else {
    qs("membersEmpty").style.display = "none";
  }

  active.forEach(m => {
    const row = document.createElement("div");
    row.className = "member-row";
    const total = memberHistory(m.id).reduce((s, p) => s + p.amount, 0);
    row.innerHTML = `
      <div class="row-info" data-id="${m.id}" style="cursor:pointer; flex:1;">
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="meta">مجموع الدفعات: ${total.toFixed(2)} ${state.settings.currency}</div>
      </div>
      <button class="pill secondary-pill" data-id="${m.id}" style="background:var(--surface-2);color:var(--text-dim);border:1px solid var(--border);">أرشفة</button>
    `;
    row.querySelector(".row-info").addEventListener("click", () => openMemberDetail(m.id));
    row.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); archiveMember(m.id); });
    list.appendChild(row);
  });

  if (archived.length) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "مؤرشفين";
    list.appendChild(title);
    archived.forEach(m => {
      const row = document.createElement("div");
      row.className = "member-row";
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="meta">مؤرشف</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="pill" data-act="restore" data-id="${m.id}" style="background:#163a2f;color:#7fe3b4;border:1px solid #235c47;">إرجاع</button>
          <button class="pill" data-act="delete" data-id="${m.id}" style="background:var(--danger-dim);color:#ff9a8a;border:1px solid #5a2c26;">حذف نهائي</button>
        </div>
      `;
      row.querySelector('[data-act="restore"]').addEventListener("click", () => restoreMember(m.id));
      row.querySelector('[data-act="delete"]').addEventListener("click", () => {
        if (confirm(`متأكد بدك تحذف ${m.name} نهائيًا؟ رح ينحذف سجل دفعاته كمان.`)) deleteMemberForever(m.id);
      });
      list.appendChild(row);
    });
  }
}

function renderHistory() {
  const list = qs("historyList");
  list.innerHTML = "";
  const weeks = Object.keys(state.payments).sort().reverse();

  qs("statOverallTotal").textContent = `${overallTotal().toFixed(2)} ${state.settings.currency}`;
  qs("statWeeksCount").textContent = weeks.length;

  if (weeks.length === 0) {
    qs("historyEmpty").style.display = "block";
    return;
  }
  qs("historyEmpty").style.display = "none";

  weeks.forEach(wk => {
    const payers = Object.keys(state.payments[wk])
      .map(id => state.members.find(m => m.id === id)?.name || "؟")
      .join("، ");
    const div = document.createElement("div");
    div.className = "history-week";
    div.innerHTML = `
      <div class="row1"><span>أسبوع ${weekLabel(wk)}</span><span>${weekTotal(wk).toFixed(2)} ${state.settings.currency}</span></div>
      <div class="row2">${payers || "-"}</div>
    `;
    list.appendChild(div);
  });
}

function renderSettings() {
  qs("amountInput").value = state.settings.amount;
  qs("weekStartSelect").value = state.settings.weekStartDay;
  qs("notifStatus").textContent =
    !("Notification" in window) ? "غير مدعوم بهالمتصفح" :
    Notification.permission === "granted" ? "مفعّلة ✓" :
    Notification.permission === "denied" ? "تم رفضها من إعدادات الجهاز" : "غير مفعّلة";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ---------- التبويبات ---------- */

function switchTab(tab) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("nav.tabbar button").forEach(b => b.classList.remove("active"));
  qs("panel-" + tab).classList.add("active");
  qs("tab-" + tab).classList.add("active");
}

/* ---------- نافذة إضافة عضو ---------- */

function openAddMemberModal() {
  qs("addMemberModal").classList.remove("hidden");
  qs("newMemberName").value = "";
  qs("newMemberName").focus();
}

function closeAddMemberModal() {
  qs("addMemberModal").classList.add("hidden");
}

/* ---------- نافذة تسجيل / تعديل دفعة ---------- */

let payModalMemberId = null;

function openPayModal(memberId) {
  const m = state.members.find(x => x.id === memberId);
  if (!m) return;
  payModalMemberId = memberId;
  const wk = currentWeekKey();
  const existing = state.payments[wk] && state.payments[wk][memberId];
  qs("payModalTitle").textContent = existing ? `تعديل دفعة ${m.name}` : `تسجيل دفعة ${m.name}`;
  qs("payAmountInput").value = existing ? existing.amount : state.settings.amount;
  qs("removePayBtn").style.display = existing ? "block" : "none";
  qs("payAmountModal").classList.remove("hidden");
}

function closePayModal() {
  qs("payAmountModal").classList.add("hidden");
  payModalMemberId = null;
}

/* ---------- نافذة تفاصيل الشخص ---------- */

function openMemberDetail(memberId) {
  const m = state.members.find(x => x.id === memberId);
  if (!m) return;
  const history = memberHistory(memberId);
  const total = history.reduce((s, p) => s + p.amount, 0);

  qs("detailName").textContent = m.name;
  qs("detailTotal").textContent = `${total.toFixed(2)} ${state.settings.currency}`;
  qs("detailCount").textContent = history.length;

  const list = qs("detailList");
  list.innerHTML = "";
  if (history.length === 0) {
    list.innerHTML = `<div class="empty">ما في دفعات مسجلة لهذا الشخص لسا.</div>`;
  } else {
    history.forEach(p => {
      const row = document.createElement("div");
      row.className = "history-week";
      row.innerHTML = `
        <div class="row1"><span>${formatDateArabic(p.paidAt)}</span><span>${p.amount.toFixed(2)} ${state.settings.currency}</span></div>
      `;
      list.appendChild(row);
    });
  }
  qs("memberDetailModal").classList.remove("hidden");
}

function closeMemberDetailModal() {
  qs("memberDetailModal").classList.add("hidden");
}

/* ---------- نسخ احتياطي ---------- */

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `musalla-backup-${dateKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.members || !parsed.payments || !parsed.settings) throw new Error("ملف غير صالح");
      state = parsed;
      saveData();
      render();
      showToast("تم استيراد النسخة الاحتياطية بنجاح");
    } catch (e) {
      alert("تعذر قراءة الملف. تأكد إنه ملف نسخة احتياطية صحيح.");
    }
  };
  reader.readAsText(file);
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- ربط الأحداث ---------- */

window.addEventListener("DOMContentLoaded", () => {
  render();

  qs("tab-home").addEventListener("click", () => switchTab("home"));
  qs("tab-members").addEventListener("click", () => switchTab("members"));
  qs("tab-history").addEventListener("click", () => switchTab("history"));
  qs("tab-settings").addEventListener("click", () => switchTab("settings"));

  qs("fabAdd").addEventListener("click", openAddMemberModal);
  qs("closeModalBtn").addEventListener("click", closeAddMemberModal);
  qs("addMemberModal").addEventListener("click", (e) => { if (e.target.id === "addMemberModal") closeAddMemberModal(); });

  qs("addMemberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    addMember(qs("newMemberName").value);
    closeAddMemberModal();
  });

  qs("closePayModalBtn").addEventListener("click", closePayModal);
  qs("payAmountModal").addEventListener("click", (e) => { if (e.target.id === "payAmountModal") closePayModal(); });

  qs("payAmountForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseFloat(qs("payAmountInput").value);
    if (!isNaN(v) && v >= 0 && payModalMemberId) {
      recordPayment(payModalMemberId, v);
    }
    closePayModal();
  });

  qs("removePayBtn").addEventListener("click", () => {
    if (payModalMemberId) removePayment(payModalMemberId);
    closePayModal();
  });

  qs("closeDetailModalBtn").addEventListener("click", closeMemberDetailModal);
  qs("memberDetailModal").addEventListener("click", (e) => { if (e.target.id === "memberDetailModal") closeMemberDetailModal(); });

  qs("amountInput").addEventListener("change", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) { state.settings.amount = v; saveData(); }
  });

  qs("weekStartSelect").addEventListener("change", (e) => {
    state.settings.weekStartDay = parseInt(e.target.value, 10);
    saveData();
    render();
  });

  qs("enableNotifBtn").addEventListener("click", async () => {
    const perm = await ensureNotificationPermission();
    renderSettings();
    if (perm === "granted") {
      showToast("تم تفعيل التنبيهات");
      checkWeeklyReminder(true);
    } else if (perm === "denied") {
      alert("تم رفض الإذن. لازم تفعّله يدويًا من إعدادات الجهاز > الإشعارات.");
    }
  });

  qs("testNotifBtn").addEventListener("click", () => {
    checkWeeklyReminder(true);
    showToast("تم إرسال التذكير");
  });

  qs("exportBtn").addEventListener("click", exportData);
  qs("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  }

  // تحقق من تذكير الأسبوع عند كل فتح للتطبيق
  checkWeeklyReminder(false);

  // إعادة الفحص كل ما يرجع التطبيق للواجهة (مفيد إذا ضل مفتوح بالخلفية)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkWeeklyReminder(false);
      render();
    }
  });
});
