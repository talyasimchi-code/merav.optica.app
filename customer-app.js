(function () {
  'use strict';

  var state = {
    ctype: null,
    customerId: null,
    name: '',
    phone: '',
    lastcheck: null,
    reason: null,
    reasonOther: '',
    date: null, // 'YYYY-MM-DD'
    slot: null, // 'HH:MM'
    note: ''
  };
  var step = 0;
  var config = { storeWhatsapp: '', reasonDurations: {}, slotGridMinutes: 30 };
  var blockedDates = []; // from /api/blocked-dates
  var days = []; // generated list of the next 14 calendar days

  var HEBREW_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  var HEBREW_DOW_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function $(id) { return document.getElementById(id); }
  function digitsOnly(s) { return (s || '').replace(/\D/g, ''); }

  function toMin(t) {
    var p = t.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function toTime(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function dateToStr(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function isFullyClosed(dateStr) {
    var b = blockedDates.find(function (x) { return x.date === dateStr; });
    return !!(b && (b.type === 'holiday' || b.type === 'manual'));
  }

  function buildDays() {
    days = [];
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    for (var i = 0; i < 14; i++) {
      var cur = new Date(d);
      cur.setDate(d.getDate() + i);
      var dow = cur.getDay();
      var dateStr = dateToStr(cur);
      days.push({
        dateStr: dateStr,
        letter: HEBREW_DOW[dow],
        dayNum: cur.getDate() + '.' + (cur.getMonth() + 1),
        label: HEBREW_DOW_FULL[dow] + ' ' + cur.getDate() + '.' + (cur.getMonth() + 1),
        isShabbat: dow === 6,
        closed: dow === 6 || isFullyClosed(dateStr)
      });
    }
  }

  function firstOpenDayIndex() {
    for (var i = 0; i < days.length; i++) {
      if (!days[i].closed) return i;
    }
    return 0;
  }

  // ---------- API helpers ----------

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'שגיאה');
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- Rendering ----------

  function renderDaytabs() {
    var wrap = $('daytabs');
    wrap.innerHTML = days.map(function (d, i) {
      var cls = 'daypill' + (state.dayIndex === i ? ' sel' : '') + (d.closed ? ' closed' : '');
      return '<div class="' + cls + '" data-idx="' + i + '"><div class="dl">' + d.letter +
        '</div><div class="dd">' + d.dayNum + '</div></div>';
    }).join('');
    wrap.querySelectorAll('.daypill').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        if (days[idx].closed) return;
        state.dayIndex = idx;
        state.date = days[idx].dateStr;
        state.slot = null;
        $('slot-info').style.display = 'none';
        renderDaytabs();
        loadSlots();
      });
    });
  }

  function renderSlotsList(availability) {
    var wrap = $('slots');
    wrap.innerHTML = '';
    if (availability.closed || !availability.slots.length) {
      wrap.innerHTML = '<div class="closed-msg" style="grid-column:1/-1">החנות סגורה בתאריך זה. אנא בחר/י יום אחר.</div>';
      updateNext();
      return;
    }
    availability.slots.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'slotpill' + (s.busy ? ' busy' : '') + (state.slot === s.time && !s.busy ? ' sel' : '');
      d.textContent = s.time;
      if (!s.busy) {
        d.addEventListener('click', function () {
          state.slot = s.time;
          renderSlotsList(availability);
          updateNext();
          var info = $('slot-info');
          var dur = availability.durationMinutes || 30;
          var end = toTime(toMin(s.time) + dur);
          info.textContent = 'התור ינעל את השעות ' + s.time + '–' + end;
          info.style.display = 'block';
        });
      }
      wrap.appendChild(d);
    });
    updateNext();
  }

  function loadSlots() {
    var wrap = $('slots');
    wrap.innerHTML = '<div class="closed-msg" style="grid-column:1/-1">טוען שעות פנויות...</div>';
    api('GET', '/api/appointments/availability?date=' + encodeURIComponent(state.date) + '&reason=' + encodeURIComponent(state.reason || ''))
      .then(renderSlotsList)
      .catch(function () {
        wrap.innerHTML = '<div class="closed-msg" style="grid-column:1/-1">שגיאה בטעינת השעות. נסה/י שוב.</div>';
      });
  }

  function reasonLabel(r) {
    return {
      decline: 'שינוי בראייה',
      refresh: 'רצון להתחדש',
      license: 'בדיקה עבור משרד הרישוי',
      hmo: 'בדיקה בעקבות הפניית קופת חולים "כללית"',
      lenses: 'התאמת עדשות מגע',
      draft: 'בדיקת ראייה לצו ראשון',
      other: 'אחר: ' + (state.reasonOther || '—')
    }[r] || '—';
  }
  function lastcheckLabel(r) {
    return {
      year: 'בשנה האחרונה',
      '3y': 'בין שנה ל-3 שנים',
      more: 'לפני יותר מ-3 שנים',
      na: 'לא זוכר/ת'
    }[r] || '—';
  }

  function renderSummary() {
    var dayLabel = days[state.dayIndex] ? days[state.dayIndex].label : '';
    var rows = [
      ['סוג לקוח', state.ctype === 'existing' ? 'לקוח/ה קיים/ה' : 'לקוח/ה חדש/ה'],
      ['שם', state.name || '—'],
      ['טלפון', state.phone || '—']
    ];
    if (state.ctype === 'new') rows.push(['בדיקה אחרונה', lastcheckLabel(state.lastcheck)]);
    rows.push(['סיבת פנייה', reasonLabel(state.reason)]);
    rows.push(['תור', dayLabel + ' • ' + (state.slot || '—')]);
    if (state.note) rows.push(['הערה', state.note]);
    $('summary').innerHTML = rows.map(function (r) {
      return '<div class="summary-row"><span class="k">' + r[0] + '</span><span class="v">' + escapeHtml(r[1]) + '</span></div>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Validation / navigation ----------

  function canProceed() {
    var phoneValid = digitsOnly(state.phone).length === 10;
    if (step === 1) return !!state.ctype;
    if (step === 2) {
      if (state.ctype === 'existing') return false; // handled by lookup, not "Next"
      return !!state.name && phoneValid && !!state.lastcheck;
    }
    if (step === 3) return !!state.reason && (state.reason !== 'other' || !!(state.reasonOther && state.reasonOther.trim()));
    if (step === 5) return !!state.slot;
    return true;
  }

  function updateNext() {
    var nextBtn = $('next-btn');
    if (step === 2 && state.ctype === 'existing') {
      nextBtn.disabled = false; // repurposed as "בדוק פרטים" — see goto()
      return;
    }
    nextBtn.disabled = !canProceed();
  }

  function goto(n) {
    document.querySelectorAll('.scr').forEach(function (s) { s.classList.remove('active'); });
    document.querySelector('.scr[data-step="' + n + '"]').classList.add('active');

    var dots = $('dots'), nav = $('nav-row'), back = $('back-btn'), next = $('next-btn');

    if (n === 0) {
      dots.style.display = 'none';
      nav.style.display = 'none';
    } else {
      dots.style.display = 'flex';
      nav.style.display = 'flex';
      document.querySelectorAll('.dot').forEach(function (d, i) { d.classList.toggle('on', i === n - 1); });

      if (n === 1) {
        back.style.display = 'none';
        nav.style.justifyContent = 'center';
        next.style.flex = '0 0 auto';
        next.style.minWidth = '180px';
      } else {
        back.style.display = '';
        nav.style.justifyContent = '';
        next.style.flex = '1';
        next.style.minWidth = '';
      }

      if (n === 8) {
        nav.style.display = 'none';
      } else if (n === 2 && state.ctype === 'existing') {
        next.textContent = 'בדוק פרטים';
      } else if (n === 7) {
        next.textContent = 'שליחת בקשה';
      } else {
        next.textContent = 'הבא';
      }
    }

    if (n === 5) {
      if (state.dayIndex == null) state.dayIndex = firstOpenDayIndex();
      state.date = days[state.dayIndex].dateStr;
      renderDaytabs();
      loadSlots();
    }
    if (n === 7) renderSummary();
    updateNext();
  }

  // ---------- Option buttons (single-select groups) ----------

  document.querySelectorAll('.opt').forEach(function (el) {
    el.addEventListener('click', function () {
      var set = el.getAttribute('data-set');
      if (!set) return;
      var parts = set.split(':');
      var key = parts[0], val = parts[1];
      var group = el.parentElement.querySelectorAll('.opt[data-set^="' + key + ':"]');
      group.forEach(function (x) { x.classList.remove('sel'); });
      el.classList.add('sel');
      state[key] = val;

      if (key === 'ctype') {
        $('existing-block').style.display = val === 'existing' ? 'block' : 'none';
        $('new-block').style.display = val === 'new' ? 'block' : 'none';
        $('notfound-box').style.display = 'none';
      }
      if (key === 'reason') {
        $('reason-other').style.display = val === 'other' ? 'block' : 'none';
      }
      updateNext();
    });
  });

  $('reason-other').addEventListener('input', function () { state.reasonOther = this.value; updateNext(); });
  $('note').addEventListener('input', function () { state.note = this.value; });

  function handlePhoneInput(inputId, hintId) {
    $(inputId).addEventListener('input', function () {
      var digits = digitsOnly(this.value);
      $(hintId).style.display = digits.length > 0 && digits.length !== 10 ? 'block' : 'none';
      syncNameAndPhone();
      updateNext();
    });
  }
  handlePhoneInput('phone1', 'phone1-hint');
  handlePhoneInput('phone2', 'phone2-hint');
  $('name1').addEventListener('input', syncNameAndPhone);
  $('name2').addEventListener('input', syncNameAndPhone);

  function syncNameAndPhone() {
    if (state.ctype === 'existing') {
      state.name = $('name1').value;
      state.phone = $('phone1').value;
    } else {
      state.name = $('name2').value;
      state.phone = $('phone2').value;
    }
  }

  // ---------- Existing-customer lookup ----------

  function doLookup() {
    syncNameAndPhone();
    var digits = digitsOnly(state.phone);
    if (!state.name || digits.length !== 10) {
      updateNext();
      return;
    }
    var next = $('next-btn');
    next.disabled = true;
    next.textContent = 'בודק...';
    api('POST', '/api/customers/lookup', { fullName: state.name, phone: digits })
      .then(function (res) {
        if (res.found) {
          state.customerId = res.customer.id;
          state.name = res.customer.fullName;
          state.phone = res.customer.phone;
          $('notfound-box').style.display = 'none';
          step = 3;
          goto(step);
        } else {
          $('notfound-box').style.display = 'block';
          next.textContent = 'בדוק פרטים';
          next.disabled = false;
        }
      })
      .catch(function () {
        $('notfound-box').style.display = 'block';
        next.textContent = 'בדוק פרטים';
        next.disabled = false;
      });
  }

  $('retry-lookup-btn').addEventListener('click', function () {
    $('notfound-box').style.display = 'none';
    $('name1').value = '';
    $('phone1').value = '';
    state.name = '';
    state.phone = '';
    $('name1').focus();
  });

  $('switch-to-new-btn').addEventListener('click', function () {
    state.ctype = 'new';
    document.querySelectorAll('.opt[data-set^="ctype:"]').forEach(function (x) { x.classList.remove('sel'); });
    document.querySelector('.opt[data-set="ctype:new"]').classList.add('sel');
    $('existing-block').style.display = 'none';
    $('new-block').style.display = 'block';
    $('notfound-box').style.display = 'none';
    $('name2').value = $('name1').value;
    syncNameAndPhone();
    updateNext();
  });

  // ---------- Submission ----------

  function submitRequest() {
    var next = $('next-btn');
    var errBox = $('submit-err');
    errBox.style.display = 'none';
    next.disabled = true;
    next.textContent = 'שולח...';

    api('POST', '/api/appointments', {
      customerName: state.name,
      customerPhone: digitsOnly(state.phone),
      isExisting: state.ctype === 'existing',
      date: state.date,
      startTime: state.slot,
      reason: state.reason,
      reasonOther: state.reason === 'other' ? state.reasonOther : null,
      note: state.note || null
    }).then(function () {
      step = 8;
      goto(step);
    }).catch(function (e) {
      errBox.textContent = (e && e.message) || 'אירעה שגיאה בשליחת הבקשה. נסה/י שוב.';
      errBox.style.display = 'block';
      next.disabled = false;
      next.textContent = 'שליחת בקשה';
      // If the slot got taken while we were on the summary screen, send the
      // person back to the calendar to pick a new time.
      if (e && e.data && e.data.error && e.data.error.indexOf('פנויה') !== -1) {
        step = 5;
        goto(step);
      }
    });
  }

  // ---------- Nav wiring ----------

  $('cta-book').addEventListener('click', function () { step = 1; goto(step); });

  $('next-btn').addEventListener('click', function () {
    if (step === 2 && state.ctype === 'existing') {
      doLookup();
      return;
    }
    if (!canProceed()) return;
    if (step === 7) {
      submitRequest();
      return;
    }
    step = Math.min(step + 1, 8);
    goto(step);
  });

  $('back-btn').addEventListener('click', function () {
    step = Math.max(step - 1, 0);
    goto(step);
  });

  // ---------- Boot ----------

  function boot() {
    Promise.all([
      api('GET', '/api/config'),
      api('GET', '/api/blocked-dates')
    ]).then(function (results) {
      config = results[0];
      blockedDates = results[1].blockedDates || [];
      var waHref = 'https://wa.me/' + config.storeWhatsapp;
      $('cta-whatsapp').href = waHref;
      $('cta-whatsapp-2').href = waHref;
      buildDays();
      goto(0);
    }).catch(function () {
      // Even if config/blocked-dates fail to load, still let the person use
      // the app — worst case the WhatsApp buttons need a manual retry.
      buildDays();
      goto(0);
    });
  }

  boot();
})();
