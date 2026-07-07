// Fetches Jewish holidays for a given Gregorian year from the free Hebcal
// REST API and turns them into blocked-date entries:
//   - a Yom Tov day (Rosh Hashana, Yom Kippur, Sukkot/Pesach first & last
//     days, Shavuot) -> full closure ("holiday")
//   - the day right before a Yom Tov day -> shortened hours, same as Friday
//     ("erev")
// Minor holidays that are normal business days in a store (Chanukah, Purim,
// fast days, Tu BiShvat, etc.) are intentionally left alone — Hebcal marks
// those with yomtov:false, which is exactly the flag we filter on.
//
// NOTE: this file makes a live network call to hebcal.com. That works fine
// once this app is deployed to a normal server with internet access. It
// could not be tested against the live API from inside the sandbox this app
// was built in (that sandbox only allows a short allow-list of dev-tool
// domains), so double-check the first sync after you deploy.

const HEBCAL_URL = 'https://www.hebcal.com/hebcal';

async function fetchHolidaysForYear(year) {
  const params = new URLSearchParams({
    v: '1',
    cfg: 'json',
    maj: 'on', // major holidays
    min: 'off', // skip minor holidays (Chanukah, Purim, etc.) — normal open days
    mod: 'off',
    nx: 'off',
    year: String(year),
    month: 'x', // whole year
    ss: 'off',
    mf: 'off',
    c: 'off',
    i: 'on', // Israel holiday scheme (1-day Yom Tov instead of 2)
    lg: 'he'
  });

  const res = await fetch(HEBCAL_URL + '?' + params.toString());
  if (!res.ok) {
    throw new Error('Hebcal API request failed: ' + res.status);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];

  const entries = [];
  for (const item of items) {
    if (!item.yomtov) continue; // only full closure days
    if (!item.date) continue;
    const dateStr = item.date.slice(0, 10); // 'YYYY-MM-DD'
    entries.push({ date: dateStr, type: 'holiday', note: item.title || item.hebrew || '' });

    // Add erev (the day before) as a shortened-hours day, unless it's a
    // Saturday (already closed) or already a Yom Tov day itself.
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const erevDow = d.getDay();
    if (erevDow !== 6) {
      const erevDateStr = d.toISOString().slice(0, 10);
      entries.push({
        date: erevDateStr,
        type: 'erev',
        note: 'ערב ' + (item.title || item.hebrew || '')
      });
    }
  }
  return entries;
}

// Fetches both the given year and the next one (so the calendar stays useful
// across a year boundary), dedupes, and returns the combined list.
async function fetchUpcomingHolidays() {
  const now = new Date();
  const y1 = now.getFullYear();
  const y2 = y1 + 1;
  const [a, b] = await Promise.all([fetchHolidaysForYear(y1), fetchHolidaysForYear(y2)]);
  const combined = [...a, ...b];
  const seen = new Set();
  return combined.filter(e => {
    const key = e.date + '|' + e.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { fetchHolidaysForYear, fetchUpcomingHolidays };
