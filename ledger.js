(function () {
'use strict';

const KES = n => Math.round(n * 100);

const money = c => {
  const neg = c < 0;
  c = Math.abs(c);
  const s = (c / 100).toLocaleString('en-US', {
    minimumFractionDigits: c % 100 ? 2 : 0,
    maximumFractionDigits: 2
  });
  return (neg ? '-' : '') + 'KES ' + s;
};

const D = {
  parse: iso => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  },
  iso: dt => dt.toISOString().slice(0, 10),
  addDays(iso, n) {
    const t = D.parse(iso);
    t.setUTCDate(t.getUTCDate() + n);
    return D.iso(t);
  },
  addMonths(iso, n) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const tot = (m - 1) + n;
    const ny = y + Math.floor(tot / 12);
    const nm = ((tot % 12) + 12) % 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  },
  diff: (a, b) => Math.round((D.parse(a) - D.parse(b)) / 864e5)
};

function normPhone(p) {
  let s = String(p || '').replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = '254' + s.slice(1);
  else if (/^[17]\d{8}$/.test(s)) s = '254' + s;
  return /^254[17]\d{8}$/.test(s) ? s : null;
}

function luhnOk(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = +s[14 - i];
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function makeImei(p14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = +p14[13 - i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return p14 + ((10 - (sum % 10)) % 10);
}

/* Installment schedule: equal installments, rounding difference lands on final one */
function buildSchedule(total, deposit, n) {
  const bal = total - deposit;
  if (!(n > 0) || !(bal > 0)) return [];
  const base = Math.floor(bal / n);
  const arr = Array(n).fill(base);
  arr[n - 1] = bal - base * (n - 1);
  return arr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KES, money, D, normPhone, luhnOk, makeImei, buildSchedule };
}
if (typeof window !== 'undefined') {
  window.SpectrumLedger = { KES, money, D, normPhone, luhnOk, makeImei, buildSchedule };
  window.SpectrumLedgerLedger = window.SpectrumLedger;
}
})();

