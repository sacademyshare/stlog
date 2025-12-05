// ===========================================================
// 映像授業受講状況管理 Web アプリ
//  - フロントエンドのみ (GitHub Pages想定)
//  - データは GitHub 公開リポジトリの CSV を fetch
//  - 擬似ログイン + localStorage による簡易認証
// ===========================================================
(() => {
  'use strict';

  // ---------------------------------------------------------
  // 定数・設定
  // ---------------------------------------------------------
  const CONFIG = {
    dataBasePath: '../data', // docs/index.html からの相対パス
    files: {
      students: 'students.csv',
      courses: 'courses.csv',
      studentCourses: 'student_courses.csv',
      lessonLogs: 'lesson_logs.csv'
    },
    storageKeys: {
      currentUser: 'lessonAppCurrentUser',
      passwords: 'lessonAppPasswords'
    }
  };

  const ROLES = {
    ADMIN: 'admin',
    TEACHER: 'teacher',
    STUDENT: 'student'
  };

  const DEFAULT_ACCOUNTS = [
    { id: 'admin',   password: 'admin123',   role: ROLES.ADMIN,   label: '管理者' },
    { id: 'teacher1', password: 'teacher123', role: ROLES.TEACHER, label: '講師A' },
    { id: 'S001',    password: 'student001', role: ROLES.STUDENT, label: '生徒 S001', studentId: 'S001' }
  ];

  const state = {
    dataLoaded: false,
    isLoading: false,
    students: [],
    courses: [],
    studentCourses: [],
    lessonLogs: [],
    calendar: {
      year: null,
      month: null, // 0-11
      selectedDateStr: null // YYYY-MM-DD
    },
    currentStudentId: null
  };

  const dom = {};

  // ---------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------
  function $(selector) {
    return document.querySelector(selector);
  }

  function $all(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function showElement(el) {
    if (el) el.classList.remove('hidden');
  }

  function hideElement(el) {
    if (el) el.classList.add('hidden');
  }

  function setText(el, text) {
    if (el) el.textContent = text != null ? String(text) : '';
  }

  function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    const weekday = '日月火水木金土'[d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
  }

  function formatPercent(value) {
    if (!isFinite(value)) return '-';
    return (value * 100).toFixed(0) + '%';
  }

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = String(dateStr).split('-').map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function clampDateToRange(date, start, end) {
    if (date < start) return new Date(start.getTime());
    if (date > end) return new Date(end.getTime());
    return date;
  }

  function daysBetweenInclusive(start, end) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.floor((e - s) / msPerDay) + 1;
  }

  function showGlobalMessage(message, type = 'info', timeoutMs = 4000) {
    const el = dom.globalMessage;
    if (!el) return;
    el.className = 'global-message ' + type;
    el.textContent = message;
    showElement(el);
    if (timeoutMs > 0) {
      window.clearTimeout(el._hideTimer);
      el._hideTimer = window.setTimeout(() => hideElement(el), timeoutMs);
    }
  }

  // ---------------------------------------------------------
  // 認証管理
  // ---------------------------------------------------------
  const Auth = {
    currentUser: null,

    init() {
      const savedStr = localStorage.getItem(CONFIG.storageKeys.currentUser);
      if (savedStr) {
        try {
          const data = JSON.parse(savedStr);
          if (data && data.id && data.role) {
            this.currentUser = data;
          }
        } catch (e) {
          console.warn('invalid currentUser in storage', e);
        }
      }
      updateHeaderUserInfo();
      applyRoleVisibility();
    },

    getAccounts() {
      // 擬似ログイン用：パスワードだけをローカルで上書き可能
      const customPwMap = this._getPasswordOverrides();
      return DEFAULT_ACCOUNTS.map(acc => {
        const override = customPwMap[acc.id];
        return override
          ? { ...acc, password: override }
          : { ...acc };
      });
    },

    login(loginId, password) {
      const accounts = this.getAccounts();
      const account = accounts.find(a => a.id === loginId);
      if (!account) {
        throw new Error('ID またはパスワードが正しくありません。');
      }
      if (account.password !== password) {
        throw new Error('ID またはパスワードが正しくありません。');
      }
      this.currentUser = {
        id: account.id,
        role: account.role,
        label: account.label,
        studentId: account.studentId || null
      };
      localStorage.setItem(CONFIG.storageKeys.currentUser, JSON.stringify(this.currentUser));
      updateHeaderUserInfo();
      applyRoleVisibility();
      return this.currentUser;
    },

    logout() {
      this.currentUser = null;
      localStorage.removeItem(CONFIG.storageKeys.currentUser);
      updateHeaderUserInfo();
      applyRoleVisibility();
    },

    _getPasswordOverrides() {
      const str = localStorage.getItem(CONFIG.storageKeys.passwords);
      if (!str) return {};
      try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    },

    changePassword(currentPassword, newPassword) {
      if (!this.currentUser) throw new Error('ログイン情報が取得できません。');
      const accounts = this.getAccounts();
      const account = accounts.find(a => a.id === this.currentUser.id);
      if (!account) throw new Error('アカウント情報が見つかりません。');

      if (account.password !== currentPassword) {
        throw new Error('現在のパスワードが一致しません。');
      }
      const map = this._getPasswordOverrides();
      map[this.currentUser.id] = newPassword;
      localStorage.setItem(CONFIG.storageKeys.passwords, JSON.stringify(map));
    }
  };

  // ---------------------------------------------------------
  // CSV 読み書き・データロード
  // ---------------------------------------------------------
  const DataService = {
    headers: {
      students: ['student_id', 'grade', 'course_group', 'status'],
      courses: ['course_id', 'course_name', 'target_grade', 'standard_sessions', 'note'],
      studentCourses: ['student_id', 'course_id', 'planned_sessions', 'start_date', 'end_date'],
      lessonLogs: ['log_id', 'date', 'student_id', 'course_id', 'count', 'registered_by', 'created_at', 'kind']
    },
    dirty: {
      students: false,
      courses: false,
      studentCourses: false,
      lessonLogs: false
    },

    async loadAll() {
      state.isLoading = true;
      setLoadingIndicator(true);
      try {
        const [studentsRes, coursesRes, studentCoursesRes, lessonLogsRes] = await Promise.all([
          this._loadCsv('students'),
          this._loadCsv('courses'),
          this._loadCsv('studentCourses'),
          this._loadCsv('lessonLogs')
        ]);

        state.students = studentsRes.rows;
        this.headers.students = studentsRes.headers.length ? studentsRes.headers : this.headers.students;

        state.courses = coursesRes.rows;
        this.headers.courses = coursesRes.headers.length ? coursesRes.headers : this.headers.courses;

        state.studentCourses = studentCoursesRes.rows;
        this.headers.studentCourses = studentCoursesRes.headers.length ? studentCoursesRes.headers : this.headers.studentCourses;

        state.lessonLogs = lessonLogsRes.rows;
        // kind カラムが無い場合は追加
        const hasKind = lessonLogsRes.headers.includes('kind');
        this.headers.lessonLogs = hasKind ? lessonLogsRes.headers : this.headers.lessonLogs;
        if (!hasKind) {
          state.lessonLogs.forEach(row => {
            if (!('kind' in row)) row.kind = 'actual';
          });
        }

        state.dataLoaded = true;
        this.resetDirty();
        showGlobalMessage('CSV データを読み込みました。', 'success', 3000);
      } catch (e) {
        console.error(e);
        showGlobalMessage('CSV 読み込み中にエラーが発生しました。GitHub 上のパスや CORS 設定を確認してください。', 'error', 8000);
      } finally {
        state.isLoading = false;
        setLoadingIndicator(false);
        refreshAllViews();
      }
    },

    async _loadCsv(kind) {
      const fileName = CONFIG.files[kind];
      const url = `${CONFIG.dataBasePath}/${fileName}?t=${Date.now()}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn('CSV fetch failed:', url, res.status);
          return { headers: this.headers[kind] || [], rows: [] };
        }
        const text = await res.text();
        const { headers, rows } = this.parseCsv(text);
        return { headers, rows };
      } catch (e) {
        console.warn('CSV fetch error:', url, e);
        return { headers: this.headers[kind] || [], rows: [] };
      }
    },

    parseCsv(text) {
      const rows = [];
      let current = '';
      let row = [];
      let inQuotes = false;

      function endCell() {
        row.push(current);
        current = '';
      }

      function endRow() {
        if (row.length > 0) {
          rows.push(row);
        }
        row = [];
      }

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"') {
          if (inQuotes && next === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          endCell();
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
          if (ch === '\r' && next === '\n') {
            i++;
          }
          endCell();
          endRow();
        } else {
          current += ch;
        }
      }
      if (current.length > 0 || row.length > 0) {
        endCell();
        endRow();
      }

      if (!rows.length) {
        return { headers: [], rows: [] };
      }
      const headers = rows[0].map(h => h.trim());
      const dataRows = rows.slice(1).filter(r => r.some(cell => cell && cell.trim() !== ''));
      const objects = dataRows.map(r => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = r[idx] != null ? r[idx] : '';
        });
        return obj;
      });
      return { headers, rows: objects };
    },

    toCsv(headers, rows) {
      const escapeCell = (value) => {
        if (value == null) value = '';
        let s = String(value);
        if (s.includes('"')) {
          s = s.replace(/"/g, '""');
        }
        if (/[",\n\r]/.test(s)) {
          s = '"' + s + '"';
        }
        return s;
      };

      const lines = [];
      lines.push(headers.map(escapeCell).join(','));
      rows.forEach(row => {
        const line = headers.map(h => escapeCell(row[h])).join(',');
        lines.push(line);
      });
      return lines.join('\n');
    },

    downloadCsv(kind) {
      const headers = this.headers[kind];
      const rows = state[kind === 'students' ? 'students'
        : kind === 'courses' ? 'courses'
        : kind === 'studentCourses' ? 'studentCourses'
        : 'lessonLogs'];
      if (!headers || !headers.length) {
        showGlobalMessage(`${kind} のヘッダーが定義されていません。`, 'error');
        return;
      }
      const csv = this.toCsv(headers, rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = CONFIG.files[kind];
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    markDirty(kind) {
      if (!this.dirty[kind]) {
        this.dirty[kind] = true;
        updateUnsavedIndicator();
      }
    },

    resetDirty() {
      Object.keys(this.dirty).forEach(k => { this.dirty[k] = false; });
      updateUnsavedIndicator();
    },

    hasDirty() {
      return Object.values(this.dirty).some(Boolean);
    }
  };

  // ---------------------------------------------------------
  // 画面初期化
  // ---------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    attachEventHandlers();
    Auth.init();

    if (Auth.currentUser) {
      showMainView();
      DataService.loadAll();
    } else {
      showLoginView();
    }
  });

  function cacheDom() {
    dom.loginView = $('#login-view');
    dom.loginForm = $('#login-form');
    dom.loginId = $('#login-id');
    dom.loginPassword = $('#login-password');
    dom.loginError = $('#login-error');

    dom.mainView = $('#main-view');
    dom.navButtons = $all('.nav-btn');
    dom.globalMessage = $('#global-message');
    dom.unsavedIndicator = $('#unsaved-indicator');

    dom.headerUserLabel = $('#header-user-label');
    dom.headerUserRole = $('#header-user-role');
    dom.logoutButton = $('#btn-logout');

    dom.views = {
      dashboard: $('#view-dashboard'),
      students: $('#view-students'),
      studentDetail: $('#view-student-detail'),
      courses: $('#view-courses'),
      analytics: $('#view-analytics'),
      settings: $('#view-settings')
    };

    // Dashboard
    dom.kpiActiveStudents = $('#kpi-active-students');
    dom.kpiMonthLogs = $('#kpi-month-logs');
    dom.kpiAvgAchievement = $('#kpi-avg-achievement');
    dom.dashboardStudentSummaryBody = $('#dashboard-student-summary-body');
    dom.dashboardStudentSummaryTitle = $('#dashboard-student-summary-title');

    // Students
    dom.studentsFilterGrade = $('#students-filter-grade');
    dom.studentsFilterStatus = $('#students-filter-status');
    dom.studentsFilterId = $('#students-filter-id');
    dom.studentsTableBody = $('#students-table-body');
    dom.btnDownloadStudents = $('#btn-download-students');

    // Student detail & calendar
    dom.studentDetailInfo = $('#student-detail-info');
    dom.studentDetailHint = $('#student-detail-hint');
    dom.studentDetailSelect = $('#student-detail-select');
    dom.studentCoursesBody = $('#student-courses-body');
    dom.studentCourseAddCourse = $('#student-course-add-course');
    dom.studentCourseAddPlanned = $('#student-course-add-planned');
    dom.studentCourseAddStart = $('#student-course-add-start');
    dom.studentCourseAddEnd = $('#student-course-add-end');
    dom.btnStudentCourseAdd = $('#btn-student-course-add');
    dom.btnDownloadStudentCourses = $('#btn-download-student-courses');

    dom.btnCalPrev = $('#btn-cal-prev');
    dom.btnCalNext = $('#btn-cal-next');
    dom.calMonthLabel = $('#calendar-month-label');
    dom.calGrid = $('#calendar-grid');

    dom.dayDetailTitle = $('#day-detail-title');
    dom.dayDetailContent = $('#day-detail-content');
    dom.dayDetailCourse = $('#day-detail-course');
    dom.dayDetailCount = $('#day-detail-count');
    dom.dayDetailKind = $('#day-detail-kind');
    dom.btnDayDetailAdd = $('#btn-day-detail-add');
    dom.btnDownloadLessonLogs = $('#btn-download-lesson-logs');

    // Courses
    dom.coursesFilterGrade = $('#courses-filter-grade');
    dom.coursesFilterQuery = $('#courses-filter-query');
    dom.coursesTableBody = $('#courses-table-body');
    dom.btnDownloadCourses = $('#btn-download-courses');
    dom.courseAddId = $('#course-add-id');
    dom.courseAddName = $('#course-add-name');
    dom.courseAddGrade = $('#course-add-grade');
    dom.courseAddStandard = $('#course-add-standard');
    dom.courseAddNote = $('#course-add-note');
    dom.btnCourseAdd = $('#btn-course-add');

    // Analytics
    dom.analyticsDateStart = $('#analytics-date-start');
    dom.analyticsDateEnd = $('#analytics-date-end');
    dom.analyticsUnit = $('#analytics-unit');
    dom.btnAnalyticsRecalc = $('#btn-analytics-recalc');
    dom.analyticsStudentsBody = $('#analytics-students-body');
    dom.analyticsCoursesBody = $('#analytics-courses-body');
    dom.analyticsTimeline = $('#analytics-timeline');

    // Settings
    dom.settingsLoginId = $('#settings-login-id');
    dom.settingsRole = $('#settings-role');
    dom.passwordChangeForm = $('#password-change-form');
    dom.currentPassword = $('#current-password');
    dom.newPassword = $('#new-password');
    dom.newPasswordConfirm = $('#new-password-confirm');
    dom.passwordChangeMessage = $('#password-change-message');
    dom.btnReloadData = $('#btn-reload-data');
    dom.btnClearLocalStorage = $('#btn-clear-local-storage');
  }

  function attachEventHandlers() {
    if (dom.loginForm) {
      dom.loginForm.addEventListener('submit', onLoginSubmit);
    }
    if (dom.logoutButton) {
      dom.logoutButton.addEventListener('click', onLogoutClick);
    }

    dom.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.dataset.targetView);
      });
    });

    // Students
    if (dom.studentsFilterGrade) {
      dom.studentsFilterGrade.addEventListener('change', renderStudentsView);
      dom.studentsFilterStatus.addEventListener('change', renderStudentsView);
      dom.studentsFilterId.addEventListener('input', renderStudentsView);
    }
    if (dom.btnDownloadStudents) {
      dom.btnDownloadStudents.addEventListener('click', () => DataService.downloadCsv('students'));
    }

    // Student detail & calendar
    if (dom.studentDetailSelect) {
      dom.studentDetailSelect.addEventListener('change', () => {
        state.currentStudentId = dom.studentDetailSelect.value || null;
        refreshStudentDetailView();
      });
    }
    if (dom.btnStudentCourseAdd) {
      dom.btnStudentCourseAdd.addEventListener('click', onStudentCourseAdd);
    }
    if (dom.btnDownloadStudentCourses) {
      dom.btnDownloadStudentCourses.addEventListener('click', () => DataService.downloadCsv('studentCourses'));
    }

    if (dom.btnCalPrev) {
      dom.btnCalPrev.addEventListener('click', () => shiftCalendarMonth(-1));
    }
    if (dom.btnCalNext) {
      dom.btnCalNext.addEventListener('click', () => shiftCalendarMonth(1));
    }
    if (dom.btnDayDetailAdd) {
      dom.btnDayDetailAdd.addEventListener('click', onDayDetailAdd);
    }
    if (dom.btnDownloadLessonLogs) {
      dom.btnDownloadLessonLogs.addEventListener('click', () => DataService.downloadCsv('lessonLogs'));
    }

    // Courses
    if (dom.coursesFilterGrade) {
      dom.coursesFilterGrade.addEventListener('change', renderCoursesView);
      dom.coursesFilterQuery.addEventListener('input', renderCoursesView);
    }
    if (dom.btnDownloadCourses) {
      dom.btnDownloadCourses.addEventListener('click', () => DataService.downloadCsv('courses'));
    }
    if (dom.btnCourseAdd) {
      dom.btnCourseAdd.addEventListener('click', onCourseAdd);
    }

    // Analytics
    if (dom.btnAnalyticsRecalc) {
      dom.btnAnalyticsRecalc.addEventListener('click', recalcAnalytics);
    }

    // Settings
    if (dom.passwordChangeForm) {
      dom.passwordChangeForm.addEventListener('submit', onPasswordChangeSubmit);
    }
    if (dom.btnReloadData) {
      dom.btnReloadData.addEventListener('click', () => DataService.loadAll());
    }
    if (dom.btnClearLocalStorage) {
      dom.btnClearLocalStorage.addEventListener('click', () => {
        if (!window.confirm('ローカル設定（ログイン状態・パスワード変更など）を初期化しますか？')) return;
        localStorage.removeItem(CONFIG.storageKeys.currentUser);
        localStorage.removeItem(CONFIG.storageKeys.passwords);
        showGlobalMessage('ローカル設定を初期化しました。ページを再読み込みします。', 'success', 2500);
        setTimeout(() => window.location.reload(), 800);
      });
    }
  }

  // ---------------------------------------------------------
  // ログイン / ログアウト
  // ---------------------------------------------------------
  function onLoginSubmit(e) {
    e.preventDefault();
    const id = dom.loginId.value.trim();
    const pw = dom.loginPassword.value;
    dom.loginError.textContent = '';
    try {
      Auth.login(id, pw);
      dom.loginPassword.value = '';
      dom.loginId.value = '';
      showMainView();
      DataService.loadAll();
    } catch (err) {
      dom.loginError.textContent = err.message || 'ログインに失敗しました。';
    }
  }

  function onLogoutClick() {
    if (!window.confirm('ログアウトしますか？')) return;
    Auth.logout();
    state.dataLoaded = false;
    showLoginView();
  }

  function showLoginView() {
    showElement(dom.loginView);
    hideElement(dom.mainView);
  }

  function showMainView() {
    hideElement(dom.loginView);
    showElement(dom.mainView);
    navigateTo('dashboard');
    refreshSettingsView();
  }

  function updateHeaderUserInfo() {
    if (!dom.headerUserLabel || !dom.headerUserRole) return;
    if (!Auth.currentUser) {
      dom.headerUserLabel.textContent = '';
      dom.headerUserRole.textContent = '';
      return;
    }
    dom.headerUserLabel.textContent = Auth.currentUser.label || Auth.currentUser.id;
    const roleLabel =
      Auth.currentUser.role === ROLES.ADMIN ? '管理者' :
      Auth.currentUser.role === ROLES.TEACHER ? '講師' :
      '生徒';
    dom.headerUserRole.textContent = roleLabel;
  }

  function applyRoleVisibility() {
    const role = Auth.currentUser ? Auth.currentUser.role : null;
    $all('[data-role-visible]').forEach(el => {
      const rolesStr = el.getAttribute('data-role-visible') || '';
      const roles = rolesStr.split(',').map(r => r.trim()).filter(Boolean);
      if (!roles.length) return;
      if (!role || !roles.includes(role)) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
      }
    });
  }

  // ---------------------------------------------------------
  // ナビゲーション
  // ---------------------------------------------------------
  function navigateTo(viewKey) {
    if (!dom.views[viewKey]) return;
    dom.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.targetView === viewKey);
    });
    Object.entries(dom.views).forEach(([key, el]) => {
      if (!el) return;
      if (key === viewKey) showElement(el);
      else hideElement(el);
    });

    // 各ビューの描画
    switch (viewKey) {
      case 'dashboard':
        renderDashboardView();
        break;
      case 'students':
        renderStudentsView();
        break;
      case 'studentDetail':
        renderStudentDetailView();
        break;
      case 'courses':
        renderCoursesView();
        break;
      case 'analytics':
        setupAnalyticsDefaultsIfNeeded();
        recalcAnalytics();
        break;
      case 'settings':
        refreshSettingsView();
        break;
    }
  }

  function refreshAllViews() {
    renderDashboardView();
    renderStudentsView();
    renderStudentDetailView();
    renderCoursesView();
    setupAnalyticsDefaultsIfNeeded();
    recalcAnalytics();
    refreshSettingsView();
  }

  // ---------------------------------------------------------
  // ローディングインジケータ
  // ---------------------------------------------------------
  function setLoadingIndicator(isLoading) {
    state.isLoading = isLoading;
    document.body.style.cursor = isLoading ? 'progress' : 'default';
  }

  function updateUnsavedIndicator() {
    if (DataService.hasDirty()) {
      showElement(dom.unsavedIndicator);
    } else {
      hideElement(dom.unsavedIndicator);
    }
  }

  // ---------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------
  function renderDashboardView() {
    if (!state.dataLoaded || !Auth.currentUser) return;

    // KPI: active students
    const activeStudents = state.students.filter(s => String(s.status).toLowerCase() === 'active');
    setText(dom.kpiActiveStudents, activeStudents.length);

    // KPI: this month logs (actual)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthLogs = state.lessonLogs.filter(log => {
      const dt = parseDate(log.date);
      if (!dt) return false;
      if (isPlannedLog(log)) return false;
      return dt >= monthStart && dt <= monthEnd;
    });
    const monthCount = monthLogs.reduce((sum, log) => sum + (parseFloat(log.count) || 0), 0);
    setText(dom.kpiMonthLogs, monthCount);

    // KPI: avg achievement
    const perStudent = computeStudentAchievement(null, null);
    if (!perStudent.length) {
      setText(dom.kpiAvgAchievement, '-');
    } else {
      const ratios = perStudent
        .filter(r => r.planned > 0)
        .map(r => r.actual / r.planned);
      const avg =
        ratios.length > 0
          ? ratios.reduce((a, b) => a + b, 0) / ratios.length
          : 0;
      setText(dom.kpiAvgAchievement, formatPercent(avg));
    }

    // Student summary table
    let summaryRows = perStudent;
    const role = Auth.currentUser.role;
    if (role === ROLES.STUDENT && Auth.currentUser.studentId) {
      summaryRows = perStudent.filter(r => r.student.student_id === Auth.currentUser.studentId);
      setText(dom.dashboardStudentSummaryTitle, 'あなたの進捗');
    } else {
      setText(dom.dashboardStudentSummaryTitle, '生徒別進捗サマリ（期間指定なしの全体）');
    }

    const tbody = dom.dashboardStudentSummaryBody;
    tbody.innerHTML = '';
    if (!summaryRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '表示できるデータがありません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    summaryRows.forEach(r => {
      const tr = document.createElement('tr');
      const s = r.student;
      tr.innerHTML = `
        <td>${s.student_id}</td>
        <td>${s.grade || ''}</td>
        <td>${s.course_group || ''}</td>
        <td>${r.planned.toFixed(1)}</td>
        <td>${r.actual.toFixed(1)}</td>
        <td>${formatPercent(r.planned > 0 ? r.actual / r.planned : NaN)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------
  // 生徒一覧
  // ---------------------------------------------------------
  function renderStudentsView() {
    if (!state.dataLoaded) return;
    const tbody = dom.studentsTableBody;
    tbody.innerHTML = '';

    // フィルタ項目の初期化（初回のみ）
    const grades = Array.from(new Set(state.students.map(s => s.grade).filter(Boolean)));
    if (dom.studentsFilterGrade && dom.studentsFilterGrade.options.length <= 1) {
      grades.sort().forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        dom.studentsFilterGrade.appendChild(opt);
      });
    }

    const filterGrade = dom.studentsFilterGrade.value;
    const filterStatus = dom.studentsFilterStatus.value;
    const filterId = dom.studentsFilterId.value.trim().toLowerCase();

    let students = state.students.slice();
    if (filterGrade) {
      students = students.filter(s => String(s.grade) === filterGrade);
    }
    if (filterStatus) {
      students = students.filter(s => String(s.status).toLowerCase() === filterStatus);
    }
    if (filterId) {
      students = students.filter(s => String(s.student_id).toLowerCase().includes(filterId));
    }

    students.sort((a, b) => {
      if (a.grade === b.grade) return String(a.student_id).localeCompare(b.student_id);
      return String(a.grade).localeCompare(b.grade);
    });

    if (!students.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '該当する生徒がいません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    students.forEach(s => {
      const tr = document.createElement('tr');
      const statusLabel = String(s.status || '').toLowerCase();
      tr.innerHTML = `
        <td>${s.student_id}</td>
        <td>${s.grade || ''}</td>
        <td>${s.course_group || ''}</td>
        <td>${statusLabel}</td>
        <td></td>
      `;
      const actionTd = tr.lastElementChild;
      const btn = document.createElement('button');
      btn.className = 'btn small-btn';
      btn.textContent = '詳細';
      btn.addEventListener('click', () => {
        state.currentStudentId = s.student_id;
        dom.studentDetailSelect.value = s.student_id;
        navigateTo('studentDetail');
        refreshStudentDetailView();
      });
      actionTd.appendChild(btn);
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------
  // 生徒詳細 & カレンダー
  // ---------------------------------------------------------
  function renderStudentDetailView() {
    if (!state.dataLoaded || !Auth.currentUser) return;

    // 生徒セレクトの構築（初回 or データ更新時）
    if (dom.studentDetailSelect && !dom.studentDetailSelect._initialized) {
      dom.studentDetailSelect.innerHTML = '<option value="">生徒を選択</option>';
      state.students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.student_id;
        opt.textContent = `${s.student_id} (${s.grade || ''} / ${s.course_group || ''})`;
        dom.studentDetailSelect.appendChild(opt);
      });
      dom.studentDetailSelect._initialized = true;
    }

    // ロールに応じて初期選択
    if (!state.currentStudentId && Auth.currentUser.role === ROLES.STUDENT && Auth.currentUser.studentId) {
      state.currentStudentId = Auth.currentUser.studentId;
    }

    if (state.currentStudentId) {
      dom.studentDetailSelect.value = state.currentStudentId;
    }

    refreshStudentDetailView();
  }

  function refreshStudentDetailView() {
    const studentId = state.currentStudentId;
    if (!studentId) {
      setText(dom.studentDetailInfo, '');
      setText(dom.studentDetailHint, '生徒を選択してください。');
      dom.studentCoursesBody.innerHTML = '<tr><td colspan="6" class="text-muted">生徒を選択してください。</td></tr>';
      dom.dayDetailTitle.textContent = '日付をクリックすると詳細が表示されます。';
      dom.dayDetailContent.innerHTML = '<p class="text-muted">まだ日付が選択されていません。</p>';
      dom.calGrid.innerHTML = '';
      return;
    }

    const s = state.students.find(st => st.student_id === studentId);
    if (!s) {
      setText(dom.studentDetailInfo, '');
      setText(dom.studentDetailHint, '指定された生徒IDが見つかりません。');
      return;
    }

    setText(dom.studentDetailInfo, `生徒ID: ${s.student_id} / 学年: ${s.grade || '-'} / コース群: ${s.course_group || '-'}`);
    setText(dom.studentDetailHint, 'student_courses.csv の情報を元に予定講数・期間を表示します。');

    // 講座セレクト（追加用）
    dom.studentCourseAddCourse.innerHTML = '';
    state.courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.course_id;
      opt.textContent = `${c.course_id} (${c.course_name || ''})`;
      dom.studentCourseAddCourse.appendChild(opt);
    });

    // 日詳細の講座セレクト
    dom.dayDetailCourse.innerHTML = '';
    const scList = state.studentCourses.filter(sc => sc.student_id === studentId);
    scList.forEach(sc => {
      const course = state.courses.find(c => c.course_id === sc.course_id);
      const label = course
        ? `${course.course_id} (${course.course_name || ''})`
        : sc.course_id;
      const opt = document.createElement('option');
      opt.value = sc.course_id;
      opt.textContent = label;
      dom.dayDetailCourse.appendChild(opt);
    });
    // 関連講座がなければ全講座を候補に
    if (!scList.length) {
      state.courses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.course_id;
        opt.textContent = `${c.course_id} (${c.course_name || ''})`;
        dom.dayDetailCourse.appendChild(opt);
      });
    }

    renderStudentCoursesTable(studentId);
    initCalendarIfNeeded();
    renderCalendar(studentId);
    renderDayDetail(null); // 選択解除
  }

  function renderStudentCoursesTable(studentId) {
    const tbody = dom.studentCoursesBody;
    tbody.innerHTML = '';

    const scList = state.studentCourses.filter(sc => sc.student_id === studentId);
    if (!scList.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '紐づいている講座がありません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const role = Auth.currentUser.role;
    const editable = role === ROLES.ADMIN;

    scList.forEach(sc => {
      const course = state.courses.find(c => c.course_id === sc.course_id);
      const logs = state.lessonLogs.filter(log => log.student_id === studentId && log.course_id === sc.course_id && !isPlannedLog(log));
      const actualCount = logs.reduce((sum, l) => sum + (parseFloat(l.count) || 0), 0);
      const planned = parseFloat(sc.planned_sessions || '0') || 0;
      const rate = planned > 0 ? actualCount / planned : NaN;

      const tr = document.createElement('tr');
      const periodText = `${sc.start_date || '-'} 〜 ${sc.end_date || '-'}`;
      const courseName = course ? course.course_name || '' : '';
      tr.innerHTML = `
        <td>${sc.course_id}</td>
        <td>${courseName}</td>
        <td></td>
        <td>${actualCount}</td>
        <td>${formatPercent(rate)}</td>
        <td>${periodText}</td>
      `;
      const plannedTd = tr.children[2];
      if (editable) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.value = sc.planned_sessions || '';
        input.style.width = '80px';
        input.addEventListener('change', () => {
          sc.planned_sessions = input.value;
          DataService.markDirty('studentCourses');
          renderDashboardView();
          recalcAnalytics();
        });
        plannedTd.appendChild(input);
      } else {
        plannedTd.textContent = planned ? String(planned) : '-';
      }

      tbody.appendChild(tr);
    });
  }

  function onStudentCourseAdd() {
    const studentId = state.currentStudentId;
    if (!studentId) {
      showGlobalMessage('先に生徒を選択してください。', 'error');
      return;
    }
    const courseId = dom.studentCourseAddCourse.value;
    const planned = dom.studentCourseAddPlanned.value;
    const start = dom.studentCourseAddStart.value;
    const end = dom.studentCourseAddEnd.value;

    if (!courseId) {
      showGlobalMessage('講座を選択してください。', 'error');
      return;
    }
    const existing = state.studentCourses.find(sc => sc.student_id === studentId && sc.course_id === courseId);
    if (existing) {
      showGlobalMessage('すでにこの生徒に紐づいている講座です。', 'error');
      return;
    }

    const row = {
      student_id: studentId,
      course_id: courseId,
      planned_sessions: planned || '0',
      start_date: start || '',
      end_date: end || ''
    };
    state.studentCourses.push(row);
    DataService.markDirty('studentCourses');
    renderStudentCoursesTable(studentId);
    refreshStudentDetailView();
    showGlobalMessage('講座を追加しました。student_courses.csv をダウンロードして GitHub に反映してください。', 'success');
  }

  // ---------------------------------------------------------
  // カレンダー
  // ---------------------------------------------------------
  function initCalendarIfNeeded() {
    if (state.calendar.year != null) return;
    const today = new Date();
    state.calendar.year = today.getFullYear();
    state.calendar.month = today.getMonth();
    state.calendar.selectedDateStr = null;
  }

  function shiftCalendarMonth(delta) {
    if (state.calendar.year == null) initCalendarIfNeeded();
    let year = state.calendar.year;
    let month = state.calendar.month + delta;
    if (month < 0) {
      month = 11;
      year--;
    } else if (month > 11) {
      month = 0;
      year++;
    }
    state.calendar.year = year;
    state.calendar.month = month;
    renderCalendar(state.currentStudentId);
  }

  function renderCalendar(studentId) {
    if (!studentId) {
      dom.calMonthLabel.textContent = '';
      dom.calGrid.innerHTML = '';
      return;
    }

    const year = state.calendar.year;
    const month = state.calendar.month;
    const monthLabel = `${year}年${month + 1}月`;
    dom.calMonthLabel.textContent = monthLabel;

    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dailyMap = computeDailyCounts(studentId, year, month);
    const todayStr = dateToStr(new Date());

    dom.calGrid.innerHTML = '';
    const totalCells = 42; // 7 x 6
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'calendar-cell';

      const dayNumber = cellIndex - firstWeekday + 1;
      const isCurrentMonthDay = dayNumber >= 1 && dayNumber <= daysInMonth;

      if (!isCurrentMonthDay) {
        cell.classList.add('disabled');
        dom.calGrid.appendChild(cell);
        continue;
      }

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
      const info = dailyMap[dateStr] || { planned: 0, actual: 0 };

      if (dateStr === todayStr) {
        cell.classList.add('calendar-cell-today');
      }
      if (state.calendar.selectedDateStr === dateStr) {
        cell.classList.add('calendar-cell-selected');
      }

      const dayNumEl = document.createElement('div');
      dayNumEl.className = 'calendar-day-number';
      dayNumEl.textContent = dayNumber;
      cell.appendChild(dayNumEl);

      const countsEl = document.createElement('div');
      countsEl.className = 'calendar-day-counts';
      if (info.actual > 0 || info.planned > 0) {
        const aSpan = document.createElement('span');
        aSpan.textContent = info.actual.toFixed(1).replace(/\.0$/, '') || '0';
        const sepSpan = document.createElement('span');
        sepSpan.textContent = ' / ';
        const pSpan = document.createElement('span');
        pSpan.textContent = info.planned.toFixed(1).replace(/\.0$/, '') || '0';
        countsEl.appendChild(aSpan);
        countsEl.appendChild(sepSpan);
        countsEl.appendChild(pSpan);
      } else {
        countsEl.innerHTML = '&nbsp;';
      }
      cell.appendChild(countsEl);

      const total = info.actual + info.planned;
      if (total > 0) {
        const badge = document.createElement('div');
        badge.className = 'calendar-day-badge';
        if (info.actual >= info.planned) {
          badge.classList.add('actual-dominant');
          badge.textContent = '◎ 実績';
        } else {
          badge.classList.add('planned-dominant');
          badge.textContent = '△ 予定';
        }
        cell.appendChild(badge);
      }

      cell.addEventListener('click', () => {
        state.calendar.selectedDateStr = dateStr;
        renderCalendar(studentId);
        renderDayDetail(dateStr);
      });

      dom.calGrid.appendChild(cell);
    }
  }

  function computeDailyCounts(studentId, year, month) {
    const map = {};
    state.lessonLogs.forEach(log => {
      if (log.student_id !== studentId) return;
      const dt = parseDate(log.date);
      if (!dt) return;
      if (dt.getFullYear() !== year || dt.getMonth() !== month) return;

      const dateStr = dateToStr(dt);
      if (!map[dateStr]) {
        map[dateStr] = { planned: 0, actual: 0 };
      }
      const count = parseFloat(log.count) || 0;
      if (isPlannedLog(log)) {
        map[dateStr].planned += count;
      } else {
        map[dateStr].actual += count;
      }
    });
    return map;
  }

  function isPlannedLog(log) {
    const kind = (log.kind || '').toLowerCase();
    if (kind === 'planned') return true;
    const reg = (log.registered_by || '').toLowerCase();
    if (reg === 'plan' || reg === 'planned') return true;
    return false;
  }

  function renderDayDetail(dateStr) {
    const studentId = state.currentStudentId;
    if (!studentId) return;
    if (!dateStr) {
      state.calendar.selectedDateStr = null;
      dom.dayDetailTitle.textContent = '日付をクリックすると詳細が表示されます。';
      dom.dayDetailContent.innerHTML = '<p class="text-muted">まだ日付が選択されていません。</p>';
      return;
    }

    dom.dayDetailTitle.textContent = formatDateLabel(dateStr);

    const logs = state.lessonLogs
      .filter(log => log.student_id === studentId && log.date === dateStr)
      .sort((a, b) => (a.log_id || '').localeCompare(b.log_id || ''));

    const container = document.createElement('div');

    if (!logs.length) {
      const p = document.createElement('p');
      p.textContent = 'この日には登録された予定・実績がありません。';
      p.className = 'text-muted';
      container.appendChild(p);
    } else {
      const tableWrapper = document.createElement('div');
      tableWrapper.className = 'table-wrapper';
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>種別</th>
          <th>講座</th>
          <th>コマ数</th>
          <th>登録者</th>
          <th>登録日時</th>
          <th></th>
        </tr>
      `;
      const tbody = document.createElement('tbody');

      logs.forEach(log => {
        const tr = document.createElement('tr');
        const course = state.courses.find(c => c.course_id === log.course_id);
        const label = course
          ? `${course.course_id} (${course.course_name || ''})`
          : log.course_id;

        const kindLabel = isPlannedLog(log) ? '予定' : '実績';
        tr.innerHTML = `
          <td>${kindLabel}</td>
          <td>${label}</td>
          <td>${log.count}</td>
          <td>${log.registered_by || ''}</td>
          <td>${log.created_at || ''}</td>
          <td></td>
        `;
        const actionTd = tr.lastElementChild;
        const role = Auth.currentUser.role;
        const canDelete = role === ROLES.ADMIN || role === ROLES.TEACHER || (role === ROLES.STUDENT && log.registered_by === Auth.currentUser.id);
        if (canDelete) {
          const btn = document.createElement('button');
          btn.className = 'btn small-btn';
          btn.textContent = '削除';
          btn.addEventListener('click', () => {
            if (!window.confirm('このログを削除しますか？')) return;
            const idx = state.lessonLogs.findIndex(l => l.log_id === log.log_id);
            if (idx >= 0) {
              state.lessonLogs.splice(idx, 1);
              DataService.markDirty('lessonLogs');
              renderCalendar(studentId);
              renderDayDetail(dateStr);
              renderStudentCoursesTable(studentId);
              renderDashboardView();
              recalcAnalytics();
            }
          });
          actionTd.appendChild(btn);
        }
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrapper.appendChild(table);
      container.appendChild(tableWrapper);
    }

    dom.dayDetailContent.innerHTML = '';
    dom.dayDetailContent.appendChild(container);
  }

  function onDayDetailAdd() {
    const studentId = state.currentStudentId;
    const dateStr = state.calendar.selectedDateStr;
    if (!studentId) {
      showGlobalMessage('先に生徒を選択してください。', 'error');
      return;
    }
    if (!dateStr) {
      showGlobalMessage('先にカレンダーで日付を選択してください。', 'error');
      return;
    }
    const courseId = dom.dayDetailCourse.value;
    const count = parseFloat(dom.dayDetailCount.value);
    const kind = dom.dayDetailKind.value;

    if (!courseId) {
      showGlobalMessage('講座を選択してください。', 'error');
      return;
    }
    if (!isFinite(count) || count <= 0) {
      showGlobalMessage('コマ数は 0 より大きい数値を入力してください。', 'error');
      return;
    }

    const newId = generateLogId(dateStr, studentId);
    const nowIso = new Date().toISOString();
    const log = {
      log_id: newId,
      date: dateStr,
      student_id: studentId,
      course_id: courseId,
      count: String(count),
      registered_by: Auth.currentUser ? Auth.currentUser.id : 'admin',
      created_at: nowIso,
      kind: kind
    };
    state.lessonLogs.push(log);
    DataService.markDirty('lessonLogs');
    renderCalendar(studentId);
    renderDayDetail(dateStr);
    renderStudentCoursesTable(studentId);
    renderDashboardView();
    recalcAnalytics();
    showGlobalMessage('受講ログを追加しました。lesson_logs.csv をダウンロードして GitHub に反映してください。', 'success');
  }

  function generateLogId(dateStr, studentId) {
    const sameDay = state.lessonLogs.filter(
      l => l.date === dateStr && l.student_id === studentId
    );
    let maxSeq = 0;
    sameDay.forEach(l => {
      const parts = String(l.log_id || '').split('-');
      const seqStr = parts[parts.length - 1];
      const n = parseInt(seqStr, 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    });
    const seq = maxSeq + 1;
    const base = dateStr.replace(/-/g, '');
    return `${base}-${studentId}-${seq}`;
  }

  // ---------------------------------------------------------
  // 講座マスタ
  // ---------------------------------------------------------
  function renderCoursesView() {
    if (!state.dataLoaded) return;
    const tbody = dom.coursesTableBody;
    tbody.innerHTML = '';

    // フィルタ用対象学年
    const grades = Array.from(new Set(state.courses.map(c => c.target_grade).filter(Boolean))).sort();
    if (dom.coursesFilterGrade && dom.coursesFilterGrade.options.length <= 1) {
      grades.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        dom.coursesFilterGrade.appendChild(opt);
      });
    }

    const filterGrade = dom.coursesFilterGrade.value;
    const query = dom.coursesFilterQuery.value.trim().toLowerCase();

    let courses = state.courses.slice();
    if (filterGrade) {
      courses = courses.filter(c => String(c.target_grade) === filterGrade);
    }
    if (query) {
      courses = courses.filter(c =>
        String(c.course_id).toLowerCase().includes(query) ||
        String(c.course_name).toLowerCase().includes(query)
      );
    }

    courses.sort((a, b) => String(a.course_id).localeCompare(String(b.course_id)));

    if (!courses.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '該当する講座がありません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const editable = Auth.currentUser.role === ROLES.ADMIN;

    courses.forEach(course => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${course.course_id}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      `;
      const nameTd = tr.children[1];
      const gradeTd = tr.children[2];
      const stdTd = tr.children[3];
      const noteTd = tr.children[4];

      if (editable) {
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = course.course_name || '';
        nameInput.addEventListener('change', () => {
          course.course_name = nameInput.value;
          DataService.markDirty('courses');
          renderDashboardView();
          recalcAnalytics();
        });
        nameTd.appendChild(nameInput);

        const gradeInput = document.createElement('input');
        gradeInput.type = 'text';
        gradeInput.value = course.target_grade || '';
        gradeInput.style.width = '60px';
        gradeInput.addEventListener('change', () => {
          course.target_grade = gradeInput.value;
          DataService.markDirty('courses');
          renderDashboardView();
          recalcAnalytics();
        });
        gradeTd.appendChild(gradeInput);

        const stdInput = document.createElement('input');
        stdInput.type = 'number';
        stdInput.min = '0';
        stdInput.step = '1';
        stdInput.style.width = '80px';
        stdInput.value = course.standard_sessions || '';
        stdInput.addEventListener('change', () => {
          course.standard_sessions = stdInput.value;
          DataService.markDirty('courses');
          renderDashboardView();
          recalcAnalytics();
        });
        stdTd.appendChild(stdInput);

        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.value = course.note || '';
        noteInput.addEventListener('change', () => {
          course.note = noteInput.value;
          DataService.markDirty('courses');
        });
        noteTd.appendChild(noteInput);
      } else {
        nameTd.textContent = course.course_name || '';
        gradeTd.textContent = course.target_grade || '';
        stdTd.textContent = course.standard_sessions || '';
        noteTd.textContent = course.note || '';
      }

      tbody.appendChild(tr);
    });
  }

  function onCourseAdd() {
    const id = dom.courseAddId.value.trim();
    const name = dom.courseAddName.value.trim();
    const grade = dom.courseAddGrade.value.trim();
    const standard = dom.courseAddStandard.value;
    const note = dom.courseAddNote.value.trim();

    if (!id) {
      showGlobalMessage('講座IDを入力してください。', 'error');
      return;
    }
    if (!name) {
      showGlobalMessage('講座名を入力してください。', 'error');
      return;
    }
    if (state.courses.some(c => c.course_id === id)) {
      showGlobalMessage('同じ講座IDが既に存在します。', 'error');
      return;
    }

    const row = {
      course_id: id,
      course_name: name,
      target_grade: grade,
      standard_sessions: standard || '0',
      note: note
    };
    state.courses.push(row);
    DataService.markDirty('courses');
    dom.courseAddId.value = '';
    dom.courseAddName.value = '';
    dom.courseAddGrade.value = '';
    dom.courseAddStandard.value = '0';
    dom.courseAddNote.value = '';
    renderCoursesView();
    showGlobalMessage('講座を追加しました。courses.csv をダウンロードして GitHub に反映してください。', 'success');
  }

  // ---------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------
  function setupAnalyticsDefaultsIfNeeded() {
    if (!dom.analyticsDateStart || !dom.analyticsDateEnd) return;
    if (dom.analyticsDateStart.value && dom.analyticsDateEnd.value) return;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    dom.analyticsDateStart.value = dateToStr(start);
    dom.analyticsDateEnd.value = dateToStr(today);
  }

  function recalcAnalytics() {
    if (!state.dataLoaded) return;
    const startStr = dom.analyticsDateStart.value;
    const endStr = dom.analyticsDateEnd.value;
    const unit = dom.analyticsUnit.value;

    let start = parseDate(startStr);
    let end = parseDate(endStr);
    if (!start || !end) {
      showGlobalMessage('分析期間の日付を正しく入力してください。', 'error');
      return;
    }
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    // 生徒別
    const perStudent = computeStudentAchievement(start, end);
    renderAnalyticsStudents(perStudent);

    // 講座別
    const perCourse = computeCourseAchievement(start, end);
    renderAnalyticsCourses(perCourse);

    // 全体推移
    renderAnalyticsTimeline(start, end, unit);
  }

  function computeStudentAchievement(start, end) {
    const results = [];
    const students = state.students.slice();
    students.forEach(s => {
      const studentId = s.student_id;

      // 計画コマ数: student_courses + 期間に応じて按分
      let planned = 0;
      const scList = state.studentCourses.filter(sc => sc.student_id === studentId);
      scList.forEach(sc => {
        const totalSessions = parseFloat(sc.planned_sessions || '0') || 0;
        if (totalSessions <= 0) return;
        const courseStart = sc.start_date ? parseDate(sc.start_date) : null;
        const courseEnd = sc.end_date ? parseDate(sc.end_date) : null;
        if (!courseStart || !courseEnd) {
          planned += totalSessions;
          return;
        }
        if (start && end) {
          if (courseEnd < start || courseStart > end) {
            return;
          }
          const totalDays = daysBetweenInclusive(courseStart, courseEnd);
          const interStart = clampDateToRange(start, courseStart, courseEnd);
          const interEnd = clampDateToRange(end, courseStart, courseEnd);
          const interDays = daysBetweenInclusive(interStart, interEnd);
          if (totalDays > 0) {
            planned += totalSessions * (interDays / totalDays);
          } else {
            planned += totalSessions;
          }
        } else {
          planned += totalSessions;
        }
      });

      // 実績コマ数: lesson_logs 実績のみ
      const logs = state.lessonLogs.filter(log => {
        if (log.student_id !== studentId) return false;
        if (isPlannedLog(log)) return false;
        const dt = parseDate(log.date);
        if (!dt) return false;
        if (start && dt < start) return false;
        if (end && dt > end) return false;
        return true;
      });
      const actual = logs.reduce((sum, l) => sum + (parseFloat(l.count) || 0), 0);

      results.push({ student: s, planned, actual });
    });
    return results;
  }

  function renderAnalyticsStudents(perStudent) {
    const tbody = dom.analyticsStudentsBody;
    tbody.innerHTML = '';
    if (!perStudent.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '表示できるデータがありません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    perStudent.forEach(r => {
      const tr = document.createElement('tr');
      const s = r.student;
      tr.innerHTML = `
        <td>${s.student_id}</td>
        <td>${s.grade || ''}</td>
        <td>${r.planned.toFixed(1)}</td>
        <td>${r.actual.toFixed(1)}</td>
        <td>${formatPercent(r.planned > 0 ? r.actual / r.planned : NaN)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function computeCourseAchievement(start, end) {
    const results = [];
    const courses = state.courses.slice();
    courses.forEach(c => {
      const courseId = c.course_id;
      const scList = state.studentCourses.filter(sc => sc.course_id === courseId);
      const studentCount = new Set(scList.map(sc => sc.student_id)).size;

      let planned = 0;
      scList.forEach(sc => {
        const totalSessions = parseFloat(sc.planned_sessions || '0') || 0;
        if (totalSessions <= 0) return;
        const courseStart = sc.start_date ? parseDate(sc.start_date) : null;
        const courseEnd = sc.end_date ? parseDate(sc.end_date) : null;
        if (!courseStart || !courseEnd) {
          planned += totalSessions;
          return;
        }
        if (start && end) {
          if (courseEnd < start || courseStart > end) return;
          const totalDays = daysBetweenInclusive(courseStart, courseEnd);
          const interStart = clampDateToRange(start, courseStart, courseEnd);
          const interEnd = clampDateToRange(end, courseStart, courseEnd);
          const interDays = daysBetweenInclusive(interStart, interEnd);
          if (totalDays > 0) {
            planned += totalSessions * (interDays / totalDays);
          } else {
            planned += totalSessions;
          }
        } else {
          planned += totalSessions;
        }
      });

      const logs = state.lessonLogs.filter(log => {
        if (log.course_id !== courseId) return false;
        if (isPlannedLog(log)) return false;
        const dt = parseDate(log.date);
        if (!dt) return false;
        if (start && dt < start) return false;
        if (end && dt > end) return false;
        return true;
      });
      const actual = logs.reduce((sum, l) => sum + (parseFloat(l.count) || 0), 0);

      results.push({ course: c, studentCount, planned, actual });
    });
    return results;
  }

  function renderAnalyticsCourses(perCourse) {
    const tbody = dom.analyticsCoursesBody;
    tbody.innerHTML = '';
    if (!perCourse.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '表示できるデータがありません。';
      td.className = 'text-muted';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    perCourse.forEach(r => {
      const tr = document.createElement('tr');
      const c = r.course;
      tr.innerHTML = `
        <td>${c.course_id}</td>
        <td>${c.course_name || ''}</td>
        <td>${r.studentCount}</td>
        <td>${r.planned.toFixed(1)}</td>
        <td>${r.actual.toFixed(1)}</td>
        <td>${formatPercent(r.planned > 0 ? r.actual / r.planned : NaN)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderAnalyticsTimeline(start, end, unit) {
    const container = dom.analyticsTimeline;
    container.innerHTML = '';

    const actualLogs = state.lessonLogs.filter(log => {
      if (isPlannedLog(log)) return false;
      const dt = parseDate(log.date);
      if (!dt) return false;
      if (start && dt < start) return false;
      if (end && dt > end) return false;
      return true;
    });

    if (!actualLogs.length) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = '表示できる実績ログがありません。';
      container.appendChild(p);
      return;
    }

    const buckets = {};
    actualLogs.forEach(log => {
      const dt = parseDate(log.date);
      if (!dt) return;
      let key;
      if (unit === 'day') {
        key = dateToStr(dt);
      } else if (unit === 'week') {
        const monday = new Date(dt);
        const day = dt.getDay(); // 0=Sun
        const diff = (day + 6) % 7; // Monday=0
        monday.setDate(dt.getDate() - diff);
        key = dateToStr(monday);
      } else if (unit === 'month') {
        key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      }
      const val = parseFloat(log.count) || 0;
      buckets[key] = (buckets[key] || 0) + val;
    });

    const entries = Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]));
    const maxVal = entries.reduce((max, [, v]) => Math.max(max, v), 0) || 1;

    const barsWrapper = document.createElement('div');
    barsWrapper.className = 'timeline-chart-bars';
    entries.forEach(([key, value]) => {
      const barWrapper = document.createElement('div');
      barWrapper.style.display = 'flex';
      barWrapper.style.flexDirection = 'column';
      barWrapper.style.alignItems = 'center';

      const bar = document.createElement('div');
      bar.className = 'timeline-bar';
      const heightPercent = (value / maxVal) * 100;
      bar.style.height = `${heightPercent}%`;

      const valueLabel = document.createElement('div');
      valueLabel.className = 'timeline-bar-value';
      valueLabel.textContent = value.toFixed(0);

      bar.appendChild(valueLabel);

      const label = document.createElement('div');
      label.className = 'timeline-bar-label';
      label.textContent = key;

      barWrapper.appendChild(bar);
      barWrapper.appendChild(label);
      barsWrapper.appendChild(barWrapper);
    });

    container.appendChild(barsWrapper);
  }

  // ---------------------------------------------------------
  // Settings
  // ---------------------------------------------------------
  function refreshSettingsView() {
    if (!Auth.currentUser) return;
    setText(dom.settingsLoginId, Auth.currentUser.id);
    const roleLabel =
      Auth.currentUser.role === ROLES.ADMIN ? '管理者' :
      Auth.currentUser.role === ROLES.TEACHER ? '講師' :
      '生徒';
    setText(dom.settingsRole, roleLabel);
    dom.passwordChangeMessage.textContent = '';
    dom.currentPassword.value = '';
    dom.newPassword.value = '';
    dom.newPasswordConfirm.value = '';
  }

  function onPasswordChangeSubmit(e) {
    e.preventDefault();
    const currentPw = dom.currentPassword.value;
    const newPw = dom.newPassword.value;
    const newPw2 = dom.newPasswordConfirm.value;
    dom.passwordChangeMessage.textContent = '';
    dom.passwordChangeMessage.className = 'small';

    if (!newPw || newPw.length < 4) {
      dom.passwordChangeMessage.textContent = '新しいパスワードは 4 文字以上にしてください。';
      dom.passwordChangeMessage.classList.add('error-text');
      return;
    }
    if (newPw !== newPw2) {
      dom.passwordChangeMessage.textContent = '新しいパスワード（確認）が一致しません。';
      dom.passwordChangeMessage.classList.add('error-text');
      return;
    }

    try {
      Auth.changePassword(currentPw, newPw);
      dom.passwordChangeMessage.textContent = 'パスワードを変更しました。次回ログインから有効になります。';
      dom.passwordChangeMessage.classList.remove('error-text');
    } catch (err) {
      dom.passwordChangeMessage.textContent = err.message || 'パスワード変更に失敗しました。';
      dom.passwordChangeMessage.classList.add('error-text');
    } finally {
      dom.currentPassword.value = '';
      dom.newPassword.value = '';
      dom.newPasswordConfirm.value = '';
    }
  }

  // ---------------------------------------------------------
  // end of IIFE
  // ---------------------------------------------------------
})();
