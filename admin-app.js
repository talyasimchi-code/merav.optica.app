(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var config = { storeWhatsapp: '', appointmentDuration: 45 };

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'שגיאה');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function toIntl(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (d.charAt(0) === '0') d = d.substring(1);
    return '972' + d;
  }
  function waLink(phone, text) {
    return 'https://wa.me/' + toIntl(phone) + '?text=' + encodeURIComponent(text);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toMin(t) { var p = t.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function overlapMinutes(aS, aE, bS, bE) { return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS)); }
  function fmtDateHe(dateStr) {
    var p = dateStr.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function dateToStr(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  var HEBREW_DOW_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function reasonHe(r) {
    return {
      decline: 'הדרדרות במצב הראייה',
      refresh: 'רצון להתחדש',
      license: 'בדיקה עבור משרד הרישוי',
      hmo: 'בדיקה בעקבות הפניית קופת חולים "כללית"'
    }[r] || (r === 'other' ? 'אחר' : r);
  }

  function statusLabel(s) {
    return { pending: 'ממתין', approved: 'אושר', needsinfo: 'ממתין לתשובת לקוח', issue: 'בוטל / יצירת קשר', cancelled: 'בוטל' }[s] || s;
  }
  function statusClass(s) {
    return { approved: 's-approved', needsinfo: 's-needsinfo', issue: 's-issue', cancelled: 's-cancelled' }[s] || '';
  }

  // ---------- Login ----------

  var pwVisible = false;
  $('pw-toggle').addEventListener('click', function () {
    pwVisible = !pwVisible;
    $('login-pass').style.webkitTextSecurity = pwVisible ? 'none' : 'disc';
  });

  $('login-btn').addEventListener('click', function () {
    var username = $('login-user').value.trim();
    var password = $('login-pass').value.trim();
    var err = $('login-err');
    err.style.display = 'none';
    api('POST', '/api/admin/login', { username: username, password: password })
      .then(function () { showMain(); })
      .catch(function (e) {
        err.textContent = e.message || 'שם משתמש או סיסמה שגויים';
        err.style.display = 'block';
      });
  });

  $('logout-btn').addEventListener('click', function () {
    api('POST', '/api/admin/logout').finally(function () {
      document.querySelector('.scr[data-step="main"]').classList.remove('active');
      document.querySelector('.scr[data-step="login"]').classList.add('active');
      $('login-user').value = '';
      $('login-pass').value = '';
      $('login-err').style.display = 'none';
    });
  });

  function showMain() {
    document.querySelector('.scr[data-step="login"]').classList.remove('active');
    document.querySelector('.scr[data-step="main"]').classList.add('active');
    api('GET', '/api/config').then(function (c) { config = c; }).catch(function () {});
    refreshAll();
  }

  // ---------- Tabs ----------

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('sel'); });
      this.classList.add('sel');
      var tab = this.getAttribute('data-tab');
      $('panel-pending').style.display = tab === 'pending' ? 'block' : 'none';
      $('panel-approved').style.display = tab === 'approved' ? 'block' : 'none';
      $('panel-weekly').style.display = tab === 'weekly' ? 'block' : 'none';
      $('panel-calendar').style.display = tab === 'calendar' ? 'block' : 'none';
      if (tab === 'weekly') loadWeekly();
      if (tab === 'calendar') loadBlocked();
    });
  });

  function refreshAll() {
    loadPending();
    loadApproved();
  }

  // ---------- Pending requests ----------

  function loadPending() {
    var wrap = $('pending-list');
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px 0">טוען...</p>';
    api('GET', '/api/appointments?status=pending')
      .then(function (res) { renderPending(res.appointments || []); })
      .catch(function () {
        wrap.innerHTML = '<p style="font-size:12px;color:var(--danger);padding:20px 0">שגיאה בטעינת הבקשות</p>';
      });
  }

  function renderPending(list) {
    var wrap = $('pending-list');
    if (!list.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px 0">אין בקשות ממתינות כרגע</p>';
      return;
    }
    wrap.innerHTML = list.map(function (r) {
      var dow = HEBREW_DOW_FULL[new Date(r.date + 'T00:00:00').getDay()];
      var dateHe = dow + ' ' + fmtDateHe(r.date);
      var reasonText = r.reason === 'other' ? ('אחר: ' + (r.reasonOther || '')) : reasonHe(r.reason);
      var approveText = 'היי ' + r.customerName + ', התור שלך במירב האופטיקה אושר ל-' + dateHe + ' בשעה ' + r.startTime + '. מצפים לראותך!';
      var infoText = 'היי ' + r.customerName + ', לגבי התור שביקשת ב-' + dateHe + ' בשעה ' + r.startTime + '... ';
      var cancelText = 'היי ' + r.customerName + ', בנוגע לתור שביקשת — נשמח ליצור איתך קשר לגבי ביטול או עדכון התיאום.';
      var badge = r.isExisting
        ? '<span class="badge existing">לקוח/ה קיים/ה</span>'
        : '<span class="badge new">לקוח/ה חדש/ה</span>';
      return '<div class="card" data-id="' + r.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:14px;font-weight:500">' + escapeHtml(r.customerName) + '</span>' + badge +
        '</div>' +
        '<div class="row"><span class="k">טלפון</span><span class="v">' + escapeHtml(r.customerPhone) + '</span></div>' +
        '<div class="row"><span class="k">סיבת פנייה</span><span class="v">' + escapeHtml(reasonText) + '</span></div>' +
        '<div class="row"><span class="k">תור מבוקש</span><span class="v">' + dateHe + ' • ' + r.startTime + '</span></div>' +
        (r.note ? '<div class="row"><span class="k">הערה</span><span class="v">' + escapeHtml(r.note) + '</span></div>' : '') +
        '<div class="actrow">' +
        '<a class="actbtn" target="_blank" rel="noopener" href="' + waLink(r.customerPhone, approveText) + '" data-act="approved">' +
        '<i class="ti ti-check" aria-hidden="true"></i><br>אישור</a>' +
        '<a class="actbtn" target="_blank" rel="noopener" href="' + waLink(r.customerPhone, infoText) + '" data-act="needsinfo">' +
        '<i class="ti ti-help" aria-hidden="true"></i><br>חסר מידע</a>' +
        '<a class="actbtn" target="_blank" rel="noopener" href="' + waLink(r.customerPhone, cancelText) + '" data-act="issue" style="grid-column:span 2">' +
        '<i class="ti ti-phone-x" aria-hidden="true"></i><br>ביטול ויצירת קשר</a>' +
        '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.actbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = this.closest('.card');
        var id = parseInt(card.getAttribute('data-id'), 10);
        var act = this.getAttribute('data-act');
        card.querySelectorAll('.actbtn').forEach(function (b) { b.classList.add('done'); });
        api('PATCH', '/api/appointments/' + id, { status: act }).then(function () {
          setTimeout(loadPending, 200);
        });
      });
    });
  }

  // ---------- Approved appointments ----------

  function loadApproved() {
    var wrap = $('approved-list');
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px 0">טוען...</p>';
    var todayStr = dateToStr(new Date());
    api('GET', '/api/appointments?status=approved&from=' + todayStr)
      .then(function (res) { renderApproved(res.appointments || []); })
      .catch(function () {
        wrap.innerHTML = '<p style="font-size:12px;color:var(--danger);padding:20px 0">שגיאה בטעינת התורים</p>';
      });
  }

  function renderApproved(list) {
    var wrap = $('approved-list');
    if (!list.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px 0">אין תורים מאושרים קרובים</p>';
      return;
    }
    wrap.innerHTML = list.map(function (a) {
      var dow = HEBREW_DOW_FULL[new Date(a.date + 'T00:00:00').getDay()];
      var dateHe = dow + ' ' + fmtDateHe(a.date);
      var reminderText = 'היי ' + a.customerName + ', תזכורת לתור שלך, ' + dateHe + ' בשעה ' + a.startTime + ', במירב האופטיקה.';
      var contactText = 'היי ' + a.customerName + ', מדברת ממירב האופטיקה, רציתי להתעדכן איתך בקשר לתור שלך.';
      return '<div class="card" data-id="' + a.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:14px;font-weight:500">' + escapeHtml(a.customerName) + '</span>' +
        '<span class="statusbadge ' + statusClass(a.status) + '" style="margin-top:0">' + statusLabel(a.status) + '</span>' +
        '</div>' +
        '<div class="row"><span class="k">טלפון</span><span class="v">' + escapeHtml(a.customerPhone) + '</span></div>' +
        '<div class="row"><span class="k">תור</span><span class="v">' + dateHe + ' • ' + a.startTime + '</span></div>' +
        '<div class="actrow">' +
        '<a class="actbtn" target="_blank" rel="noopener" href="' + waLink(a.customerPhone, reminderText) + '">' +
        '<i class="ti ti-bell" aria-hidden="true"></i><br>תזכורת</a>' +
        '<a class="actbtn" target="_blank" rel="noopener" href="' + waLink(a.customerPhone, contactText) + '">' +
        '<i class="ti ti-brand-whatsapp" aria-hidden="true"></i><br>יצירת קשר</a>' +
        '<div class="actbtn" data-act="cancelled" style="grid-column:span 2"><i class="ti ti-x" aria-hidden="true"></i><br>ביטול תור</div>' +
        '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.actbtn[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = this.closest('.card');
        var id = parseInt(card.getAttribute('data-id'), 10);
        api('PATCH', '/api/appointments/' + id, { status: 'cancelled' }).then(function () {
          loadApproved();
        });
      });
    });
  }

  // ---------- Weekly view ----------

  function currentWeekDates() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var dow = d.getDay(); // 0=Sun
    var sunday = new Date(d);
    sunday.setDate(d.getDate() - dow);
    var out = [];
    for (var i = 0; i < 6; i++) { // Sun..Fri
      var cur = new Date(sunday);
      cur.setDate(sunday.getDate() + i);
      out.push(cur);
    }
    return out;
  }

  function buildWeekHours() {
    var list = [];
    for (var m = 9 * 60; m <= 18 * 60 + 30; m += 30) list.push(m);
    return list;
  }

  function loadWeekly() {
    var grid = $('week-grid');
    grid.innerHTML = '<div class="wk-cell">טוען...</div>';
    var weekDates = currentWeekDates();
    var from = dateToStr(weekDates[0]);
    var to = dateToStr(weekDates[weekDates.length - 1]);
    api('GET', '/api/appointments?status=approved&from=' + from + '&to=' + to)
      .then(function (res) { renderWeekly(weekDates, res.appointments || []); })
      .catch(function () { grid.innerHTML = '<div class="wk-cell">שגיאה בטעינה</div>'; });
  }

  function renderWeekly(weekDates, appts) {
    var grid = $('week-grid');
    var hours = buildWeekHours();
    var html = '<div class="wk-cell head"></div>';
    weekDates.forEach(function (d) {
      html += '<div class="wk-cell head">' + HEBREW_DOW_FULL[d.getDay()] + '<br>' + d.getDate() + '.' + (d.getMonth() + 1) + '</div>';
    });
    for (var i = 0; i < hours.length - 1; i++) {
      var cellStart = hours[i], cellEnd = cellStart + 30;
      html += '<div class="wk-cell time">' + toTimeStr(cellStart) + '</div>';
      weekDates.forEach(function (d) {
        var dateStr = dateToStr(d);
        var appt = null, ov = 0;
        appts.forEach(function (a) {
          if (a.date !== dateStr) return;
          var aS = toMin(a.startTime), aE = aS + a.durationMinutes;
          var o = overlapMinutes(cellStart, cellEnd, aS, aE);
          if (o > ov) { ov = o; appt = a; }
        });
        if (appt && ov >= 30) {
          html += '<div class="wk-cell book-full">' + escapeHtml(appt.customerName) + '</div>';
        } else if (appt && ov > 0) {
          var aS = toMin(appt.startTime);
          var pos = aS <= cellStart ? 'top' : 'bottom';
          html += '<div class="wk-cell"><div class="half-fill ' + pos + '">' + escapeHtml(appt.customerName) + '</div></div>';
        } else {
          html += '<div class="wk-cell"></div>';
        }
      });
    }
    grid.innerHTML = html;
  }

  function toTimeStr(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // ---------- Blocked dates / holiday sync ----------

  function loadBlocked() {
    var wrap = $('blocked-list');
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">טוען...</p>';
    api('GET', '/api/blocked-dates')
      .then(function (res) { renderBlocked(res.blockedDates || []); })
      .catch(function () { wrap.innerHTML = '<p style="font-size:12px;color:var(--danger)">שגיאה בטעינה</p>'; });
  }

  var TYPE_LABEL = { holiday: 'חג', erev: 'ערב חג', manual: 'חסימה ידנית' };

  function renderBlocked(list) {
    var wrap = $('blocked-list');
    list = list.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!list.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">אין חסימות מוגדרות. לחצי על "סנכרון חגים" כדי לטעון את החגים הקרובים.</p>';
      return;
    }
    wrap.innerHTML = list.map(function (b) {
      var delBtn = b.manual
        ? '<span class="delx" data-id="' + b.id + '" aria-label="בטל חסימה"><i class="ti ti-trash" aria-hidden="true"></i></span>'
        : '';
      return '<div class="card" style="margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<span style="font-size:13px;font-weight:500">' + fmtDateHe(b.date) + '</span>' + delBtn +
        '</div>' +
        '<div class="row"><span class="k">סוג</span><span class="v">' + (TYPE_LABEL[b.type] || b.type) + '</span></div>' +
        (b.note ? '<div class="row"><span class="k">הערה</span><span class="v">' + escapeHtml(b.note) + '</span></div>' : '') +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.delx').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        api('DELETE', '/api/blocked-dates/' + id).then(loadBlocked);
      });
    });
  }

  $('sync-holidays-btn').addEventListener('click', function () {
    var err = $('sync-err');
    err.style.display = 'none';
    this.disabled = true;
    var btn = this;
    api('POST', '/api/blocked-dates/sync-holidays')
      .then(function () { loadBlocked(); })
      .catch(function (e) {
        err.textContent = e.message || 'סנכרון החגים נכשל';
        err.style.display = 'block';
      })
      .finally(function () { btn.disabled = false; });
  });

  $('block-btn').addEventListener('click', function () {
    var date = $('block-date').value;
    var note = $('block-note').value;
    if (!date) return;
    api('POST', '/api/blocked-dates', { date: date, note: note }).then(function () {
      $('block-date').value = '';
      $('block-note').value = '';
      loadBlocked();
    });
  });

  // ---------- Boot: are we already logged in? ----------

  api('GET', '/api/admin/me').then(function (res) {
    if (res.isAdmin) showMain();
  });
})();
