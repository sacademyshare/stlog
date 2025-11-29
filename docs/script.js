// 映像授業受講状況管理 Webアプリ
// フロントエンドのみで動作する SPA。GitHub Pages / 公開CSV を前提とした実装。

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});

const App = (() => {
  const DATA_DIR = "../data";
  const CSV_PATHS = {
    students: `${DATA_DIR}/students.csv`,
    courses: `${DATA_DIR}/courses.csv`,
    studentCourses: `${DATA_DIR}/student_courses.csv`,
    lessonLogs: `${DATA_DIR}/lesson_logs.csv`,
  };

  // 擬似ログイン用ユーザー（デモ用固定ユーザー）
  const DEFAULT_USERS = [
    { id: "admin", password: "admin123", role: "admin", displayName: "管理者" },
    { id: "t001", password: "teacher123", role: "teacher", displayName: "講師 T001" },
    // デモ用生徒ユーザー（students.csv の S001 に対応）
    { id: "S001", password: "student123", role: "student", displayName: "生徒 S001" },
  ];

  const STORAGE_KEYS = {
    CURRENT_USER: "vlm_current_user",
    PASSWORD_OVERRIDES: "vlm_password_overrides",
    CUSTOM_USERS: "vlm_custom_users", // ユーザー登録画面で作成されたユーザー
  };

  const state = {
    currentUser: null,
    students: [],
    courses: [],
    studentCourses: [],
    lessonLogs: [],
    headers: {
      students: [],
      courses: [],
      studentCourses: [],
      lessonLogs: [],
    },
    unsaved: {
      students: false,
      courses: false,
      studentCourses: false,
      lessonLogs: false,
    },
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(), // 0-based
  };

  // ====== 初期化 ======
  function init() {
    bindLoginForm();
    bindNavigation();
    bindGlobalButtons();
    bindSettings();
    bindRegistration();

    const savedUser = loadCurrentUser();
    if (savedUser) {
      state.currentUser = savedUser;
      applyLoginState(true);
      refreshUserLabel();
      loadAllCSVs();
    } else {
      applyLoginState(false);
    }
  }

  // ====== ログイン・ログアウト ======
  function bindLoginForm() {
    const form = document.getElementById("login-form");
    const idInput = document.getElementById("login-id");
    const pwInput = document.getElementById("login-password");
    const errorEl = document.getElementById("login-error");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = idInput.value.trim();
      const pw = pwInput.value;

      const user = authenticate(id, pw);
      if (!user) {
        errorEl.textContent = "ユーザーIDまたはパスワードが正しくありません。";
        return;
      }
      errorEl.textContent = "";
      state.currentUser = user;
      saveCurrentUser(user);
      applyLoginState(true);
      refreshUserLabel();
      loadAllCSVs();
      showToast("ログインしました。");
    });
  }

  function authenticate(id, password) {
    if (!id) return null;

    const overrides = loadPasswordOverrides();
    const customUsers = loadCustomUsers();

    // DEFAULT_USERS + CUSTOM_USERS をマージ
    const allUsers = DEFAULT_USERS.concat(customUsers);
    const user = allUsers.find((u) => u.id === id);
    if (!user) return null;

    const overridePw = overrides[id];
    const expectedPw = overridePw || user.password;

    if (password !== expectedPw) return null;

    return { id: user.id, role: user.role, displayName: user.displayName };
  }

  function bindGlobalButtons() {
    const logoutBtn = document.getElementById("logout-btn");
    const reloadBtn = document.getElementById("reload-data-btn");

    logoutBtn.addEventListener("click", () => {
      clearCurrentUser();
      state.currentUser = null;
      applyLoginState(false);
      showToast("ログアウトしました。");
    });

    reloadBtn.addEventListener("click", () => {
      if (!state.currentUser) return;
      loadAllCSVs(true);
    });

    // カレンダー
    const prevMonth = document.getElementById("calendar-prev-month");
    const nextMonth = document.getElementById("calendar-next-month");
    prevMonth.addEventListener("click", () => {
      moveCalendarMonth(-1);
    });
    nextMonth.addEventListener("click", () => {
      moveCalendarMonth(1);
    });

    // 設定画面のCSVダウンロード
    document
      .getElementById("download-students-csv")
      .addEventListener("click", () => {
        exportCSV("students", "students.csv");
      });
    document
      .getElementById("download-student-courses-csv")
      .addEventListener("click", () => {
        exportCSV("studentCourses", "student_courses.csv");
      });
    document
      .getElementById("download-lesson-logs-csv")
      .addEventListener("click", () => {
        exportCSV("lessonLogs", "lesson_logs.csv");
      });
    document
      .getElementById("download-courses-csv")
      .addEventListener("click", () => {
        exportCSV("courses", "courses.csv");
      });

    // 生徒フィルタ
    const studentFilter = document.getElementById("student-filter");
    studentFilter.addEventListener("input", () =>
      renderStudentsTable(studentFilter.value)
    );
  }

  function applyLoginState(isLoggedIn) {
    const loginView = document.getElementById("login-view");
    const mainLayout = document.getElementById("main-layout");

    if (isLoggedIn) {
      loginView.style.display = "none";
      mainLayout.classList.remove("layout--hidden");
    } else {
      loginView.style.display = "flex";
      mainLayout.classList.add("layout--hidden");
      document.getElementById("login-form").reset();
      document.getElementById("login-error").textContent = "";
    }
  }

  function refreshUserLabel() {
    const label = document.getElementById("user-label");
    if (!state.currentUser) {
      label.textContent = "";
      return;
    }
    const roleText =
      state.currentUser.role === "admin"
        ? "管理者"
        : state.currentUser.role === "teacher"
        ? "講師"
        : "生徒";
    label.textContent = `${roleText}: ${state.currentUser.displayName}（ID: ${state.currentUser.id}）`;
    applyRoleVisibility();
  }

  // 現在ログインしている生徒ユーザーに対応する student_id を取得
  function getCurrentStudentId() {
    if (!state.currentUser || state.currentUser.role !== "student") return null;
    const userId = state.currentUser.id;
    const exact = state.students.find((s) => s.student_id === userId);
    if (exact) return exact.student_id;

    const lower = String(userId).toLowerCase();
    const byLower = state.students.find(
      (s) => String(s.student_id || "").toLowerCase() === lower
    );
    return byLower ? byLower.student_id : null;
  }

  function applyRoleVisibility() {
    if (!state.currentUser) return;
    const role = state.currentUser.role;

    const navButtons = document.querySelectorAll(".app-nav__item");
    const settingsNav = document.querySelector('[data-view-target="settings"]');
    const studentsNav = document.querySelector('[data-view-target="students"]');
    const coursesNav = document.querySelector('[data-view-target="courses"]');
    const analyticsNav = document.querySelector('[data-view-target="analytics"]');
    const registrationNav = document.querySelector(
      '[data-view-target="registration"]'
    );

    // 初期はすべて表示
    navButtons.forEach((btn) => (btn.style.display = "inline-flex"));

    if (role === "teacher") {
      // 講師は全生徒を管理できるが、設定画面は不要
      if (settingsNav) settingsNav.style.display = "none";
    } else if (role === "student") {
      // 生徒は自分の情報のみ操作可能
      if (coursesNav) coursesNav.style.display = "none";
      if (settingsNav) settingsNav.style.display = "none";
      if (analyticsNav) analyticsNav.style.display = "none";
      if (registrationNav) registrationNav.style.display = "none";
      if (studentsNav) studentsNav.style.display = "inline-flex";
    }
  }

  function saveCurrentUser(user) {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } catch (e) {
      console.warn("Failed to save current user", e);
    }
  }

  function loadCurrentUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Failed to load current user", e);
      return null;
    }
  }

  function clearCurrentUser() {
    try {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    } catch (e) {
      console.warn("Failed to clear current user", e);
    }
  }

  // ====== ナビゲーション ======
  function bindNavigation() {
    const navButtons = document.querySelectorAll(".app-nav__item");
    navButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-view-target");
        if (!target) return;
        setActiveView(target);
        navButtons.forEach((b) => b.classList.remove("app-nav__item--active"));
        btn.classList.add("app-nav__item--active");
      });
    });
  }

  function setActiveView(viewName) {
    const views = {
      dashboard: "view-dashboard",
      students: "view-students",
      courses: "view-courses",
      calendar: "view-calendar",
      analytics: "view-analytics",
      registration: "view-registration",
      settings: "view-settings",
    };
    Object.values(views).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("view--active");
    });

    const activeId = views[viewName];
    if (activeId) {
      const active = document.getElementById(activeId);
      if (active) active.classList.add("view--active");
    }
  }

  // ====== CSV ロード／パース ======
  async function loadAllCSVs(showToastFlag = false) {
    const statusBadge = document.getElementById("data-status");
    statusBadge.textContent = "読込中...";
    statusBadge.classList.remove("badge--success");
    statusBadge.classList.remove("badge--danger");

    try {
      const [students, courses, studentCourses, lessonLogs] = await Promise.all([
        fetchAndParseCSV("students"),
        fetchAndParseCSV("courses"),
        fetchAndParseCSV("studentCourses"),
        fetchAndParseCSV("lessonLogs"),
      ]);

      state.students = students.rows;
      state.courses = courses.rows;
      state.studentCourses = studentCourses.rows;
      state.lessonLogs = lessonLogs.rows;
      state.headers.students = students.headers;
      state.headers.courses = courses.headers;
      state.headers.studentCourses = studentCourses.headers;
      state.headers.lessonLogs = lessonLogs.headers;

      statusBadge.textContent = "最新データ読込済み";
      statusBadge.classList.add("badge--success");

      renderAll();
      if (showToastFlag) showToast("GitHub上のCSVを再読込しました。");
    } catch (e) {
      console.error(e);
      statusBadge.textContent = "読込エラー";
      statusBadge.classList.add("badge--danger");
      showToast(
        "CSVの読み込みに失敗しました。パスやCORS設定をご確認ください。"
      );
    }
  }

  async function fetchAndParseCSV(kind) {
    const path = CSV_PATHS[kind];
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
    const text = await res.text();
    return parseCSV(text);
  }

  function parseCSV(text) {
    const lines = text.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n").split("\\n");
    const filtered = lines.filter((line) => line.trim() !== "");
    if (filtered.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = splitCsvLine(filtered[0]);
    const rows = [];
    for (let i = 1; i < filtered.length; i++) {
      const cols = splitCsvLine(filtered[i]);
      if (cols.length === 1 && cols[0] === "") continue;
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] !== undefined ? cols[idx] : "";
      });
      rows.push(obj);
    }
    return { headers, rows };
  }

  function splitCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += c;
      }
    }
    result.push(current);
    return result;
  }

  function toCSV(headers, rows) {
    const escape = (value) => {
      if (value == null) return "";
      const s = String(value);
      if (/[",\\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const headerLine = headers.map(escape).join(",");
    const lines = [headerLine];
    rows.forEach((row) => {
      const line = headers.map((h) => escape(row[h])).join(",");
      lines.push(line);
    });
    return lines.join("\\r\\n");
  }

  // ====== レンダリング ======
  function renderAll() {
    renderDashboard();
    renderStudentsTable(document.getElementById("student-filter").value);
    renderCoursesTable();
    renderGlobalCalendar();
    renderAnalytics();
  }

  // --- ダッシュボード ---
  function renderDashboard() {
    const studentCountEl = document.getElementById("metric-student-count");
    const monthlyLogsEl = document.getElementById("metric-monthly-logs");
    const avgProgressEl = document.getElementById("metric-avg-progress");

    studentCountEl.textContent = state.students.length;

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    const monthlyLogs = state.lessonLogs.filter(
      (log) => log.date && log.date.startsWith(ym)
    );
    const monthlyCount = monthlyLogs.reduce(
      (sum, log) => sum + Number(log.count || 0),
      0
    );
    monthlyLogsEl.textContent = monthlyCount;

    const progresses = getAllStudentCourseProgress();
    if (progresses.length === 0) {
      avgProgressEl.textContent = "-";
    } else {
      const avg =
        progresses.reduce((sum, p) => sum + p.progressRate, 0) /
        progresses.length;
      avgProgressEl.textContent = Math.round(avg);
    }

    renderDashboardCourseSummary();
  }

  function renderDashboardCourseSummary() {
    const container = document.getElementById("dashboard-course-summary");
    if (!container) return;

    const map = new Map();
    state.studentCourses.forEach((sc) => {
      const key = sc.course_id;
      if (!map.has(key)) {
        map.set(key, {
          course_id: key,
          planned: 0,
          actual: 0,
          students: new Set(),
        });
      }
      const item = map.get(key);
      item.planned += Number(sc.planned_sessions || 0);
      item.students.add(sc.student_id);
    });

    state.lessonLogs.forEach((log) => {
      const key = log.course_id;
      if (!map.has(key)) return;
      const item = map.get(key);
      item.actual += Number(log.count || 0);
    });

    if (map.size === 0) {
      container.innerHTML = '<p class="muted small">データがありません。</p>';
      return;
    }

    let html = "<table><thead><tr>";
    html +=
      "<th>講座ID</th><th>講座名</th><th>受講者数</th><th>予定コマ数</th><th>実績コマ数</th><th>達成率</th>";
    html += "</tr></thead><tbody>";

    for (const item of map.values()) {
      const course = state.courses.find((c) => c.course_id === item.course_id);
      const rate =
        item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : 0;
      html += "<tr>";
      html += `<td>${escapeHtml(item.course_id)}</td>`;
      html += `<td>${escapeHtml(course ? course.course_name : "")}</td>`;
      html += `<td>${item.students.size}</td>`;
      html += `<td>${item.planned}</td>`;
      html += `<td>${item.actual}</td>`;
      html += `<td>${rate}%</td>`;
      html += "</tr>";
    }

    html += "</tbody></table>";
    container.innerHTML = html;
  }

  // --- 生徒一覧 ---
  function renderStudentsTable(filterText = "") {
    const container = document.getElementById("students-table");
    if (!container) return;

    let students = state.students;

    if (state.currentUser && state.currentUser.role === "student") {
      const myId = getCurrentStudentId();
      students = myId ? students.filter((s) => s.student_id === myId) : [];
    }

    const q = filterText.trim().toLowerCase();
    if (q) {
      students = students.filter((s) => {
        return (
          (s.student_id && s.student_id.toLowerCase().includes(q)) ||
          (s.course_group && s.course_group.toLowerCase().includes(q))
        );
      });
    }

    if (students.length === 0) {
      container.innerHTML = '<p class="muted small">生徒が登録されていません。</p>';
      return;
    }

    let html = "<table><thead><tr>";
    html += "<th>ID</th><th>学年</th><th>コース群</th><th>ステータス</th>";
    html += "</tr></thead><tbody>";

    students.forEach((s) => {
      html += `<tr class="is-clickable" data-student-id="${escapeHtml(
        s.student_id
      )}">`;
      html += `<td>${escapeHtml(s.student_id)}</td>`;
      html += `<td>${escapeHtml(s.grade)}</td>`;
      html += `<td>${escapeHtml(s.course_group)}</td>`;
      const status = (s.status || "").toLowerCase();
      const badgeClass =
        status === "active" ? "badge-status-active" : "badge-status-inactive";
      html += `<td><span class="badge ${badgeClass}">${escapeHtml(
        s.status || ""
      )}</span></td>`;
      html += "</tr>";
    });

    html += "</tbody></table>";
    container.innerHTML = html;

    container.querySelectorAll("tbody tr").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-student-id");
        openStudentDetail(id);
      });
    });
  }

  function openStudentDetail(studentId) {
    const student = state.students.find((s) => s.student_id === studentId);
    const container = document.getElementById("student-detail");
    const label = document.getElementById("student-detail-label");
    if (!student || !container) return;

    const currentRole = state.currentUser ? state.currentUser.role : null;
    if (currentRole === "student") {
      const myId = getCurrentStudentId();
      if (myId && studentId !== myId) {
        showToast("自分以外の生徒情報は閲覧できません。");
        return;
      }
    }

    label.textContent = `${student.student_id} / ${student.grade} / ${student.course_group}`;

    const scList = state.studentCourses.filter((sc) => sc.student_id === studentId);

    let html = '<div class="student-detail__header">';
    html += `<h3 class="student-detail__title">${escapeHtml(
      student.student_id
    )}</h3>`;
    html += `<div class="student-detail__meta">学年: ${escapeHtml(
      student.grade
    )} / コース群: ${escapeHtml(student.course_group)}</div>`;
    html += "</div>";

    html += '<h4 class="student-detail__section-title">受講講座</h4>';
    if (scList.length === 0) {
      html += '<p class="muted small">講座設定がありません。</p>';
    } else {
      html += '<div class="table-wrapper small-scroll"><table><thead><tr>';
      html +=
        "<th>講座ID</th><th>講座名</th><th>予定コマ数</th><th>期間</th><th>実績コマ数</th><th>達成率</th>";
      html += "</tr></thead><tbody>";

      scList.forEach((sc) => {
        const course = state.courses.find((c) => c.course_id === sc.course_id);
        const planned = Number(sc.planned_sessions || 0);
        const actual = state.lessonLogs
          .filter(
            (log) =>
              log.student_id === studentId && log.course_id === sc.course_id
          )
          .reduce((sum, log) => sum + Number(log.count || 0), 0);
        const rate = planned > 0 ? Math.round((actual / planned) * 100) : 0;

        html += "<tr>";
        html += `<td>${escapeHtml(sc.course_id)}</td>`;
        html += `<td>${escapeHtml(course ? course.course_name : "")}</td>`;
        html += `<td>${planned}</td>`;
        html += `<td>${escapeHtml(sc.start_date)}〜${escapeHtml(
          sc.end_date
        )}</td>`;
        html += `<td>${actual}</td>`;
        html += `<td>${rate}%</td>`;
        html += "</tr>";
      });

      html += "</tbody></table></div>";
    }

    html += '<h4 class="student-detail__section-title">受講講座の追加</h4>';
    const availableCourses = state.courses.filter(
      (c) => !scList.some((sc) => sc.course_id === c.course_id)
    );
    if (availableCourses.length === 0) {
      html += '<p class="muted small">追加可能な講座はありません。</p>';
    } else {
      html += '<form id="student-course-form" class="settings-form">';
      html += '<div class="form-row">';
      html +=
        '<label class="form-field"><span>講座</span><select id="student-course-id" required>';
      html += '<option value="">選択してください</option>';
      availableCourses.forEach((c) => {
        html += `<option value="${escapeHtml(c.course_id)}">${escapeHtml(
          c.course_id
        )} : ${escapeHtml(c.course_name)}</option>`;
      });
      html += "</select></label>";
      html +=
        '<label class="form-field"><span>予定コマ数</span><input type="number" id="student-course-planned" min="1" value="1" required /></label>';
      html +=
        '<label class="form-field"><span>開始日</span><input type="date" id="student-course-start" required /></label>';
      html +=
        '<label class="form-field"><span>終了日</span><input type="date" id="student-course-end" required /></label>';
      html += "</div>";
      html +=
        '<button type="submit" class="btn btn--outline btn--small">講座を追加</button>';
      html +=
        '<p class="muted small">※ 追加された講座は student_courses.csv に反映されます（CSVダウンロードが必要）。</p>';
      html += "</form>";
    }

    html += '<h4 class="student-detail__section-title">受講ログ登録（実績）</h4>';
    html += '<form id="log-form" class="settings-form">';
    html += '<div class="form-row">';
    html +=
      '<label class="form-field"><span>日付</span><input type="date" id="log-date" required /></label>';
    html +=
      '<label class="form-field"><span>講座</span><select id="log-course" required>';
    if (scList.length === 0) {
      html += '<option value="">講座設定なし</option>';
    } else {
      html += '<option value="">選択してください</option>';
      scList.forEach((sc) => {
        const course = state.courses.find((c) => c.course_id === sc.course_id);
        html += `<option value="${escapeHtml(sc.course_id)}">${escapeHtml(
          sc.course_id
        )} : ${escapeHtml(course ? course.course_name : "")}</option>`;
      });
    }
    html += "</select></label>";
    html +=
      '<label class="form-field"><span>コマ数</span><input type="number" id="log-count" min="1" value="1" required /></label>';
    html += "</div>";
    html +=
      '<button type="submit" class="btn btn--primary btn--small">ログ追加</button>';
    html +=
      '<p class="muted small">※ 追加したログは lesson_logs.csv に反映されます（CSVダウンロードが必要）。</p>';
    html += "</form>";

    html += '<h4 class="student-detail__section-title">月間カレンダー</h4>';
    html += '<div id="student-calendar" class="calendar"></div>';
    html +=
      '<p class="muted small">※ 各日の「実績」はこの生徒の全講座合計コマ数です。</p>';

    container.innerHTML = html;

    const logForm = document.getElementById("log-form");
    if (logForm) {
      logForm.addEventListener("submit", (e) => {
        e.preventDefault();
        addLessonLogFromForm(studentId);
      });
    }

    const scForm = document.getElementById("student-course-form");
    if (scForm) {
      scForm.addEventListener("submit", (e) => {
        e.preventDefault();
        addStudentCourseFromForm(studentId);
      });
    }

    renderStudentCalendar(studentId);
  }

  function addLessonLogFromForm(studentId) {
    const currentRole = state.currentUser ? state.currentUser.role : null;
    if (currentRole === "student") {
      const myId = getCurrentStudentId();
      if (myId && studentId !== myId) {
        showToast("自分以外の受講状況は変更できません。");
        return;
      }
    }

    const dateInput = document.getElementById("log-date");
    const courseSelect = document.getElementById("log-course");
    const countInput = document.getElementById("log-count");
    if (!dateInput || !courseSelect || !countInput) return;

    const date = dateInput.value;
    const courseId = courseSelect.value;
    const count = Number(countInput.value || 0);
    if (!date || !courseId || count <= 0) {
      showToast("日付・講座・コマ数を確認してください。");
      return;
    }

    const dateKey = date.replace(/-/g, "");
    const baseId = `${dateKey}-${studentId}`;
    const existing = state.lessonLogs.filter(
      (l) => l.log_id && l.log_id.startsWith(baseId)
    );
    const seq = existing.length + 1;
    const logId = `${baseId}-${seq}`;

    const nowIso = new Date().toISOString();

    const newRow = {
      log_id: logId,
      date,
      student_id: studentId,
      course_id: courseId,
      count: String(count),
      registered_by: state.currentUser ? state.currentUser.id : "unknown",
      created_at: nowIso,
    };

    state.lessonLogs.push(newRow);
    state.unsaved.lessonLogs = true;

    openStudentDetail(studentId);
    renderGlobalCalendar();
    renderDashboard();
    renderAnalytics();

    showToast(
      "受講ログを追加しました。lesson_logs.csv のダウンロードと GitHub への反映を行ってください。"
    );
  }

  function addStudentCourseFromForm(studentId) {
    const currentRole = state.currentUser ? state.currentUser.role : null;
    if (currentRole === "student") {
      const myId = getCurrentStudentId();
      if (myId && studentId !== myId) {
        showToast("自分以外の受講講座は変更できません。");
        return;
      }
    }

    const courseSelect = document.getElementById("student-course-id");
    const plannedInput = document.getElementById("student-course-planned");
    const startInput = document.getElementById("student-course-start");
    const endInput = document.getElementById("student-course-end");
    if (!courseSelect || !plannedInput || !startInput || !endInput) return;

    const courseId = courseSelect.value;
    const planned = Number(plannedInput.value || 0);
    const startDate = startInput.value;
    const endDate = endInput.value;

    if (!courseId || planned <= 0 || !startDate || !endDate) {
      showToast("講座・予定コマ数・期間を確認してください。");
      return;
    }

    const exists = state.studentCourses.some(
      (sc) => sc.student_id === studentId && sc.course_id === courseId
    );
    if (exists) {
      showToast("この講座はすでに登録されています。");
      return;
    }

    const newRow = {
      student_id: studentId,
      course_id: courseId,
      planned_sessions: String(planned),
      start_date: startDate,
      end_date: endDate,
    };

    state.studentCourses.push(newRow);
    state.unsaved.studentCourses = true;

    openStudentDetail(studentId);
    renderAnalytics();
    renderDashboard();

    showToast(
      "受講講座を追加しました。student_courses.csv のダウンロードと GitHub への反映を行ってください。"
    );
  }

  // --- 講座一覧 ---
  function renderCoursesTable() {
    const container = document.getElementById("courses-table");
    if (!container) return;

    if (state.courses.length === 0) {
      container.innerHTML = '<p class="muted small">講座が登録されていません。</p>';
      return;
    }

    let html = "<table><thead><tr>";
    html +=
      "<th>講座ID</th><th>講座名</th><th>対象学年</th><th>標準講数</th><th>メモ</th>";
    html += "</tr></thead><tbody>";

    state.courses.forEach((c) => {
      html += "<tr>";
      html += `<td>${escapeHtml(c.course_id)}</td>`;
      html += `<td>${escapeHtml(c.course_name)}</td>`;
      html += `<td>${escapeHtml(c.target_grade)}</td>`;
      html += `<td>${escapeHtml(c.standard_sessions)}</td>`;
      html += `<td>${escapeHtml(c.note)}</td>`;
      html += "</tr>";
    });

    html += "</tbody></table>";
    container.innerHTML = html;
  }

  // --- カレンダー（全体） ---
  function renderGlobalCalendar() {
    const container = document.getElementById("global-calendar");
    const label = document.getElementById("calendar-month-label");
    if (!container || !label) return;

    const year = state.calendarYear;
    const month = state.calendarMonth;
    label.textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    container.innerHTML = "";

    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const headerRow = document.createElement("div");
    headerRow.className = "calendar-grid";
    weekdays.forEach((w) => {
      const cell = document.createElement("div");
      cell.className = "calendar__weekday";
      cell.textContent = w;
      headerRow.appendChild(cell);
    });
    container.appendChild(headerRow);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    for (let i = 0; i < startWeekday; i++) {
      const emptyCell = document.createElement("div");
      grid.appendChild(emptyCell);
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(year, month, day);
      const dateStr = formatDate(cellDate);

      const logs = state.lessonLogs.filter((log) => log.date === dateStr);
      const totalCount = logs.reduce(
        (sum, log) => sum + Number(log.count || 0),
        0
      );

      const cell = document.createElement("div");
      cell.className = "calendar__cell";

      if (
        today.getFullYear() === cellDate.getFullYear() &&
        today.getMonth() === cellDate.getMonth() &&
        today.getDate() === cellDate.getDate()
      ) {
        cell.classList.add("calendar__cell--today");
      }
      if (totalCount > 0) {
        cell.classList.add("calendar__cell--has-logs");
      }

      const dateEl = document.createElement("div");
      dateEl.className = "calendar__date";
      dateEl.textContent = day;

      const valueEl = document.createElement("div");
      valueEl.className = "calendar__value";
      valueEl.textContent =
        totalCount > 0 ? `実績: ${totalCount}コマ` : "実績: 0コマ";

      cell.appendChild(dateEl);
      cell.appendChild(valueEl);

      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  function moveCalendarMonth(delta) {
    let year = state.calendarYear;
    let month = state.calendarMonth + delta;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    state.calendarYear = year;
    state.calendarMonth = month;
    renderGlobalCalendar();
  }

  function renderStudentCalendar(studentId) {
    const container = document.getElementById("student-calendar");
    if (!container) return;

    const year = state.calendarYear;
    const month = state.calendarMonth;

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    container.innerHTML = "";

    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const headerRow = document.createElement("div");
    headerRow.className = "calendar-grid";
    weekdays.forEach((w) => {
      const cell = document.createElement("div");
      cell.className = "calendar__weekday";
      cell.textContent = w;
      headerRow.appendChild(cell);
    });
    container.appendChild(headerRow);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    for (let i = 0; i < startWeekday; i++) {
      const emptyCell = document.createElement("div");
      grid.appendChild(emptyCell);
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(year, month, day);
      const dateStr = formatDate(cellDate);

      const logs = state.lessonLogs.filter(
        (log) => log.date === dateStr && log.student_id === studentId
      );
      const totalCount = logs.reduce(
        (sum, log) => sum + Number(log.count || 0),
        0
      );

      const cell = document.createElement("div");
      cell.className = "calendar__cell";

      if (
        today.getFullYear() === cellDate.getFullYear() &&
        today.getMonth() === cellDate.getMonth() &&
        today.getDate() === cellDate.getDate()
      ) {
        cell.classList.add("calendar__cell--today");
      }
      if (totalCount > 0) {
        cell.classList.add("calendar__cell--has-logs");
      }

      const dateEl = document.createElement("div");
      dateEl.className = "calendar__date";
      dateEl.textContent = day;

      const valueEl = document.createElement("div");
      valueEl.className = "calendar__value";
      valueEl.textContent =
        totalCount > 0 ? `実績: ${totalCount}コマ` : "実績: 0コマ";

      cell.appendChild(dateEl);
      cell.appendChild(valueEl);

      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  // --- 分析 ---
  function getAllStudentCourseProgress() {
    const list = [];
    state.studentCourses.forEach((sc) => {
      const planned = Number(sc.planned_sessions || 0);
      if (!sc.student_id || !sc.course_id || planned <= 0) return;

      const actual = state.lessonLogs
        .filter(
          (log) =>
            log.student_id === sc.student_id && log.course_id === sc.course_id
        )
        .reduce((sum, log) => sum + Number(log.count || 0), 0);
      const rate = planned > 0 ? (actual / planned) * 100 : 0;
      list.push({
        student_id: sc.student_id,
        course_id: sc.course_id,
        planned,
        actual,
        progressRate: rate,
      });
    });
    return list;
  }

  function renderAnalytics() {
    const container = document.getElementById("analytics-student-progress");
    if (!container) return;

    const progresses = getAllStudentCourseProgress();
    if (progresses.length === 0) {
      container.innerHTML = '<p class="muted small">進捗データがありません。</p>';
      return;
    }

    let html = "<table><thead><tr>";
    html +=
      "<th>生徒ID</th><th>学年</th><th>講座ID</th><th>講座名</th><th>予定コマ数</th><th>実績コマ数</th><th>達成率</th>";
    html += "</tr></thead><tbody>";

    progresses.forEach((p) => {
      const student = state.students.find((s) => s.student_id === p.student_id);
      const course = state.courses.find((c) => c.course_id === p.course_id);
      const rate = Math.round(p.progressRate);

      html += "<tr>";
      html += `<td>${escapeHtml(p.student_id)}</td>`;
      html += `<td>${escapeHtml(student ? student.grade : "")}</td>`;
      html += `<td>${escapeHtml(p.course_id)}</td>`;
      html += `<td>${escapeHtml(course ? course.course_name : "")}</td>`;
      html += `<td>${p.planned}</td>`;
      html += `<td>${p.actual}</td>`;
      html += "<td>";
      html += `<div class="progress-bar"><div class="progress-bar__value" style="transform: scaleX(${
        Math.min(rate, 100) / 100
      });"></div></div>`;
      html += ` <span class="small">${rate}%</span>`;
      html += "</td>";
      html += "</tr>";
    });

    html += "</tbody></table>";
    container.innerHTML = html;
  }

  // ====== 設定（パスワード変更） ======
  function bindSettings() {
    const form = document.getElementById("password-form");
    const msgEl = document.getElementById("password-message");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!state.currentUser) {
        msgEl.textContent = "ログインしてから操作してください。";
        msgEl.style.color = "#b91c1c";
        return;
      }

      const current = document.getElementById("current-password").value;
      const newPw = document.getElementById("new-password").value;
      const confirmPw = document.getElementById("new-password-confirm").value;

      if (!current || !newPw || !confirmPw) {
        msgEl.textContent = "すべての項目を入力してください。";
        msgEl.style.color = "#b91c1c";
        return;
      }
      if (newPw !== confirmPw) {
        msgEl.textContent = "新しいパスワードが一致しません。";
        msgEl.style.color = "#b91c1c";
        return;
      }

      const overrides = loadPasswordOverrides();
      const userId = state.currentUser.id;
      const users = DEFAULT_USERS.concat(loadCustomUsers());
      const def = users.find((u) => u.id === userId);
      const expectedCurrent = overrides[userId] || (def && def.password);
      if (!expectedCurrent || current !== expectedCurrent) {
        msgEl.textContent = "現在のパスワードが正しくありません。";
        msgEl.style.color = "#b91c1c";
        return;
      }

      overrides[userId] = newPw;
      savePasswordOverrides(overrides);

      msgEl.textContent = "パスワードを更新しました（ローカルストレージに保存）。";
      msgEl.style.color = "#16a34a";
      form.reset();
    });
  }

  function loadPasswordOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PASSWORD_OVERRIDES);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function savePasswordOverrides(map) {
    try {
      localStorage.setItem(
        STORAGE_KEYS.PASSWORD_OVERRIDES,
        JSON.stringify(map)
      );
    } catch (e) {
      console.warn("Failed to save password overrides", e);
    }
  }

  // ====== ユーザー登録（カスタムユーザー） ======
  function bindRegistration() {
    const form = document.getElementById("registration-form");
    const msgEl = document.getElementById("registration-message");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      msgEl.textContent = "";
      msgEl.style.color = "#b91c1c";

      if (!state.currentUser || (state.currentUser.role !== "admin" && state.currentUser.role !== "teacher")) {
        msgEl.textContent = "管理者または講師のみユーザー登録が可能です。";
        return;
      }

      const id = document.getElementById("reg-student-id").value.trim();
      const grade = document.getElementById("reg-grade").value.trim();
      const courseGroup = document
        .getElementById("reg-course-group")
        .value.trim();
      const status = document.getElementById("reg-status").value || "active";
      const password = document.getElementById("reg-password").value;

      if (!id || !grade || !password) {
        msgEl.textContent = "生徒ID・学年・初期パスワードは必須です。";
        return;
      }

      // 既存ユーザーとの重複チェック
      const existsUser =
        DEFAULT_USERS.concat(loadCustomUsers()).find((u) => u.id === id) !=
        null;
      if (existsUser) {
        msgEl.textContent =
          "このユーザーIDはすでに登録されています。（パスワード変更は設定画面から行ってください。）";
        return;
      }

      // students に追加（すでに存在していなければ）
      const existsStudent = state.students.some((s) => s.student_id === id);
      if (!existsStudent) {
        const newStudent = {
          student_id: id,
          grade,
          course_group: courseGroup,
          status,
        };
        state.students.push(newStudent);
        state.unsaved.students = true;
        renderStudentsTable(document.getElementById("student-filter").value);
        renderDashboard();
        renderAnalytics();
      }

      // カスタムユーザーとして localStorage に保存
      const customUsers = loadCustomUsers();
      customUsers.push({
        id,
        password,
        role: "student",
        displayName: `生徒 ${id}`,
      });
      saveCustomUsers(customUsers);

      // パスワードオーバーライドにもセット
      const overrides = loadPasswordOverrides();
      overrides[id] = password;
      savePasswordOverrides(overrides);

      form.reset();
      msgEl.textContent =
        "ユーザーを登録しました。students.csv をダウンロードして GitHub に反映させてください。";
      msgEl.style.color = "#16a34a";
      showToast("新しい生徒ユーザーを登録しました。");
    });
  }

  function loadCustomUsers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_USERS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  function saveCustomUsers(list) {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_USERS, JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to save custom users", e);
    }
  }

  // ====== CSVエクスポート ======
  function exportCSV(kind, filename) {
    const headers = state.headers[kind];
    if (!headers || headers.length === 0) {
      showToast(
        "ヘッダー情報がありません。CSVを読み込めているか確認してください。"
      );
      return;
    }
    const rows = state[kind];
    const csv = toCSV(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ====== Utility ======
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("toast--hidden");
    toast.classList.add("toast--visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("toast--visible");
      toast.classList.add("toast--hidden");
    }, 2800);
  }

  return {
    init,
  };
})();
