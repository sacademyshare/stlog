// ===========================================================
// 映像授業受講状況管理 Web アプリ
//  - フロントエンド運用 (GitHub Pages + CSV)
//  - 認証なし (Admin権限で動作)
// ===========================================================
(() => {
  'use strict';

  // ---------------------------------------------------------
  // 設定
  // ---------------------------------------------------------
  const CONFIG = {
    // 運用環境に合わせて調整（通常は ./data または直下）
    dataBasePath: './data', 
    files: {
      students: 'students.csv',
      courses: 'courses.csv',
      studentCourses: 'student_courses.csv',
      lessonLogs: 'lesson_logs.csv'
    }
  };

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
  function $(selector) { return document.querySelector(selector); }
  function $all(selector) { return Array.from(document.querySelectorAll(selector)); }
  function showElement(el) { if (el) el.classList.remove('hidden'); }
  function hideElement(el) { if (el) el.classList.add('hidden'); }
  function setText(el, text) { if (el) el.textContent = text != null ? String(text) : ''; }

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

  // YYYY-MM-DD (or YYYY/MM/DD) -> Date Object
  function parseDate(dateStr) {
    if (!dateStr) return null;
    const normalized = dateStr.replace(/\//g, '-');
    const parts = normalized.split('-').map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysBetweenInclusive(start, end) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.floor((e - s) / msPerDay) + 1;
  }

  function clampDateToRange(date, start, end) {
    if (date < start) return new Date(start.getTime());
    if (date > end) return new Date(end.getTime());
    return date;
  }

  function showGlobalMessage(message, type = 'info', timeoutMs = 4000) {
    const el = dom.globalMessage;
    if (!el) return;
    el.className = 'global-message ' + type;
    el.textContent = message;
    showElement(el);
    if (timeoutMs > 0) {
      if (el._hideTimer) clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => hideElement(el), timeoutMs);
    }
  }

  // ---------------------------------------------------------
  // CSV データ管理
  // ---------------------------------------------------------
  const DataService = {
    headers: {
      students: ['student_id', 'grade', 'course_group', 'status'],
      courses: ['course_id', 'course_name', 'target_grade', 'standard_sessions', 'note'],
      studentCourses: ['student_id', 'course_id', 'planned_sessions', 'start_date', 'end_date'],
      lessonLogs: ['log_id', 'date', 'student_id', 'course_id', 'count', 'registered_by', 'created_at', 'kind']
    },
    dirty: { students: false, courses: false, studentCourses: false, lessonLogs: false },

    async loadAll() {
      state.isLoading = true;
      document.body.style.cursor = 'wait';
      try {
        const [studentsRes, coursesRes, studentCoursesRes, lessonLogsRes] = await Promise.all([
          this._loadCsv('students'),
          this._loadCsv('courses'),
          this._loadCsv('studentCourses'),
          this._loadCsv('lessonLogs')
        ]);

        state.students = studentsRes.rows;
        state.courses = coursesRes.rows;
        state.studentCourses = studentCoursesRes.rows;
        state.lessonLogs = lessonLogsRes.rows;
        
        // kind 列がない場合の補完
        state.lessonLogs.forEach(row => {
          if (!row.kind) row.kind = 'actual';
        });

        state.dataLoaded = true;
        this.resetDirty();
        showGlobalMessage('データを読み込みました。', 'success', 2000);
      } catch (e) {
        console.error(e);
        showGlobalMessage('データ読み込みエラー。./data フォルダにCSVがあるか確認してください。', 'error', 8000);
      } finally {
        state.isLoading = false;
        document.body.style.cursor = 'default';
        refreshAllViews();
      }
    },

    async _loadCsv(kind) {
      const fileName = CONFIG.files[kind];
      const url = `${CONFIG.dataBasePath}/${fileName}?t=${Date.now()}`;
      try {
        const res = await fetch(url);
        if (!res.ok) return { rows: [] };
        const text = await res.text();
        return this.parseCsv(text);
      } catch (e) {
        console.warn('Fetch error:', url, e);
        return { rows: [] };
      }
    },

    parseCsv(text) {
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length < 2) return { rows: [] };
      
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => {
        // 簡易CSVパース（引用符内のカンマ等は考慮しない簡易版）
        const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cells[i] || '';
        });
        return obj;
      });
      return { rows };
    },

    toCsv(headers, rows) {
      const lines = [headers.join(',')];
      rows.forEach(r => {
        const line = headers.map(h => {
          const val = String(r[h] || '').replace(/"/g, '""');
          return /[",]/.test(val) ? `"${val}"` : val;
        }).join(',');
        lines.push(line);
      });
      return lines.join('\n');
    },

    downloadCsv(kind) {
      const headers = this.headers[kind];
      const rows = state[kind];
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
      this.dirty[kind] = true;
      updateUnsavedIndicator();
    },
    resetDirty() {
      Object.keys(this.dirty).forEach(k => this.dirty[k] = false);
      updateUnsavedIndicator();
    },
    hasDirty() {
      return Object.values(this.dirty).some(Boolean);
    }
  };

  function updateUnsavedIndicator() {
    if (DataService.hasDirty()) showElement(dom.unsavedIndicator);
    else hideElement(dom.unsavedIndicator);
  }

  // ---------------------------------------------------------
  // 初期化 & イベント
  // ---------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    attachEvents();
    
    // 即時データロード
    DataService.loadAll();
  });

  function cacheDom() {
    dom.navButtons = $all('.nav-btn');
    dom.views = {
      dashboard: $('#view-dashboard'),
      students: $('#view-students'),
      studentDetail: $('#view-student-detail'),
      courses: $('#view-courses'),
      analytics: $('#view-analytics'),
      settings: $('#view-settings')
    };
    dom.globalMessage = $('#global-message');
    dom.unsavedIndicator = $('#unsaved-indicator');

    // Dashboard
    dom.kpiActiveStudents = $('#kpi-active-students');
    dom.kpiMonthLogs = $('#kpi-month-logs');
    dom.kpiAvgAchievement = $('#kpi-avg-achievement');
    dom.dashboardSummaryBody = $('#dashboard-student-summary-body');

    // Students
    dom.studentsTableBody = $('#students-table-body');
    dom.studentsFilterGrade = $('#students-filter-grade');
    dom.studentsFilterStatus = $('#students-filter-status');
    dom.studentsFilterId = $('#students-filter-id');

    // Detail
    dom.studentDetailSelect = $('#student-detail-select');
    dom.studentDetailInfo = $('#student-detail-info');
    dom.studentCoursesBody = $('#student-courses-body');
    dom.calGrid = $('#calendar-grid');
    dom.calMonthLabel = $('#calendar-month-label');
    dom.dayDetailContent = $('#day-detail-content');
    dom.dayDetailTitle = $('#day-detail-title');
    dom.dayDetailCourse = $('#day-detail-course');
    
    // Inputs
    dom.detailAddCourse = $('#student-course-add-course');
    dom.detailAddPlanned = $('#student-course-add-planned');
    dom.detailAddStart = $('#student-course-add-start');
    dom.detailAddEnd = $('#student-course-add-end');
    
    // Day Log Inputs
    dom.logAddCount = $('#day-detail-count');
    dom.logAddKind = $('#day-detail-kind');

    // Courses
    dom.coursesTableBody = $('#courses-table-body');
    dom.courseAddId = $('#course-add-id');
    dom.courseAddName = $('#course-add-name');
    dom.courseAddGrade = $('#course-add-grade');
    dom.courseAddStandard = $('#course-add-standard');
    dom.courseAddNote = $('#course-add-note');

    // Analytics
    dom.anaStart = $('#analytics-date-start');
    dom.anaEnd = $('#analytics-date-end');
    dom.anaUnit = $('#analytics-unit');
    dom.anaStudentsBody = $('#analytics-students-body');
    dom.anaCoursesBody = $('#analytics-courses-body');
    dom.anaTimeline = $('#analytics-timeline');
  }

  function attachEvents() {
    // Nav
    dom.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.targetView;
        dom.navButtons.forEach(b => b.classList.toggle('active', b === btn));
        Object.values(dom.views).forEach(v => hideElement(v));
        showElement(dom.views[target]);
        
        if (target === 'analytics') setupAnalyticsDates();
        if (target === 'studentDetail') refreshStudentDetailView();
        
        refreshAllViews();
      });
    });

    // Students
    $('#students-filter-grade').addEventListener('change', renderStudentsView);
    $('#students-filter-status').addEventListener('change', renderStudentsView);
    $('#students-filter-id').addEventListener('input', renderStudentsView);
    $('#btn-download-students').addEventListener('click', () => DataService.downloadCsv('students'));

    // Detail
    dom.studentDetailSelect.addEventListener('change', (e) => {
      state.currentStudentId = e.target.value;
      refreshStudentDetailView();
    });
    $('#btn-student-course-add').addEventListener('click', onAddStudentCourse);
    $('#btn-cal-prev').addEventListener('click', () => shiftMonth(-1));
    $('#btn-cal-next').addEventListener('click', () => shiftMonth(1));
    $('#btn-day-detail-add').addEventListener('click', onAddLog);
    $('#btn-download-student-courses').addEventListener('click', () => DataService.downloadCsv('studentCourses'));
    $('#btn-download-lesson-logs').addEventListener('click', () => DataService.downloadCsv('lessonLogs'));

    // Courses
    $('#btn-download-courses').addEventListener('click', () => DataService.downloadCsv('courses'));
    $('#btn-course-add').addEventListener('click', onAddCourse);
    $('#courses-filter-grade').addEventListener('change', renderCoursesView);
    $('#courses-filter-query').addEventListener('input', renderCoursesView);

    // Analytics
    $('#btn-analytics-recalc').addEventListener('click', recalcAnalytics);

    // Settings
    $('#btn-reload-data').addEventListener('click', () => DataService.loadAll());
    $('#btn-clear-local-storage').addEventListener('click', () => {
      localStorage.clear();
      location.reload();
    });
  }

  function refreshAllViews() {
    if (!state.dataLoaded) return;
    renderDashboard();
    renderStudentsView();
    renderStudentDetailView(); // ここで自動選択ロジックが走る
    renderCoursesView();
  }

  // ---------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------
  function renderDashboard() {
    const active = state.students.filter(s => s.status === 'active').length;
    setText(dom.kpiActiveStudents, active);

    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthLogs = state.lessonLogs.filter(l => l.date.startsWith(monthPrefix) && l.kind !== 'planned');
    const totalCount = monthLogs.reduce((acc, cur) => acc + (parseFloat(cur.count)||0), 0);
    setText(dom.kpiMonthLogs, totalCount);

    const achievements = computeAchievements();
    const avg = achievements.reduce((acc, c) => acc + c.rate, 0) / (achievements.length || 1);
    setText(dom.kpiAvgAchievement, formatPercent(avg));

    // Table
    const tbody = dom.dashboardSummaryBody;
    tbody.innerHTML = '';
    achievements.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.id}</td>
        <td>${row.grade}</td>
        <td>${row.group}</td>
        <td>${row.planned.toFixed(1)}</td>
        <td>${row.actual.toFixed(1)}</td>
        <td>${formatPercent(row.rate)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function computeAchievements(start, end) {
    return state.students.map(s => {
      const scList = state.studentCourses.filter(sc => sc.student_id === s.student_id);
      let planned = 0;
      // 単純化: 期間指定がある場合は按分計算
      scList.forEach(sc => {
        let p = parseFloat(sc.planned_sessions)||0;
        if (start && end && sc.start_date && sc.end_date) {
          const cs = parseDate(sc.start_date);
          const ce = parseDate(sc.end_date);
          const totalDays = daysBetweenInclusive(cs, ce);
          const is = clampDateToRange(start, cs, ce);
          const ie = clampDateToRange(end, cs, ce);
          const interDays = daysBetweenInclusive(is, ie);
          if (totalDays > 0 && interDays > 0) {
            p = p * (interDays / totalDays);
          } else if (ce < start || cs > end) {
            p = 0;
          }
        }
        planned += p;
      });

      const logs = state.lessonLogs.filter(l => {
        if (l.student_id !== s.student_id) return false;
        if (l.kind === 'planned') return false;
        if (start || end) {
          const d = parseDate(l.date);
          if (start && d < start) return false;
          if (end && d > end) return false;
        }
        return true;
      });
      const actual = logs.reduce((acc, l) => acc + (parseFloat(l.count)||0), 0);
      return {
        id: s.student_id,
        grade: s.grade,
        group: s.course_group,
        planned,
        actual,
        rate: planned ? actual / planned : 0
      };
    });
  }

  // ---------------------------------------------------------
  // Students
  // ---------------------------------------------------------
  function renderStudentsView() {
    const tbody = dom.studentsTableBody;
    tbody.innerHTML = '';
    
    // Filter Build
    const gradeSelect = dom.studentsFilterGrade;
    const grades = [...new Set(state.students.map(s => s.grade).filter(Boolean))].sort();
    if (gradeSelect.options.length === 1) {
      grades.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        gradeSelect.appendChild(opt);
      });
    }

    const fGrade = gradeSelect.value;
    const fStatus = dom.studentsFilterStatus.value;
    const fId = dom.studentsFilterId.value.toLowerCase();

    state.students.filter(s => {
      if (fGrade && s.grade !== fGrade) return false;
      if (fStatus && s.status !== fStatus) return false;
      if (fId && !s.student_id.toLowerCase().includes(fId)) return false;
      return true;
    }).forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.student_id}</td>
        <td>${s.grade}</td>
        <td>${s.course_group}</td>
        <td>${s.status}</td>
        <td><button class="btn small-btn">選択</button></td>
      `;
      tr.querySelector('button').addEventListener('click', () => {
        state.currentStudentId = s.student_id;
        dom.navButtons.forEach(b => b.classList.remove('active'));
        $all('[data-target-view="student-detail"]').forEach(b => b.classList.add('active'));
        hideElement(dom.views.students);
        showElement(dom.views.studentDetail);
        refreshStudentDetailView();
      });
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------
  // Student Detail
  // ---------------------------------------------------------
  function refreshStudentDetailView() {
    // 1. 生徒セレクトボックスの構築
    const select = dom.studentDetailSelect;
    if (select.options.length === 0) {
      state.students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.student_id;
        opt.textContent = `${s.student_id} : ${s.grade || ''}`;
        select.appendChild(opt);
      });
    }

    // 2. 自動選択ロジック（未選択なら先頭を選ぶ）
    if (!state.currentStudentId && state.students.length > 0) {
      state.currentStudentId = state.students[0].student_id;
    }
    select.value = state.currentStudentId || '';

    // 3. 表示更新
    const sId = state.currentStudentId;
    if (!sId) return;

    const student = state.students.find(s => s.student_id === sId);
    if (student) {
      setText(dom.studentDetailInfo, `${student.course_group} / ${student.status}`);
    }

    // 講座リスト構築（追加用セレクトも更新）
    dom.detailAddCourse.innerHTML = '';
    state.courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.course_id;
      opt.textContent = `${c.course_name} (${c.course_id})`;
      dom.detailAddCourse.appendChild(opt);
    });

    renderStudentCourses(sId);
    
    // カレンダー
    if (!state.calendar.year) {
      const now = new Date();
      state.calendar.year = now.getFullYear();
      state.calendar.month = now.getMonth();
    }
    renderCalendar(sId);
    renderDayDetail(state.calendar.selectedDateStr); // 保持していた選択日を再描画
  }

  function renderStudentCourses(sId) {
    const tbody = dom.studentCoursesBody;
    tbody.innerHTML = '';
    const myCourses = state.studentCourses.filter(sc => sc.student_id === sId);
    
    // DayDetail用の講座セレクトも更新
    dom.dayDetailCourse.innerHTML = '';

    myCourses.forEach(sc => {
      const c = state.courses.find(cx => cx.course_id === sc.course_id) || {};
      const actual = state.lessonLogs
        .filter(l => l.student_id === sId && l.course_id === sc.course_id && l.kind !== 'planned')
        .reduce((sum, l) => sum + (parseFloat(l.count)||0), 0);
      const planned = parseFloat(sc.planned_sessions)||0;
      const rate = planned ? actual / planned : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${sc.course_id}</td>
        <td>${c.course_name || ''}</td>
        <td><input type="number" value="${planned}" style="width:60px"></td>
        <td>${actual}</td>
        <td>${formatPercent(rate)}</td>
        <td>${sc.start_date}<br>${sc.end_date}</td>
      `;
      // 計画数変更
      tr.querySelector('input').addEventListener('change', (e) => {
        sc.planned_sessions = e.target.value;
        DataService.markDirty('studentCourses');
        renderDashboard(); // KPI更新
      });
      tbody.appendChild(tr);

      // セレクトに追加
      const opt = document.createElement('option');
      opt.value = sc.course_id;
      opt.textContent = c.course_name || sc.course_id;
      dom.dayDetailCourse.appendChild(opt);
    });

    // コース未登録でもログ入力できるように、全コースをセレクトに入れるか？
    // -> 現状は紐づけ済みコースのみ表示する形とする。空なら「紐づけなし」
    if (myCourses.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = "(講座が紐づいていません)";
      dom.dayDetailCourse.appendChild(opt);
    }
  }

  function onAddStudentCourse() {
    const sId = state.currentStudentId;
    if (!sId) return;
    const cId = dom.detailAddCourse.value;
    if (state.studentCourses.some(sc => sc.student_id === sId && sc.course_id === cId)) {
      alert('既に登録されています');
      return;
    }
    state.studentCourses.push({
      student_id: sId,
      course_id: cId,
      planned_sessions: dom.detailAddPlanned.value,
      start_date: dom.detailAddStart.value,
      end_date: dom.detailAddEnd.value
    });
    DataService.markDirty('studentCourses');
    refreshStudentDetailView();
  }

  // ---------------------------------------------------------
  // Calendar Logic
  // ---------------------------------------------------------
  function shiftMonth(delta) {
    state.calendar.month += delta;
    if (state.calendar.month > 11) {
      state.calendar.month = 0;
      state.calendar.year++;
    } else if (state.calendar.month < 0) {
      state.calendar.month = 11;
      state.calendar.year--;
    }
    renderCalendar(state.currentStudentId);
  }

  function renderCalendar(sId) {
    const y = state.calendar.year;
    const m = state.calendar.month;
    dom.calMonthLabel.textContent = `${y}年 ${m+1}月`;
    dom.calGrid.innerHTML = '';

    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m+1, 0);
    const startOffset = firstDay.getDay(); // 0:Sun
    const totalDays = lastDay.getDate();

    // 日別データの集計
    const dailyData = {};
    state.lessonLogs.forEach(l => {
      if (l.student_id !== sId) return;
      const d = parseDate(l.date);
      if (!d || d.getFullYear() !== y || d.getMonth() !== m) return;
      const day = d.getDate();
      if (!dailyData[day]) dailyData[day] = { p: 0, a: 0 };
      if (l.kind === 'planned') dailyData[day].p += parseFloat(l.count)||0;
      else dailyData[day].a += parseFloat(l.count)||0;
    });

    // 42セル (6週間分)
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startOffset + 1;
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';

      if (dayNum > 0 && dayNum <= totalDays) {
        const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
        
        cell.innerHTML = `<div class="calendar-day-number">${dayNum}</div>`;
        
        // カウント表示
        const dat = dailyData[dayNum];
        if (dat) {
          const countsDiv = document.createElement('div');
          countsDiv.className = 'calendar-day-counts';
          countsDiv.textContent = `${dat.a} / ${dat.p}`;
          cell.appendChild(countsDiv);

          // バッジ
          const total = dat.a + dat.p;
          if (total > 0) {
            const badge = document.createElement('div');
            badge.className = 'calendar-day-badge ' + (dat.a >= dat.p ? 'actual-dominant' : 'planned-dominant');
            badge.textContent = dat.a >= dat.p ? '実績' : '予定';
            cell.appendChild(badge);
          }
        }

        // 選択状態
        if (state.calendar.selectedDateStr === dateStr) {
          cell.classList.add('calendar-cell-selected');
        }

        // クリックイベント
        cell.addEventListener('click', () => {
          state.calendar.selectedDateStr = dateStr;
          renderCalendar(sId); // 再描画して選択枠を更新
          renderDayDetail(dateStr);
        });
      } else {
        cell.classList.add('disabled');
      }
      dom.calGrid.appendChild(cell);
    }
  }

  function renderDayDetail(dateStr) {
    if (!dateStr) {
      dom.dayDetailTitle.textContent = "日付を選択してください";
      dom.dayDetailContent.innerHTML = '<p class="text-muted">カレンダーの日付をクリックしてください。</p>';
      return;
    }
    dom.dayDetailTitle.textContent = formatDateLabel(dateStr);
    
    const sId = state.currentStudentId;
    const logs = state.lessonLogs.filter(l => l.student_id === sId && l.date === dateStr);
    
    dom.dayDetailContent.innerHTML = '';
    if (logs.length === 0) {
      dom.dayDetailContent.innerHTML = '<p class="text-muted">この日の記録はありません。</p>';
    } else {
      const ul = document.createElement('ul');
      ul.style.listStyle = 'none';
      ul.style.padding = 0;
      logs.forEach((l, idx) => {
        const c = state.courses.find(cx => cx.course_id === l.course_id);
        const li = document.createElement('li');
        li.style.borderBottom = '1px solid #eee';
        li.style.padding = '4px 0';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        
        li.innerHTML = `
          <span>
            <span class="text-muted small">[${l.kind === 'planned' ? '予' : '実'}]</span> 
            ${c ? c.course_name : l.course_id} 
            <span style="font-weight:bold">×${l.count}</span>
          </span>
          <button class="btn small-btn danger-btn">削除</button>
        `;
        li.querySelector('button').addEventListener('click', () => {
          // 削除処理
          const targetIdx = state.lessonLogs.indexOf(l);
          if (targetIdx > -1) {
            state.lessonLogs.splice(targetIdx, 1);
            DataService.markDirty('lessonLogs');
            refreshStudentDetailView();
          }
        });
        ul.appendChild(li);
      });
      dom.dayDetailContent.appendChild(ul);
    }
  }

  function onAddLog() {
    const sId = state.currentStudentId;
    const dateStr = state.calendar.selectedDateStr;
    const cId = dom.dayDetailCourse.value;
    if (!sId || !dateStr || !cId) {
      showGlobalMessage('日付と講座を選択してください', 'error');
      return;
    }

    state.lessonLogs.push({
      log_id: `${dateStr}-${sId}-${Date.now()}`,
      date: dateStr,
      student_id: sId,
      course_id: cId,
      count: dom.logAddCount.value,
      kind: dom.logAddKind.value,
      registered_by: 'admin',
      created_at: new Date().toISOString()
    });
    DataService.markDirty('lessonLogs');
    refreshStudentDetailView();
    showGlobalMessage('追加しました', 'success', 1000);
  }

  // ---------------------------------------------------------
  // Courses
  // ---------------------------------------------------------
  function renderCoursesView() {
    const tbody = dom.coursesTableBody;
    tbody.innerHTML = '';
    const fGrade = $('#courses-filter-grade').value;
    const query = $('#courses-filter-query').value.toLowerCase();

    state.courses.filter(c => {
      if (fGrade && c.target_grade !== fGrade) return false;
      if (query && !c.course_name.toLowerCase().includes(query)) return false;
      return true;
    }).forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.course_id}</td>
        <td><input value="${c.course_name}" style="width:100%"></td>
        <td>${c.target_grade}</td>
        <td>${c.standard_sessions}</td>
        <td>${c.note}</td>
      `;
      tr.querySelector('input').addEventListener('change', (e) => {
        c.course_name = e.target.value;
        DataService.markDirty('courses');
      });
      tbody.appendChild(tr);
    });
  }

  function onAddCourse() {
    state.courses.push({
      course_id: dom.courseAddId.value,
      course_name: dom.courseAddName.value,
      target_grade: dom.courseAddGrade.value,
      standard_sessions: dom.courseAddStandard.value,
      note: dom.courseAddNote.value
    });
    DataService.markDirty('courses');
    renderCoursesView();
    dom.courseAddId.value = '';
    dom.courseAddName.value = '';
  }

  // ---------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------
  function setupAnalyticsDates() {
    if (dom.anaStart.value) return;
    const now = new Date();
    dom.anaEnd.value = dateToStr(now);
    now.setMonth(now.getMonth() - 1);
    dom.anaStart.value = dateToStr(now);
  }

  function recalcAnalytics() {
    const s = parseDate(dom.anaStart.value);
    const e = parseDate(dom.anaEnd.value);
    if (!s || !e) return;

    // 生徒別
    const studentStats = computeAchievements(s, e);
    dom.anaStudentsBody.innerHTML = '';
    studentStats.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.id}</td>
        <td>${row.grade}</td>
        <td>${row.planned.toFixed(1)}</td>
        <td>${row.actual.toFixed(1)}</td>
        <td>${formatPercent(row.rate)}</td>
      `;
      dom.anaStudentsBody.appendChild(tr);
    });

    // 講座別
    dom.anaCoursesBody.innerHTML = '';
    state.courses.forEach(c => {
      // 簡易計算: 期間内のログ合計
      const logs = state.lessonLogs.filter(l => 
        l.course_id === c.course_id && l.kind !== 'planned' &&
        parseDate(l.date) >= s && parseDate(l.date) <= e
      );
      const actual = logs.reduce((sum, l) => sum + (parseFloat(l.count)||0), 0);
      const students = new Set(logs.map(l => l.student_id)).size;
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.course_id}</td>
        <td>${c.course_name}</td>
        <td>${students}</td>
        <td>-</td>
        <td>${actual}</td>
        <td>-</td>
      `;
      dom.anaCoursesBody.appendChild(tr);
    });

    // Timeline
    renderTimeline(s, e);
  }

  function renderTimeline(start, end) {
    const unit = dom.anaUnit.value;
    const map = {};
    
    state.lessonLogs.forEach(l => {
      if (l.kind === 'planned') return;
      const d = parseDate(l.date);
      if (d < start || d > end) return;
      
      let key = l.date;
      if (unit === 'month') key = l.date.substring(0, 7); // YYYY-MM
      // week処理は省略(簡易実装)

      map[key] = (map[key] || 0) + (parseFloat(l.count)||0);
    });

    dom.anaTimeline.innerHTML = '';
    const barsContainer = document.createElement('div');
    barsContainer.className = 'timeline-chart-bars';
    
    const keys = Object.keys(map).sort();
    const max = Math.max(...Object.values(map)) || 1;

    keys.forEach(k => {
      const h = (map[k] / max) * 100;
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.innerHTML = `
        <div class="timeline-bar" style="height:${Math.max(h, 1)}%">
          <div class="timeline-bar-value">${map[k]}</div>
        </div>
        <div class="timeline-bar-label">${k}</div>
      `;
      barsContainer.appendChild(wrap);
    });
    dom.anaTimeline.appendChild(barsContainer);
  }

})();
