'use strict';

(function () {
  const {
    ROLES, DEFAULT_PERMS, PERM_ROWS, SYSTEM_ONLY, DOC_KINDS, REASON_CODES,
    CLAUSE_KEYS, CLAUSE_TITLES, DEFAULT_CLAUSES
  } = window.SpectrumData || window. SpectrumData;

  const {
    KES, money, D, normPhone, luhnOk, makeImei, buildSchedule
  } = window.SpectrumLedger || window. SpectrumLedger;

  const {
    Engine
  } = window.SpectrumEngine || window. SpectrumEngine;

  const KEY = 'spectrum-credit-state-v4';
  const AUDIT_CLEAR_KEY = 'spectrum-credit-audit-cleared-v1';
  const AUTH_KEY = 'spectrum-credit-demo-session';
  const LOGIN_ACCOUNTS = [
    { role: 'Super Admin', email: 'superadmin@spectrum.co.ke', password: 'SpC!Admin-92#Kp' },
    { role: 'Product Admin', email: 'product.admin@spectrum.co.ke', password: 'SpC!Product-47#Mv' },
    { role: 'Sales Agent', email: 'sales.agent@spectrum.co.ke', password: 'SpC!Sales-35#Rt' },
    { role: 'Credit/Risk Officer', email: 'risk.officer@spectrum.co.ke', password: 'SpC!Risk-81#Na' },
    { role: 'Approver', email: 'approver@spectrum.co.ke', password: 'SpC!Approve-63#Vx' },
    { role: 'Senior Approver', email: 'senior.approver@spectrum.co.ke', password: 'SpC!Senior-28#Jq' },
    { role: 'Inventory Officer', email: 'inventory.officer@spectrum.co.ke', password: 'SpC!Stock-74#Bw' },
    { role: 'Finance Officer', email: 'finance.officer@spectrum.co.ke', password: 'SpC!Finance-52#Hz' },
    { role: 'Finance Approver', email: 'finance.approver@spectrum.co.ke', password: 'SpC!FinApprove-39#Dk' },
    { role: 'Collections Officer', email: 'collections.officer@spectrum.co.ke', password: 'SpC!Collect-16#Fc' },
    { role: 'Auditor', email: 'auditor@spectrum.co.ke', password: 'SpC!Audit-48#Wp' },
    { role: 'Compliance Officer', email: 'compliance.officer@spectrum.co.ke', password: 'SpC!Compliance-67#Ts' }
  ];
  const ATTACHMENT_DB = 'spectrum-credit-attachments-v1';
  const ATTACHMENT_STORE = 'customer-files';
  let E;
  const ui = {
    view: 'overview',
    appId: null,
    leaseId: null,
    appFilter: 'All',
    inventoryQuery: '',
    inventoryFilter: 'All',
    secOnly: false,
    agent: 'All agents',
    cust: null,
    devId: null,
    authView: 'login',
    resetEmail: '',
    resetNotice: '',
    loginMethod: 'password',
    loginPhone: '',
    loginEmail: ''
  };

  const THEME_KEY = 'spectrum-credit-theme';
  function applyTheme(theme, persist = false) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    if (persist) {
      try { localStorage.setItem(THEME_KEY, selected); } catch (e) { console.warn('Could not save theme preference.', e); }
    }
    document.querySelectorAll('.theme-switch button').forEach(button => {
      const active = button.dataset.theme === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function loadEngine() {
    try {
      let raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 3) {
          if (s.settings && s.settings.company && s.settings.company.includes('Spectrum')) {
            s.settings.company = 'Spectrum Credit Limited';
          }
          return new Engine(s);
        }
      }
      // Drop earlier seeded/demo state when migrating to the clean workspace.
      localStorage.removeItem('spectrum-credit-state-v3');
      localStorage.removeItem('Spectrum-credit-state-v3');
    } catch (e) {
      console.warn('Failed to load state from localStorage:', e);
    }
    return new Engine(Engine.blank());
  }


  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(E.s));
    } catch (e) {
      console.warn('Failed to save state to localStorage:', e);
    }
  }

  function attachmentDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(ATTACHMENT_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ATTACHMENT_STORE)) request.result.createObjectStore(ATTACHMENT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local attachment storage.'));
    });
  }

  async function saveCustomerAttachment(key, file) {
    const db = await attachmentDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
      tx.objectStore(ATTACHMENT_STORE).put({ blob: file, name: file.name, type: file.type || '' }, key);
      tx.oncomplete = () => { db.close(); resolve(key); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error(`Could not save ${file.name}.`)); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error(`Could not save ${file.name}.`)); };
    });
  }

  async function deleteCustomerAttachment(key) {
    const db = await attachmentDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
      tx.objectStore(ATTACHMENT_STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Could not remove an unused attachment.')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Could not remove an unused attachment.')); };
    });
  }

  async function getCustomerAttachment(key) {
    const db = await attachmentDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
      const request = tx.objectStore(ATTACHMENT_STORE).get(key);
      request.onsuccess = () => { const record = request.result; db.close(); resolve(record || null); };
      request.onerror = () => { db.close(); reject(request.error || new Error('Could not read the attachment.')); };
    });
  }

  async function attachCustomerFile(customerId, slot, file) {
    const customer = E.s.customers.find(item => item.id === customerId);
    if (!customer) throw new Error('Customer record was not found.');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than the 5 MB limit.`);
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name) || (slot === 'photo' && !/\.(jpe?g|png)$/i.test(file.name))) {
      throw new Error(slot === 'photo' ? 'Customer photos must be JPG or PNG files.' : 'Attachments must be JPG, PNG or PDF files.');
    }
    if (!(E.role === 'Sales Agent' && E.can('customer.register')) && !E.can('kyc.verify')) throw new Error('You do not have permission to update customer KYC files.');
    const key = `customer-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await saveCustomerAttachment(key, file);
    const documents = customer.kyc.documents || (customer.kyc.documents = {});
    const previousKey = documents[slot]?.storageKey;
    documents[slot] = { name: file.name, sizeKB: Math.ceil(file.size / 1024), type: file.type || '', storageKey: key };
    customer.kyc.status = 'Pending';
    customer.kyc.by = null;
    customer.kyc.at = null;
    customer.kyc.note = 'A KYC attachment was added or replaced; review is required.';
    E.log('KYC DOCUMENT', customer.id, `${slot} attachment added or replaced`, 'WARN');
    save();
    render();
    if (previousKey) deleteCustomerAttachment(previousKey).catch(error => console.warn('Could not remove replaced attachment.', error));
    toast(`${file.name} attached to ${customer.name}. KYC review is required.`);
  }

  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fd = iso => {
    if (!iso) return 'n/a';
    const [y, m, d] = iso.split('-');
    return `${+d} ${MON[m - 1]} ${y}`;
  };
  const fdl = iso => {
    if (!iso) return 'n/a';
    const [y, m, d] = iso.split('-');
    return `${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })} ${+d} ${MON[m - 1]} ${y}`;
  };

  const STAFF_DEPARTMENTS = ['Origination', 'Credit', 'Finance', 'Collections', 'Administration', 'Inventory', 'Committee', 'Operations'];
  const REMOVED_STAFF_POSITIONS = new Set(['branch manager', 'loan officer', 'ceo / committee member']);
  const STAFF_ORGANIZATIONS = ['Unassigned', 'BR-001', 'BR-002', 'BR-003'];
  const COUNTIES = ['Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot'];
  const staffDepartment = role => ({
    'Sales Agent': 'Origination', 'Credit/Risk Officer': 'Credit', 'Approver': 'Credit', 'Senior Approver': 'Credit',
    'Finance Officer': 'Finance', 'Finance Approver': 'Finance', 'Collections Officer': 'Collections',
    'Inventory Officer': 'Inventory', 'Super Admin': 'Administration', 'Product Admin': 'Administration',
    'Auditor': 'Administration', 'Compliance Officer': 'Administration'
  }[role] || 'Operations');

  function ensureStaffRecords() {
    if (!Array.isArray(E.s.staff)) {
      E.s.staff = [
        ...E.s.settings.agents.map(name => ({ name, role: 'Sales Agent' })),
        ...E.s.settings.officers.map(name => ({ name, role: 'Collections Officer' }))
      ].map(record => ({ id: E.id('STF'), email: '', status: 'Active', ...record }));
    }
    if (!E.s.staff.some(person => person.role === 'Super Admin' && person.status === 'Active')) {
      E.s.staff.push({ id: E.id('STF'), name: 'System Administrator', role: 'Super Admin', email: '', status: 'Active' });
    }
    if (!Array.isArray(E.s.staffAssignments)) {
      E.s.staffAssignments = E.s.staff.map(person => ({
        id: E.id('ASN'), staffId: person.id, position: person.role, organization: 'BR-001',
        department: staffDepartment(person.role), roleType: 'Primary', status: person.status || 'Active'
      }));
    }
    if (!Array.isArray(E.s.staffChangeRequests)) E.s.staffChangeRequests = [];
    if (!Array.isArray(E.s.staffPositions)) E.s.staffPositions = [];
    if (!E.s.staffPositionsInitialized) {
      if (!E.s.staffPositions.length) {
        E.s.staffPositions = [
          ['Credit Analyst', 'Credit'], ['Credit Officer', 'Credit'],
          ['Finance Officer', 'Finance'], ['Collections Officer', 'Collections'],
          ['Operations Officer', 'Operations'], ['Administrator', 'Administration']
        ].map(([name, department]) => ({ id: E.id('POS'), name, department, description: '', createdBy: 'System', createdAt: E.s.date }));
      }
      E.s.staffPositionsInitialized = true;
    }
    E.s.staffPositions = E.s.staffPositions.filter(position => !REMOVED_STAFF_POSITIONS.has(position.name.trim().toLowerCase()));
    if (!Array.isArray(E.s.perms['staff.changes.approve'])) E.s.perms['staff.changes.approve'] = [...DEFAULT_PERMS['staff.changes.approve']];
  }

  function ensureSystemConfig() {
    const defaults = {
      organizationName: E.s.settings.company || 'Spectrum Credit Limited', currency: 'KES — Kenyan Shilling', timezone: 'Africa/Nairobi (EAT)',
      sessionTimeout: 30, databaseEngine: 'Browser Local Storage', databaseName: 'spectrum_lms', host: 'localhost',
      port: 5432, username: 'spectrum_admin', sslMode: 'Disabled', minPasswordLength: 8, passwordExpiryDays: 90,
      maxLoginAttempts: 5, lockoutMinutes: 15, mfa: 'Optional', auditLogging: 'Enabled', ipWhitelist: ''
    };
    E.s.systemConfig = { ...defaults, ...(E.s.systemConfig || {}) };
    if (E.s.systemConfig.currency === 'KES') E.s.systemConfig.currency = defaults.currency;
    if (E.s.systemConfig.timezone === 'Africa/Nairobi') E.s.systemConfig.timezone = defaults.timezone;
    if (!Array.isArray(E.s.systemConfigAudit)) E.s.systemConfigAudit = [];
  }

  function syncStaffPools() {
    const active = E.s.staff.filter(staff => staff.status === 'Active');
    if (!active.some(staff => staff.role === 'Super Admin')) throw new Error('Keep at least one active Super Admin.');
    const agents = active.filter(staff => staff.role === 'Sales Agent').map(staff => staff.name);
    const officers = active.filter(staff => staff.role === 'Collections Officer').map(staff => staff.name);
    E.s.settings.agents = agents;
    E.s.settings.officers = officers;
  }

  function commitStaffChange(detail, change) {
    const previous = {
      staff: JSON.parse(JSON.stringify(E.s.staff)),
      staffAssignments: JSON.parse(JSON.stringify(E.s.staffAssignments)),
      agents: [...E.s.settings.agents],
      officers: [...E.s.settings.officers]
    };
    try {
      change();
      syncStaffPools();
      E.log('STAFF', 'staff directory', detail, 'WARN');
    } catch (error) {
      E.s.staff = previous.staff;
      E.s.staffAssignments = previous.staffAssignments;
      E.s.settings.agents = previous.agents;
      E.s.settings.officers = previous.officers;
      throw error;
    }
  }

  function submitStaffChangeRequest(kind, summary, payload, targetId = null) {
    const request = {
      id: E.id('SCR'), kind, summary, payload: JSON.parse(JSON.stringify(payload)), targetId,
      submittedBy: E.role, submittedAt: E.s.date, status: 'Pending approval'
    };
    E.s.staffChangeRequests.push(request);
    E.log('STAFF REQUEST', request.id, `${summary} submitted for maker-checker approval`, 'WARN');
    return request;
  }

  function decideStaffChangeRequest(id, approve, note = '') {
    if (!E.can('staff.changes.approve')) E.need('staff.changes.approve');
    const request = E.s.staffChangeRequests.find(item => item.id === id);
    if (!request || request.status !== 'Pending approval') throw new Error('This staff change request is no longer pending.');
    if (request.submittedBy === E.role) throw new Error('The maker cannot approve their own staff change request.');
    if (!approve) {
      request.status = 'Declined';
      request.decidedBy = E.role;
      request.decidedAt = E.s.date;
      request.note = note;
      E.log('STAFF CHECK', request.id, `Declined by ${E.role}${note ? ': ' + note : ''}`);
      return request;
    }

    const v = request.payload;
    if (request.kind === 'staff.add') {
      if (E.s.staff.some(person => person.name.toLowerCase() === v.name.toLowerCase())) throw new Error('A staff member with that name already exists.');
      commitStaffChange(`Approved staff addition: ${v.name}`, () => {
        E.s.staff.push(v);
        E.s.staffAssignments.push({
          id: E.id('ASN'), staffId: v.id, position: v.position || v.role, organization: v.branch || 'Unassigned',
          department: v.department || staffDepartment(v.role), roleType: 'Primary', status: v.status || 'Active'
        });
      });
    } else if (request.kind === 'assignment.add') {
      const person = E.s.staff.find(record => record.id === v.staffId && record.status !== 'Deleted');
      if (!person) throw new Error('The selected staff member no longer exists.');
      if (E.s.staffAssignments.some(item => item.staffId === v.staffId && item.position === v.position && item.roleType === v.roleType)) throw new Error('This staff member already has that position and role type.');
      commitStaffChange(`Approved ${person.name} assignment to ${v.position}`, () => E.s.staffAssignments.push(v));
    } else if (request.kind === 'assignment.edit') {
      const assignment = E.s.staffAssignments.find(item => item.id === request.targetId);
      const person = E.s.staff.find(record => record.id === v.staffId && record.status !== 'Deleted');
      if (!assignment || !person) throw new Error('The assignment or staff member no longer exists.');
      if (E.s.staffAssignments.some(item => item.id !== assignment.id && item.staffId === v.staffId && item.position === v.position && item.roleType === v.roleType)) throw new Error('This staff member already has that position and role type.');
      commitStaffChange(`Approved assignment update for ${person.name}`, () => Object.assign(assignment, v));
    } else if (request.kind === 'staff.edit') {
      const person = E.s.staff.find(record => record.id === request.targetId && record.status !== 'Deleted');
      if (!person) throw new Error('The staff member no longer exists.');
      if (E.s.staff.some(record => record.id !== person.id && record.name.toLowerCase() === v.name.toLowerCase())) throw new Error('A staff member with that name already exists.');
      const primary = E.s.staffAssignments.find(item => item.staffId === person.id && item.roleType === 'Primary');
      if (primary && E.s.staffAssignments.some(item => item.id !== primary.id && item.staffId === person.id && item.position === v.role && item.roleType === 'Primary')) throw new Error('That primary role assignment already exists.');
      commitStaffChange(`Approved profile update for ${person.name}`, () => {
        Object.assign(person, v);
        if (primary) Object.assign(primary, { position: v.role, department: staffDepartment(v.role) });
        else E.s.staffAssignments.push({ id: E.id('ASN'), staffId: person.id, position: v.role, organization: 'Unassigned', department: staffDepartment(v.role), roleType: 'Primary', status: person.status });
      });
    } else if (request.kind === 'staff.delete') {
      const person = E.s.staff.find(record => record.id === request.targetId);
      if (!person || person.status === 'Deleted') throw new Error('The staff member no longer exists.');
      commitStaffChange(`Approved deletion of ${person.name}`, () => {
        person.status = 'Deleted';
        E.s.staffAssignments.filter(item => item.staffId === person.id).forEach(item => { item.status = 'Inactive'; });
      });
    } else {
      throw new Error('Unknown staff change request.');
    }
    request.status = 'Approved';
    request.decidedBy = E.role;
    request.decidedAt = E.s.date;
    request.note = note;
    E.log('STAFF CHECK', request.id, `Approved by ${E.role}${note ? ': ' + note : ''}`);
    return request;
  }

  const TONE = {
    ok: ['Paid', 'Active', 'Approved', 'Activated', 'Success', 'Verified', 'Customer-Owned', 'Closed', 'Processed', 'Sent', 'Matched', 'Pass', 'Resolved', 'Issued', 'Fully Paid', 'Signed'],
    warn: ['Due', 'Grace Period', 'Pending', 'Partially Paid', 'Under Review', 'Submitted', 'Deposit Pending', 'Agreement Pending', 'Reserved', 'Ready for Handover', 'Promised', 'Open', 'Retry queued', 'Pending approval', 'Refer', 'Quarantined', 'More Information Required', 'Settlement Pending', 'Ownership Transfer Pending', 'Pending Activation', 'Received', 'Escalated', 'On Hold', 'Awaiting', 'Awaiting signatures'],
    bad: ['Overdue', 'Rejected', 'Failed', 'Collections', 'Disputed', 'Terminated', 'Cancelled', 'Expired', 'Unmatched', 'Declined', 'Reversed', 'Initiation Failed', 'Needs review'],
    info: ['Draft', 'Duplicate', 'Suppressed', 'Inactive', 'Superseded', 'Locked']
  };

  const chip = s => {
    const t = Object.keys(TONE).find(k => TONE[k].includes(s)) || '';
    return `<span class="chip ${t}">${esc(s)}</span>`;
  };
  const $m = c => money(c);
  const custName = id => {
    try {
      return E.cust(id).name;
    } catch (e) {
      return id;
    }
  };
  const prodName = id => {
    try {
      const p = E.product(id);
      return `${p.brand} ${p.model} ${p.storage}`;
    } catch (e) {
      return id;
    }
  };
  const appPhone = a => prodName(a.offer ? a.offer.productId : E.pricing(a.pricingId).productId);

  const btn = (act, label, o = {}) =>
    `<button class="btn ${o.cls || ''} ${o.sm ? 'sm' : ''}" data-act="${act}" ${Object.entries(o.d || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ')} ${o.off ? 'disabled' : ''}>${label}</button>`;

  function toast(m, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = m;
    $('#toast').appendChild(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 6500 : 3200);
  }

  function run(fn, okMsg) {
    try {
      const r = fn();
      save();
      render();
      if (typeof okMsg === 'function') okMsg = okMsg();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      save();
      render();
      toast(e.message, 'bad');
    }
  }

  /* ---------- dialog forms ---------- */
  function openForm({ title, intro, fields, submit = 'Save', onSubmit, grid = false, sectionTitle = '', staffForm = false, registerForm = false }) {
    const d = $('#dlg');
    d.classList.toggle('wide', grid);
    d.classList.toggle('staff-form', staffForm);
    d.classList.toggle('register-form', registerForm);
    if (grid) d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
    const f = fields.map(x => {
      const id = 'f_' + x.n;
      if (x.t === 'section') return `<div class="form-section-title">${esc(x.l)}</div>`;
      if (x.t === 'notice') return `<div class="form-notice">${esc(x.l)}</div>`;
      if (x.t === 'checkbox') {
        return `<div class="fld cb"><label><input type="checkbox" id="${id}" ${x.v ? 'checked' : ''}> <span>${x.l}</span></label></div>`;
      }
      let inp;
      if (x.t === 'select') {
        inp = `<select id="${id}">${x.o.map(([v, l]) => `<option value="${esc(v)}" ${v === x.v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      } else if (x.t === 'file') {
        inp = `<input id="${id}" type="file" accept="${esc(x.accept || '.jpg,.jpeg,.png,.pdf')}" ${x.multiple ? 'multiple' : ''}>`;
      } else if (x.t === 'textarea') {
        inp = `<textarea id="${id}" placeholder="${esc(x.p || '')}">${esc(x.v || '')}</textarea>`;
      } else {
        inp = `<input id="${id}" type="${x.t || 'text'}" value="${esc(x.v ?? '')}" placeholder="${esc(x.p || '')}" ${x.step ? `step="${x.step}"` : ''}>`;
      }
      return `<div class="fld"><label for="${id}">${x.l}</label>${inp}${x.h ? `<div class="h">${x.h}</div>` : ''}</div>`;
    }).join('');

    d.innerHTML = `<form method="dialog" ${grid ? 'class="form-grid"' : ''}><h2>${title}</h2>${intro ? `<p class="muted small">${intro}</p>` : ''}${sectionTitle ? `<div class="form-section-title">${sectionTitle}</div>` : ''}<div id="ferr"></div>${f}<div class="row" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn" id="fcancel">Cancel</button><button type="submit" class="btn primary">${submit}</button></div></form>`;
    const previewUrls = new Map();
    fields.filter(x => x.t === 'file').forEach(x => {
      const input = d.querySelector(`#f_${x.n}`);
      const field = input?.closest('.fld');
      if (!input || !field) return;
      const preview = document.createElement('div');
      preview.className = 'attachment-preview';
      preview.hidden = true;
      input.insertAdjacentElement('afterend', preview);
      input.addEventListener('change', () => {
        const oldUrl = previewUrls.get(x.n);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        previewUrls.delete(x.n);
        preview.replaceChildren();
        const file = input.files?.[0];
        if (!file) {
          preview.hidden = true;
          return;
        }
        const url = URL.createObjectURL(file);
        previewUrls.set(x.n, url);
        preview.hidden = false;
        if (file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(file.name)) {
          const image = document.createElement('img');
          image.src = url;
          image.alt = `Preview of ${file.name}`;
          preview.append(image);
        } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const pdf = document.createElement('object');
          pdf.data = url;
          pdf.type = 'application/pdf';
          pdf.setAttribute('aria-label', `Preview of ${file.name}`);
          const fallback = document.createElement('span');
          fallback.textContent = 'Your browser cannot display this PDF inline. Use the download link below to view it.';
          pdf.append(fallback);
          preview.append(pdf);
        }
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `Open ${file.name}`;
        preview.append(link);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const download = document.createElement('a');
          download.href = url;
          download.download = file.name;
          download.textContent = `Download ${file.name}`;
          preview.append(download);
        }
      });
    });
    d.addEventListener('close', () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      previewUrls.clear();
    }, { once: true });
    if (registerForm) {
      const idType = d.querySelector('#f_idType');
      const idNumber = d.querySelector('#f_idNo');
      const front = d.querySelector('#f_idFront')?.closest('.fld');
      const back = d.querySelector('#f_idBack')?.closest('.fld');
      const updateIdentityFields = () => {
        const passport = idType?.value === 'Passport';
        const idHints = {
          'National ID': 'National ID: 7 or 8 digits.',
          Passport: 'Passport: 6 to 9 letters and digits.',
          'Alien ID': 'Alien ID: 6 to 9 digits.',
          'Military ID': 'Military ID: 6 to 12 letters and digits.'
        };
        const hint = idNumber?.closest('.fld')?.querySelector('.h');
        if (hint) hint.textContent = idHints[idType?.value] || '';
        if (front) front.querySelector('label').textContent = passport ? 'Passport photo page' : 'Identity document, front';
        if (back) back.hidden = passport;
      };
      idType?.addEventListener('change', updateIdentityFields);
      updateIdentityFields();
    }
    d.querySelector('#fcancel').onclick = () => d.close();
    d.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      const formSubmit = d.querySelector('form button[type="submit"]');
      if (formSubmit) formSubmit.disabled = true;
      const v = {};
      fields.forEach(x => {
        const el = d.querySelector('#f_' + x.n);
        if (x.t === 'section' || x.t === 'notice') return;
        v[x.n] = x.t === 'checkbox' ? el.checked : x.t === 'file' ? el.files[0] || null : el.value;
      });
      try {
        const msg = await onSubmit(v);
        d.close();
        save();
        render();
        if (msg) toast(msg);
        // Registration creates the customer record; continue directly into loan
        // setup so the agent can choose a product and complete the application.
        if (ui.customerForApplication && E.can('app.create')) H.newApp();
      } catch (e) {
        if (formSubmit) formSubmit.disabled = false;
        const duplicateMatch = /Possible duplicate of ([A-Z]+-\d+) \((.*?)\)\./.exec(e.message || '');
        const existing = duplicateMatch && E.s.customers.find(customer => customer.id === duplicateMatch[1]);
        if (existing) {
          const documents = existing.kyc?.documents || {};
          const docName = doc => doc?.name || 'Not recorded';
          const docLink = (label, doc) => doc?.storageKey
            ? `<button type="button" class="link small" data-act="viewCustomerAttachment" data-key="${esc(doc.storageKey)}" data-name="${esc(doc.name)}">View ${esc(label)}</button>`
            : esc(docName(doc));
          const apps = E.s.apps.filter(app => app.customerId === existing.id);
          d.querySelector('#ferr').innerHTML = `<section class="duplicate-profile" aria-label="Existing customer profile">
            <div class="duplicate-profile-heading"><strong>Customer already registered</strong><span>${esc(existing.id)}</span></div>
            <p>This customer matches an existing profile. Review it below instead of creating a duplicate.</p>
            <dl>
              <dt>Full name</dt><dd>${esc(existing.name)}</dd>
              <dt>Identity</dt><dd>${esc(existing.idType || 'National ID')} · ${esc(existing.idNo)}</dd>
              <dt>Mobile</dt><dd>${esc(existing.phone)}</dd>
              <dt>Date of birth</dt><dd>${esc(existing.dob || 'Not recorded')}</dd>
              <dt>Address</dt><dd>${esc([existing.address, existing.county].filter(Boolean).join(', ') || 'Not recorded')}</dd>
              <dt>Employment</dt><dd>${esc([existing.employment?.position, existing.employment?.name].filter(Boolean).join(' · ') || 'Not recorded')}</dd>
              <dt>KYC status</dt><dd>${esc(existing.kyc?.status || 'Pending')}</dd>
              <dt>Identity front</dt><dd>${docLink('identity front', documents.idFront)}</dd>
              ${documents.idBack ? `<dt>Identity back</dt><dd>${docLink('identity back', documents.idBack)}</dd>` : ''}
              <dt>Customer photo</dt><dd>${docLink('customer photo', documents.photo)}</dd>
              ${documents.proofAddress ? `<dt>Proof of address</dt><dd>${docLink('proof of address', documents.proofAddress)}</dd>` : ''}
              <dt>Applications</dt><dd>${apps.length ? apps.map(app => `${esc(app.ref)} (${esc(app.status)})`).join(', ') : 'None yet'}</dd>
            </dl>
          </section>`;
          const submitButton = d.querySelector('button[type="submit"]');
          const restoreRegister = () => {
            submitButton.disabled = false;
            submitButton.type = 'submit';
            submitButton.textContent = 'Register';
            submitButton.onclick = null;
            d.querySelector('#ferr').replaceChildren();
          };
          if (E.can('app.create') && E.role === 'Sales Agent') {
            submitButton.type = 'button';
            submitButton.textContent = 'Start application for this customer';
            submitButton.onclick = () => {
              ui.customerForApplication = existing.id;
              d.close();
              H.newApp();
            };
          } else {
            submitButton.disabled = true;
            submitButton.textContent = 'Customer already registered';
          }
          d.querySelector('form').addEventListener('input', restoreRegister, { once: true });
          d.querySelector('form').addEventListener('change', restoreRegister, { once: true });
        } else {
          d.querySelector('#ferr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
        }
        save();
      }
    };
    d.showModal();
  }

  const reasonForm = (title, label, submit, fn, intro) =>
    openForm({ title, intro, submit, fields: [{ n: 'r', l: label, t: 'textarea' }], onSubmit: v => fn(v.r.trim()) });

  /* ---------- navigation shell ---------- */
  const NAV = [
    ['overview', 'Overview'],
    ['applications', 'Applications'],
    ['leases', 'Leases'],
    ['payments', 'Payments'],
    ['collections', 'Collections'],
    ['catalogue', 'Catalogue'],
    ['inventory', 'Inventory'],
    ['staff', 'Staff management'],
    ['systemConfig', 'System Configuration'],
    ['roles', 'Roles and access'],
    ['audit', 'Audit log'],
  ];

  function counts() {
    const customerId = myCust();
    const leases = E.s.leases.filter(l => !customerId || l.customerId === customerId);
    return {
      applications: E.s.apps.filter(a => !customerId || a.customerId === customerId).length,
      leases: leases.length,
      payments: E.s.payments.filter(p => !customerId || p.customerId === customerId).length,
      collections: E.s.tasks.filter(t => t.status !== 'Resolved' && (!customerId || leases.some(l => l.id === t.leaseId))).length
    };
  }

  const IC = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    applications: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    leases: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    collections: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    catalogue: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1"/>',
    inventory: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    staff: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.5 3 5"/>',
    roles: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    audit: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>',
    systemConfig: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="17" r="2"/>',
  };

  const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

  function renderShell() {
    const c = counts();
    const activeCustomer = E.role === 'Customer' && myCust() ? E.cust(myCust()) : null;
    const activeStaff = activeCustomer ? null : E.s.staff.find(person => person.role === E.role && person.status === 'Active');
    const displayName = activeCustomer?.name || activeStaff?.name || E.role;
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    const currentPage = NAV.find(([key]) => key === ui.view || (key === 'leases' && ui.view === 'lease') || (key === 'applications' && ui.view === 'app'));

    $('#sidebarBrand').innerHTML = `<button class="brand" data-act="nav" data-id="overview" aria-label="Spectrum Credit overview">
      <span class="brand-copy">
        <span class="brand-name"><span>Spectrum</span></span>
        <span class="brand-name-credit">CREDIT LIMITED</span>
        <span class="brand-subtitle">We Don't Just Lend. We Empower.</span>
      </span>
    </button>`;

    $('#sidebarSearch').innerHTML = `<div class="search-box" role="search">
      ${svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>')}
      <input id="q" type="search" placeholder="Search applications, leases, customers, IMEI" autocomplete="off" aria-label="Search">
      <div id="sres" class="sres"></div>
    </div>`;

    $('#topbar').innerHTML = `<div class="breadcrumb"><span>${esc(currentPage?.[1] || 'Workspace')}</span><span class="breadcrumb-divider">·</span><span>Spectrum Credit Limited</span></div>
    <div class="top-actions">
      <div class="theme-switch" role="group" aria-label="Color theme">
        <button type="button" data-act="theme" data-theme="light" aria-label="Use light theme" title="Light theme">${svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>')}</button>
        <button type="button" data-act="theme" data-theme="dark" aria-label="Use dark theme" title="Dark theme">${svg('<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>')}</button>
      </div>
      <div class="clock-chip" aria-label="Current time in Nairobi">
        <span>Now</span><b id="currentTime"></b>
      </div>
      <label class="role-chip">
        <span class="user-icon">${svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>')}</span>
        <select data-act="role" aria-label="Acting as">
          ${ROLES.map(r => `<option ${r === E.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </label>
      <div class="header-profile"><span class="header-avatar" aria-hidden="true">${esc(initials)}</span><span class="header-profile-copy"><b>${esc(displayName)}</b><small>${esc(E.role)}</small></span></div>
      <button type="button" class="sign-out-button" data-act="signOut">Sign out</button>
    </div>`;

    applyTheme(document.documentElement.dataset.theme || 'light');

    const cnt = {
      applications: [c.applications, 'blue'],
      leases: [c.leases, 'green'],
      payments: [c.payments, 'blue'],
      collections: [c.collections, 'blue']
    };

    $('#nav').innerHTML =
      NAV.filter(([k]) => (k !== 'staff' || ['Super Admin', 'Senior Approver'].includes(E.role)) && (!['systemConfig', 'roles', 'audit'].includes(k) || E.role === 'Super Admin') && (E.role !== 'Customer' || CUSTOMER_VIEWS.includes(k)))
        .map(([k, l]) => {
          const on = ui.view === k || (k === 'leases' && ui.view === 'lease') || (k === 'applications' && ui.view === 'app');
          const n = cnt[k];
          return `<button class="nav-item ${on ? 'selected' : ''}" data-act="nav" data-id="${k}" ${on ? 'aria-current="page"' : ''}>
            <span class="nav-icon">${svg(IC[k])}</span>
            <span>${l}</span>
            ${n ? `<span class="count ${n[1]}" aria-label="${n[0]} ${l.toLowerCase()}">${n[0]}</span>` : ''}
          </button>`;
        })
        .join('') +
      (E.role === 'Sales Agent' ? `<button class="nav-item new-application" data-act="newApp"><span class="plus">+</span><span>New application</span></button>` : '');

    $('#sidebarUser').innerHTML = `<span class="sidebar-user-avatar" aria-hidden="true">${esc(initials)}</span><span class="sidebar-user-copy"><b>${esc(displayName)}</b><small>${esc(E.role)}</small></span>`;
  }

  function renderLogin() {
    if (ui.authView === 'forgot') {
      $('#loginScreen').innerHTML = `<section class="forgot-screen">
        <section class="login-brand-panel" aria-label="Spectrum Credit">
          <div class="login-brand-copy">
            <div class="login-brand-logo" aria-label="Spectrum Credit Limited"><span class="brand-name"><span>Spectrum</span></span><span class="brand-name-credit">CREDIT LIMITED</span><span class="brand-subtitle">We Don't Just Lend. We Empower.</span></div>
            <h1>Your lease operations, in one place.</h1>
            <p>Manage phone-finance applications, active leases, repayments and collections.</p>
          </div>
        </section>
        <section class="forgot-panel"><form class="forgot-form" id="forgotForm">
          <h1>Reset Password</h1>
          <p class="forgot-subtitle">Enter your email address to receive a reset link.</p>
          <label class="forgot-field"><span>Email Address <b aria-hidden="true">*</b></span><input id="resetEmail" type="email" placeholder="you@example.com" autocomplete="email" value="${esc(ui.resetEmail)}" required></label>
          ${ui.resetNotice ? `<p class="forgot-notice" role="status">${esc(ui.resetNotice)}</p>` : ''}
          <button class="forgot-submit" type="submit">Send Reset Link</button>
          <button class="forgot-back" type="button" data-login-act="backToSignIn">Back to Sign In</button>
        </form></section>
      </section>`;
      return;
    }
    const mobileLogin = ui.loginMethod === 'mobile';
    const emailOtpLogin = ui.loginMethod === 'email';
    const magicLinkLogin = ui.loginMethod === 'magic';
    $('#loginScreen').innerHTML = `<section class="login-brand-panel" aria-label="Spectrum Credit">
      <div class="login-brand-copy">
        <div class="login-brand-logo" aria-label="Spectrum Credit Limited">
          <span class="brand-name"><span>Spectrum</span></span>
          <span class="brand-name-credit">CREDIT LIMITED</span>
          <span class="brand-subtitle">We Don't Just Lend. We Empower.</span>
        </div>
        <h1>Your lease operations, in one place.</h1>
        <p>Manage phone-finance applications, active leases, repayments and collections.</p>
      </div>
    </section>
    <section class="login-form-panel">
      <form class="login-form" id="loginForm">
        <div class="login-mini-logo" aria-label="Spectrum Credit Limited">
          <span class="brand-name"><span>Spectrum</span></span>
          <span class="brand-name-credit">CREDIT LIMITED</span>
          <span class="brand-subtitle">We Don't Just Lend. We Empower.</span>
        </div>
        <h2>Welcome Back</h2>
        <p class="login-subtitle">Please sign in to your account</p>
        <div class="login-methods" role="group" aria-label="Choose a sign-in method">
          <button type="button" class="login-method ${ui.loginMethod === 'password' ? 'active' : ''}" data-login-method="password" aria-pressed="${ui.loginMethod === 'password'}">${svg('<circle cx="18" cy="6" r="3"/><path d="m16 8-9 9v3H4v-3l9-9m-5 5 2 2"/>')}<span>Password</span></button>
          <button type="button" class="login-method ${ui.loginMethod === 'mobile' ? 'active' : ''}" data-login-method="mobile" aria-pressed="${ui.loginMethod === 'mobile'}">${svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>')}<span>Mobile OTP</span></button>
          <button type="button" class="login-method ${ui.loginMethod === 'email' ? 'active' : ''}" data-login-method="email" aria-pressed="${ui.loginMethod === 'email'}">${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}<span>Email OTP</span></button>
          <button type="button" class="login-method ${ui.loginMethod === 'magic' ? 'active' : ''}" data-login-method="magic" aria-pressed="${ui.loginMethod === 'magic'}">${svg('<path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>')}<span>Magic Link</span></button>
        </div>
        <p class="login-method-note" id="loginMethodNote" aria-live="polite">${mobileLogin ? 'Enter the mobile number linked to your account.' : emailOtpLogin || magicLinkLogin ? 'Enter the email address linked to your account.' : ui.loginMethod === 'password' ? '' : 'This sign-in method is not connected yet. Choose Password to sign in.'}</p>
        ${mobileLogin ? `<label class="login-field"><span>Mobile Number <b aria-hidden="true">*</b></span><input id="loginPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+254 700 000 000" value="${esc(ui.loginPhone)}" required><small class="login-field-hint">We'll send a 6-digit verification code via SMS.</small></label>` : emailOtpLogin || magicLinkLogin ? `<label class="login-field"><span>Email Address <b aria-hidden="true">*</b></span><input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="email" value="${esc(ui.loginEmail)}" required><small class="login-field-hint">${magicLinkLogin ? "We'll email you a secure, one-click sign-in link — no password needed." : 'A one-time code will be emailed to this address.'}</small></label>` : `<label class="login-field"><span>Email Address <b aria-hidden="true">*</b></span><input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="username" required></label>
        <label class="login-field"><span class="login-password-label"><span>Password <b aria-hidden="true">*</b></span><button type="button" class="login-inline-link" data-login-act="forgot">Forgot password?</button></span><span class="login-password-wrap"><input id="loginPassword" type="password" placeholder="Enter your password" autocomplete="current-password" required><button class="login-password-toggle" type="button" data-login-act="togglePassword" aria-label="Show password">${svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>')}</button></span></label>`}
        <p class="login-error" id="loginError" role="alert"></p>
        <button class="login-submit" type="submit">${magicLinkLogin ? 'Send magic link' : emailOtpLogin ? 'Send email OTP' : mobileLogin ? 'Send OTP' : 'Sign In'}</button>
        <p class="login-help">Need help? Contact your system administrator or IT support desk.</p>
      </form>
    </section>`;
  }

  function searchAll(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [], has = (...x) => x.some(v => String(v || '').toLowerCase().includes(q));
    const mc = myCust();
    for (const a of E.s.apps) {
      if (mc && a.customerId !== mc) continue;
      const c = E.cust(a.customerId);
      if (has(a.ref, c.name, c.phone)) {
        out.push({ t: `${a.ref}, ${c.name}`, s: `Application, ${a.status}`, act: 'openApp', id: a.id });
      }
    }
    for (const L of E.s.leases) {
      if (mc && L.customerId !== mc) continue;
      const c = E.cust(L.customerId);
      if (has(L.id, c.name, L.handover && L.handover.imei)) {
        out.push({ t: `${L.id}, ${c.name}`, s: `Lease, ${E.leaseStatus(L).status}`, act: 'openLease', id: L.id });
      }
    }
    for (const d of mc ? [] : E.s.devices) {
      if (has(d.imei)) {
        const L = E.s.leases.find(l => l.deviceId === d.id);
        out.push(
          L
            ? { t: `IMEI ${d.imei}`, s: `${d.status}, lease ${L.id}`, act: 'openLease', id: L.id }
            : { t: `IMEI ${d.imei}`, s: `${d.status}, in inventory`, act: 'nav', id: 'inventory' }
        );
      }
    }
    for (const p of E.s.payments) {
      if ((!mc || p.customerId === mc) && has(p.id, p.providerTxId)) {
        out.push({ t: `${p.id}${p.providerTxId ? ', ' + p.providerTxId : ''}`, s: `Payment, ${p.status}`, act: 'nav', id: 'payments' });
      }
    }
    return out.slice(0, 7);
  }

  function render() {
    const signedIn = sessionStorage.getItem(AUTH_KEY) === 'signed-in';
    $('#loginScreen').hidden = signedIn;
    $('#appShell').hidden = !signedIn;
    if (!signedIn) {
      renderLogin();
      return;
    }
    renderShell();
    showTime();
    const v = ui.view;
    const views = {
      overview: vOverview,
      applications: vApps,
      app: vApp,
      leases: vLeases,
      lease: vLease,
      payments: vPayments,
      collections: vCollections,
      catalogue: vCatalogue,
      inventory: vInventory,
      staff: vStaff,
      roles: vRoles,
      audit: vAudit,
      systemConfig: vSystemConfig,
    };
    $('#view').innerHTML = (views[v] || views.overview)();
  }

  /* ---------- role views & overview ---------- */
  const CUSTOMER_VIEWS = ['overview', 'applications', 'app', 'leases', 'lease', 'payments'];

  function myCust() {
    if (E.role !== 'Customer') return null;
    if (!ui.cust || !E.s.customers.some(c => c.id === ui.cust)) {
      ui.cust = E.s.customers[0] && E.s.customers[0].id;
    }
    return ui.cust;
  }

  const RANK = { 'Approver': 1, 'Senior Approver': 2, 'Super Admin': 3 };
  const allDecisions = () =>
    E.s.apps
      .flatMap(a => (a.decisions || []).map(d => ({ ...d, app: a })))
      .sort((x, y) => (y.ts < x.ts ? -1 : 1));

  const appRow = (a, sub, o = {}) => ({
    t: `${a.ref}, ${custName(a.customerId)}`,
    sub,
    chip: a.status,
    act: 'openApp',
    id: a.id,
    ...o
  });

  const workRow = w =>
    `<div class="work"><span><button class="link" data-act="${w.act}" data-id="${w.id}">${esc(w.t)}</button><span class="sub">${esc(w.sub || '')}</span></span><span class="row">${w.extra || ''}${w.chip ? chip(w.chip) : ''}</span></div>`;

  function cardHtml(c) {
    let body;
    if (c.html) body = c.html;
    else if (c.rows && c.rows.length) body = c.rows.map(workRow).join('');
    else if (c.emptyText) body = `<div class="audit-empty">${esc(c.emptyText)}</div>`;
    else body = `<div class="empty-state"><div class="check-circle">${svg('<path d="M5 12l5 5L20 7"/>')}</div><p><strong>All clear.</strong> ${esc(c.empty || 'Nothing is waiting.')}</p></div>`;
    return `<div class="content-card"><div class="card-heading"><h2>${c.title}</h2><span class="role-label">${esc(c.label || '')}</span></div>${body}</div>`;
  }

  function dashHtml(d) {
    return `<div class="overview-heading">
      <div>
        <p class="eyebrow">${esc(d.eyebrow)}</p>
        <h1>${esc(d.title)}</h1>
        <p class="intro">${d.intro}</p>
      </div>
      ${d.side ? `<div class="updated">${d.side}</div>` : ''}
    </div>
    <div class="metrics">${d.metrics.map(m => `<div class="metric-card"><h2>${m.h}</h2><p class="metric-value ${m.bad ? 'danger' : ''}">${m.v}</p><p class="metric-note ${m.good ? 'positive' : ''}">${m.note || ''}</p></div>`).join('')}</div>
    ${d.rows.map(r => `<div class="lower-grid">${r.map(cardHtml).join('')}</div>`).join('')}`;
  }

  const tbl = rows => `<table class="t"><tbody>${rows.map(r => `<tr>${r.map((x, i) => `<td class="${i ? 'r' : ''}">${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  function vAdminOverview() {
    const s = E.stats(), mx = Math.max(1, ...s.monthly.map(m => Math.max(m.expected, m.collectedInst))), A = st => E.s.apps.filter(a => st.includes(a.status));
    const quar = E.s.payments.filter(p => p.status === 'Quarantined'), evs = E.s.events.filter(e => ['Unmatched', 'Retry queued'].includes(e.status));
    const attn = A(['Submitted', 'Under Review', 'On Hold', 'Ready for Handover']).length + quar.length + evs.length;
    const work = [
      ...A(['Submitted', 'Under Review', 'On Hold']).map(a => ({ t: `${a.ref}, ${custName(a.customerId)}`, sub: 'Waiting for review or a decision', chip: a.status, act: 'openApp', id: a.id })),
      ...A(['Ready for Handover']).map(a => ({ t: `${a.ref}, ${custName(a.customerId)}`, sub: 'Paid and reserved. Waiting for handover', chip: a.status, act: 'openApp', id: a.id })),
      ...A(['Agreement Pending', 'Deposit Pending']).map(a => ({ t: `${a.ref}, ${custName(a.customerId)}`, sub: waiting(a), chip: a.status, act: 'openApp', id: a.id })),
      ...quar.map(p => ({ t: `${p.id}: received ${$m(p.receivedAmount)}`, sub: `Expected ${$m(p.amount)}. Held for reconciliation`, chip: 'Quarantined', act: 'nav', id: 'payments' })),
      ...evs.map(e => ({ t: `${e.id}: ${e.kind === 'C2B' ? 'paybill notice' : 'callback'}`, sub: e.note, chip: e.status, act: 'nav', id: 'payments' })),
      ...(s.openTasks ? [{ t: `${s.openTasks} collections follow-up task${s.openTasks > 1 ? 's' : ''}`, sub: 'Overdue installments needing contact', chip: 'Open', act: 'nav', id: 'collections' }] : [])
    ];
    const sentence = s.overdueN
      ? `${s.overdueN} installment${s.overdueN === 1 ? '' : 's'} overdue, totaling ${$m(s.overdueAmt)}.${s.graceN ? ` ${s.graceN} more ${s.graceN === 1 ? 'is' : 'are'} in the grace period.` : ''}`
      : s.activeLeases ? 'All active leases are up to date.' : 'There are no active leases yet.';
    const overviewIntro = s.activeLeases
      ? `${sentence} ${s.activeLeases} active leases · ${$m(s.outstanding)} outstanding.`
      : sentence;
    const audit = E.role === 'Super Admin' ? E.s.audit.slice(-6).reverse() : null;
    const monthlyActivity = s.monthly.slice(-6).some(m => m.expected || m.collectedInst);

    return `<div class="overview-heading">
      <div>
        <p class="eyebrow">Overview</p>
        <h1>Portfolio overview</h1>
        <p class="intro">${overviewIntro}</p>
      </div>
    </div>
    <div class="metrics">
      <div class="metric-card"><h2>Outstanding receivables</h2><p class="metric-value">${$m(s.outstanding)}</p><p class="metric-note">${s.activeLeases} active leases</p></div>
      <div class="metric-card"><h2>Collected this month</h2><p class="metric-value">${$m(s.collectedMonth)}</p><p class="metric-note positive">Net of reversals</p></div>
      <div class="metric-card"><h2>Overdue</h2><p class="metric-value ${s.overdueAmt ? 'danger' : ''}">${$m(s.overdueAmt)}</p><p class="metric-note ${s.overdueAmt ? '' : 'positive'}">${s.overdueN ? `${s.overdueN} installment${s.overdueN > 1 ? 's' : ''} past grace` : 'Nothing past grace'}</p></div>
      <div class="metric-card"><h2>Needs attention</h2><p class="metric-value">${attn}</p><p class="metric-note">Applications, exceptions and follow-ups</p></div>
    </div>
    <div class="lower-grid">
      <div class="content-card"><div class="card-heading"><h2>Review queue</h2></div>${work.length ? work.map(w => `<div class="work"><span><button class="link" data-act="${w.act}" data-id="${w.id}">${esc(w.t)}</button><span class="sub">${esc(w.sub)}</span></span>${chip(w.chip)}</div>`).join('') : `<div class="empty-state"><p><strong>No items are waiting for review.</strong></p></div>`}</div>
      <div class="content-card"><div class="card-heading"><h2>Recent audit activity</h2></div>${audit?.length ? audit.map(a => `<div class="work"><span><b>${esc(a.action)}</b> <span class="muted">${esc(a.entity)}</span><span class="sub">${esc(a.detail).slice(0, 110)}</span></span><span class="muted small nowrap">${fd(a.date)}</span></div>`).join('') : `<div class="audit-empty">${audit ? 'Audit events will appear here as your team works.' : 'Audit records are restricted for this role.'}</div>`}</div>
    </div>
    <div class="lower-grid">
      <div class="content-card"><div class="card-heading"><h2>Collections trend</h2></div>${monthlyActivity ? `<div class="card-body"><div class="bars">${s.monthly.slice(-6).map(m => `<div><div class="pair"><i class="exp" title="Expected ${$m(m.expected)}" style="height:${(m.expected / mx) * 100}%"></i><i class="col" title="Collected ${$m(m.collectedInst)}" style="height:${(m.collectedInst / mx) * 100}%"></i></div><span>${MON[+m.month.slice(5) - 1]}</span></div>`).join('')}</div><div class="legend"><span><i style="background:var(--line)"></i>Due</span><span><i style="background:var(--brand)"></i>Collected</span></div></div>` : `<div class="audit-empty">Collection history will appear here once payments are recorded.</div>`}</div>
      <div class="content-card"><div class="card-heading"><h2>Arrears by age</h2></div><table class="t"><tbody>${Object.entries(s.aging).map(([k, v]) => `<tr><td>${k}</td><td class="r">${$m(v)}</td></tr>`).join('')}<tr><td><b>Total overdue</b></td><td class="r"><b>${$m(s.overdueAmt)}</b></td></tr></tbody></table></div>
    </div>
    <section class="quick-actions" aria-label="Quick actions">
      <h2>Quick actions</h2>
      <div class="quick-action-list">
        <button type="button" class="quick-action primary" data-act="nav" data-id="applications">Review applications</button>
        <button type="button" class="quick-action" data-act="nav" data-id="leases">Manage leases</button>
        <button type="button" class="quick-action" data-act="nav" data-id="payments">View payments</button>
        <button type="button" class="quick-action" data-act="nav" data-id="collections">Collections</button>
      </div>
    </section>`;
  }

  function vOverview() {
    const role = E.role;
    const fn = {
      'Super Admin': vAdminOverview,
      'Product Admin': dProduct,
      'Sales Agent': dSales,
      'Customer': dCustomer,
      'Credit/Risk Officer': dRisk,
      'Approver': dApprover,
      'Senior Approver': dApprover,
      'Inventory Officer': dInventory,
      'Finance Officer': dFinance,
      'Finance Approver': dFinApprover,
      'Collections Officer': dCollect,
      'Auditor': dAudit,
      'Compliance Officer': dAudit
    }[role];
    const r = fn();
    return typeof r === 'string' ? r : dashHtml(r);
  }

  const A_ = st => E.s.apps.filter(a => st.includes(a.status));

  function dProduct() {
    const pr = E.s.pricings,
      act = pr.filter(p => p.status === 'Active'),
      dr = pr.filter(p => p.status === 'Draft'),
      old = E.s.leases.filter(L => E.pricing(L.terms.pricingId).status !== 'Active');
    const noPrice = E.s.products.filter(p => !act.some(x => x.productId === p.id));
    return {
      eyebrow: 'Product admin',
      title: 'Catalogue and pricing',
      intro: `${plural(act.length, 'price is', 'prices are')} on sale across ${plural(E.s.products.length, 'phone', 'phones')}. Editing a price creates a new version, so signed agreements never change.`,
      metrics: [
        { h: 'Prices on sale', v: act.length, note: 'Active and effective', good: 1 },
        { h: 'Drafts to activate', v: dr.length, note: 'Need an approver' },
        { h: 'Leases on older prices', v: old.length, note: 'Unchanged by new versions' },
        { h: 'Phones without a price', v: noPrice.length, note: 'Not available to customers', bad: noPrice.length }
      ],
      rows: [
        [
          {
            title: 'Drafts waiting',
            label: 'Pricing',
            rows: dr.map(p => {
              const e = E.validatePricing(p);
              return {
                t: `${prodName(p.productId)}, ${p.months} months, v${p.version}`,
                sub: e.length ? e[0] : `${$m(p.total)}. ${p.createdBy === E.role ? 'Another approver must activate your draft.' : 'Ready to activate.'}`,
                chip: 'Draft',
                act: 'nav',
                id: 'catalogue'
              };
            }),
            empty: 'No drafts to activate.'
          },
          {
            title: 'Prices on sale',
            label: 'Catalogue',
            html: tbl(
              E.s.products.map(p => [
                esc(prodName(p.id)),
                act
                  .filter(x => x.productId === p.id)
                  .sort((a, b) => a.months - b.months)
                  .map(x => `${x.months}m ${$m(x.total)}`)
                  .join(', ') || '<span class="muted">None</span>'
              ])
            )
          }
        ]
      ]
    };
  }

  function dSales() {
    const T = E.s.date,
      m = T.slice(0, 7),
      all = E.salesByAgent(),
      who = 'All agents';
    const R = all,
      mine = () => true,
      sum = k => R.reduce((s, r) => s + r[k], 0);
    const conv = sum('submitted') ? Math.round((sum('activated') / sum('submitted')) * 100) : 0,
      subM = E.s.apps.filter(a => a.submittedAt && a.submittedAt.startsWith(m) && mine(a)).length,
      pend = E.pendingDocs().filter(x => mine(x.app));
    const dr = A_(['Draft', 'More Information Required']).filter(mine),
      sign = A_(['Agreement Pending']).filter(a => mine(a) && a.agreement && !a.agreement.customer),
      dep = A_(['Deposit Pending']).filter(mine);
    const last = a => {
      const d = (a.decisions || []).slice(-1)[0];
      return d ? d.reason : '';
    };
    const out = allDecisions().filter(d => mine(d.app) && ['Approved', 'Rejected', 'More Information Required', 'On Hold'].includes(d.outcome)).slice(0, 6);
    const pc = r => (r.conversion == null ? '<span class="muted">n/a</span>' : r.conversion + '%');
    return {
      eyebrow: 'Sales',
      title: who === 'All agents' ? 'Sales performance' : who,
      side: '',
      intro: `${plural(sum('submitted'), 'application has', 'applications have')} been submitted, ${plural(pend.length, 'is', 'are')} held up by missing documents. Conversion is the share of submitted applications that reached handover.`,
      metrics: [
        { h: 'Applications started', v: sum('started'), note: who === 'All agents' ? `By ${E.s.settings.agents.length} agents and self-service` : 'By this agent' },
        { h: 'Submitted', v: sum('submitted'), note: `${subM} this month` },
        { h: 'Conversion rate', v: conv + '%', note: `${sum('activated')} activated of ${sum('submitted')} submitted`, good: conv >= 50 },
        { h: 'Pending documentation', v: pend.length, note: 'Cannot be submitted yet', bad: pend.length }
      ],
      rows: [
        [
          {
            title: 'Applications by agent',
            label: 'Sales',
            html: `<table class="t"><thead><tr><th>Agent</th><th class="r">Started</th><th class="r">Submitted</th><th class="r">Approved</th><th class="r">Activated</th><th class="r">Conversion</th></tr></thead><tbody>${all.map(r => `<tr ${r.agent === who ? 'style="background:var(--sel-bg)"' : ''}><td>${esc(r.agent)}</td><td class="r">${r.started}</td><td class="r">${r.submitted}</td><td class="r">${r.approved}</td><td class="r">${r.activated}</td><td class="r">${pc(r)}</td></tr>`).join('')}</tbody></table>`
          },
          {
            title: 'Pending documentation',
            label: 'Sales',
            rows: pend.map(x => appRow(x.app, `${x.app.agent}. ${x.missing.length ? 'Missing: ' + x.missing.join(', ') : 'Asked: ' + last(x.app)}`)),
            empty: 'No application is waiting on documents.'
          }
        ],
        [
          {
            title: 'Needs you',
            label: 'Sales',
            rows: [
              ...dr.map(a => appRow(a, a.status === 'More Information Required' ? 'Asked: ' + last(a) : `${a.agent}. Upload documents and submit`)),
              ...sign.map(a => appRow(a, `${a.agent}. Customer to review and sign`)),
              ...dep.map(a => appRow(a, `${a.agent}. Deposit ${$m(E.depositOutstanding(E.leaseOfApp(a)))} to collect`))
            ],
            empty: 'No customers are waiting on you.'
          },
          {
            title: 'Recent outcomes',
            label: 'Decisions',
            rows: out.map(d => appRow(d.app, `${d.label ? d.label + '. ' : ''}${d.reason}`, { chip: d.outcome })),
            emptyText: 'No decisions yet.'
          }
        ]
      ]
    };
  }

  function dCustomer() {
    const cid = myCust(),
      c = cid && E.cust(cid);
    if (!c) {
      return { eyebrow: 'Customer', title: 'Your account', intro: 'No customers are registered yet.', metrics: [], rows: [] };
    }
    const apps = E.s.apps.filter(a => a.customerId === cid),
      ls = E.s.leases.filter(L => L.customerId === cid),
      live = ls.filter(L => L.activationDate && !L.closed);
    const owed = live.reduce((s, L) => s + E.outstanding(L), 0),
      paid = ls.reduce((s, L) => s + E.totalPaid(L), 0);
    const nexts = live
        .map(L => ({ L, i: E.nextInstallment(L) }))
        .filter(x => x.i)
        .sort((a, b) => (a.i.due < b.i.due ? -1 : 1)),
      nx = nexts[0];
    const pays = E.s.payments.filter(p => p.customerId === cid).slice().reverse(),
      okp = pays.filter(p => p.status === 'Success');
    const rows = [];
    for (const a of apps) {
      if (a.status === 'Agreement Pending' && a.agreement && !a.agreement.customer) {
        rows.push(appRow(a, 'Review and sign your agreement', { chip: 'Awaiting' }));
      } else if (a.status === 'Deposit Pending') {
        const L = E.leaseOfApp(a), o = E.depositOutstanding(L);
        if (o > 0) rows.push(appRow(a, `Deposit of ${$m(o)} before you collect your phone`, { extra: btn('stk', 'Pay deposit', { sm: 1, cls: 'primary', d: { app: a.id, purpose: 'deposit' } }) }));
      } else if (['Submitted', 'Under Review', 'On Hold', 'Approved'].includes(a.status)) {
        rows.push(appRow(a, 'We are reviewing your application'));
      } else if (a.status === 'More Information Required') {
        rows.push(appRow(a, 'We need more information from you'));
      } else if (a.status === 'Ready for Handover') {
        rows.push(appRow(a, 'Deposit confirmed. Collect your phone from the shop'));
      }
    }
    for (const { L, i } of nexts) {
      const st = E.instState(L, i);
      rows.push({
        t: `Installment ${i.no} for ${prodName(L.terms.productId)}`,
        sub: `${$m(E.instOutstanding(L, i))} due ${fd(i.due)}${st.status === 'Overdue' ? `, ${st.daysPast} days late` : ''}`,
        chip: st.status,
        act: 'openLease',
        id: L.id,
        extra: btn('stk', 'Pay now', { sm: 1, cls: 'primary', d: { app: L.appId, purpose: 'installment', inst: i.id } })
      });
    }
    const dd = nx ? D.diff(nx.i.due, E.s.date) : 0,
      dueTxt = nx
        ? `${$m(E.instOutstanding(nx.L, nx.i))}, ${dd < 0 ? -dd + ' days late' : dd === 0 ? 'due today' : 'in ' + dd + ' days'}`
        : 'Nothing due';
    const L0 = live[0] || ls[0];
    const leaseCard = L0
      ? {
          title: 'Active lease',
          label: L0.id,
          html: `<div class="card-body"><div class="row"><b>${esc(prodName(L0.terms.productId))}</b>${leaseChips(L0)}</div><p class="muted small" style="margin:4px 0 12px">Signed ${fd(L0.signedOn)}${L0.activationDate ? ', handed over ' + fd(L0.activationDate) : ''}${L0.handover ? ', IMEI ' + L0.handover.imei : ''}</p>${stripHtml(L0)}<dl class="kv" style="margin-top:12px"><dt>Outstanding</dt><dd>${$m(E.outstanding(L0))} of ${$m(L0.terms.total)}</dd><dt>Next due</dt><dd>${E.nextInstallment(L0) ? fd(E.nextInstallment(L0).due) : 'Nothing due'}</dd><dt>Credit held</dt><dd>${$m(E.creditBalance(L0))}</dd></dl><div style="margin-top:12px">${btn('openLease', 'Open lease', { sm: 1, d: { id: L0.id } })}</div></div>`
        }
      : { title: 'Active lease', label: 'Lease', emptyText: 'You have no lease yet.' };
    const hist = pays.length
      ? `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>What</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>${pays.slice(0, 8).map(p => `<tr><td class="nowrap">${fd(p.confirmedAt || p.requestedAt)}</td><td>${p.purpose}<br><span class="muted small">${p.channel}</span></td><td class="r">${$m(p.amount)}</td><td>${chip(p.status)}</td><td>${p.status === 'Success' ? btn('receipt', 'Receipt', { sm: 1, d: { id: p.id } }) : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '';
    return {
      eyebrow: 'My account',
      title: `Hello, ${c.name.split(' ')[0]}`,
      intro: live.length
        ? `You owe ${$m(owed)} across ${plural(live.length, 'phone', 'phones')}. You only see your own applications, leases and payments here.`
        : 'You only see your own applications, leases and payments here.',
      metrics: [
        { h: 'Outstanding balance', v: $m(owed), note: plural(live.length, 'active lease', 'active leases') },
        { h: 'Next due date', v: nx ? fd(nx.i.due) : 'None', note: dueTxt, bad: nx && dd < 0 },
        { h: 'Paid so far', v: $m(paid), note: 'Confirmed by M-PESA', good: 1 },
        { h: 'Receipts', v: okp.length, note: 'One for each confirmed payment' }
      ],
      rows: [
        [{ title: 'To do', label: 'You', rows, empty: 'Nothing to pay or sign right now.' }, leaseCard],
        [
          { title: 'Payment history and receipts', label: 'Payments', html: hist, emptyText: 'No payments yet.' },
          {
            title: 'My phones',
            label: 'Leases',
            rows: ls.map(L => ({
              t: prodName(L.terms.productId),
              sub: L.activationDate ? `${$m(E.outstanding(L))} left of ${$m(L.terms.total)}` : 'Not yet handed over',
              chip: E.leaseStatus(L).status,
              act: 'openLease',
              id: L.id
            })),
            emptyText: 'You have no leases yet.'
          }
        ]
      ]
    };
  }

  function dRisk() {
    const sub = A_(['Submitted']),
      rev = A_(['Under Review']),
      hold = A_(['On Hold']),
      T = E.s.date,
      late = [...sub, ...rev].filter(a => a.queue && T > a.queue.due),
      rs = E.reviewStats();
    const tick = (a, c) =>
      `KYC ${c.kyc.status.toLowerCase()}, assessment ${a.assessment ? 'recorded' : 'missing'}, documents ${a.review && a.review.documents ? 'checked' : 'unchecked'}, terms ${a.review && a.review.terms ? 'checked' : 'unchecked'}`;
    const watch = [];
    for (const c of E.s.customers) {
      const h = E.paymentHistory(c.id);
      if (h.currentOverdue) {
        watch.push({
          t: c.name,
          sub: `${plural(h.currentOverdue, 'installment', 'installments')} overdue beyond grace, exposure ${$m(h.exposure)}`,
          chip: 'Overdue',
          act: 'nav',
          id: 'collections'
        });
      }
    }
    for (const a of [...sub, ...rev, ...hold]) {
      for (const f of E.fraudFlags(a, a.assessment && a.assessment.inputs)) {
        watch.push(appRow(a, f.text, { chip: f.sev === 'high' ? 'Failed' : 'Refer' }));
      }
    }
    const tot = rs.rejections || 1;
    return {
      eyebrow: 'Credit and risk',
      title: 'Review desk',
      intro: `${plural(sub.length + rev.length, 'application is', 'applications are')} with credit. Scores advise, you decide under company policy.`,
      metrics: [
        { h: 'Review queue', v: sub.length + rev.length + hold.length, note: `${sub.length} to pick up, ${late.length} past deadline`, bad: late.length },
        { h: 'Turnaround', v: rs.avgTurnaround == null ? 'n/a' : rs.avgTurnaround.toFixed(1) + ' days', note: `Submission to first decision, ${rs.measured} decided` },
        { h: 'Approvals', v: rs.approvals, note: `${rs.approvalRate == null ? 0 : rs.approvalRate}% approval rate, ${rs.rejections} rejected`, good: 1 },
        { h: 'Exception cases', v: rs.exceptions.length, note: 'Against advice, hard stops, holds', bad: rs.exceptions.length }
      ],
      rows: [
        [
          { title: 'Review queue', label: 'Credit', rows: [...sub, ...rev, ...hold].map(a => appRow(a, tick(a, E.cust(a.customerId)))), empty: 'No reviews waiting.' },
          {
            title: 'Rejection reasons',
            label: 'Restricted',
            html: rs.reasons.length
              ? `<table class="t"><thead><tr><th>Reason</th><th class="r">Rejections</th><th class="r">Share</th></tr></thead><tbody>${rs.reasons.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="r">${n}</td><td class="r">${Math.round((n / tot) * 100)}%</td></tr>`).join('')}</tbody></table>`
              : '',
            emptyText: 'No rejections yet.'
          }
        ],
        [
          { title: 'Exception cases', label: 'Restricted', rows: rs.exceptions.slice(0, 8).map(x => appRow(x.app, x.why, { chip: x.kind })), empty: 'No exception cases.' },
          { title: 'Risk watch', label: 'Restricted', rows: watch, empty: 'No arrears or fraud indicators.' }
        ]
      ]
    };
  }

  function dApprover() {
    const role = E.role,
      r = RANK[role],
      S = E.s.settings,
      limit = role === 'Approver' ? S.approverLimit : S.seniorLimit;
    const ready = A_(['Under Review']).filter(
        a => a.assessment && a.review && a.review.documents && a.review.terms && RANK[E.requiredApprover(a)] <= r
      ),
      above = A_(['Submitted', 'Under Review']).filter(a => RANK[E.requiredApprover(a)] > r);
    const esc_ = A_(['Submitted', 'Under Review']).filter(a => a.escalation && a.escalation.to === role),
      auth = A_(['Agreement Pending']).filter(a => a.agreement && !a.agreement.company);
    const mine = allDecisions().filter(d => d.by === role && ['Approved', 'Rejected'].includes(d.outcome));
    const sc = a => `Score ${a.assessment.score}, advised ${a.assessment.recommendation}${a.assessment.hardStops.length ? '. Policy hard stop' : ''}`;
    return {
      eyebrow: role === 'Approver' ? 'Approver' : 'Senior approver',
      title: 'Decision desk',
      intro: `You decide leases up to ${$m(limit)}. Approval makes an agreement and lets a phone be reserved. It never triggers handover.`,
      metrics: [
        { h: 'Ready for my decision', v: ready.length, note: 'Checks complete' },
        { h: 'Escalated to me', v: esc_.length, note: 'By reviewers or approvers' },
        { h: 'Above my limit', v: above.length, note: 'Escalate upward', bad: above.length },
        { h: 'My limit', v: $m(limit), note: 'Total lease price' }
      ],
      rows: [
        [
          {
            title: 'To decide',
            label: role,
            rows: [
              ...ready.map(a => appRow(a, sc(a), { chip: a.escalation ? 'Escalated' : a.status })),
              ...auth.map(a => appRow(a, 'Company authorization needed on the agreement', { chip: 'Awaiting' })),
              ...above.map(a => appRow(a, `Total is above your limit. Needs a ${E.requiredApprover(a)}`, { chip: 'Refer' }))
            ],
            empty: 'No decisions waiting.'
          },
          {
            title: 'Your recent decisions',
            label: 'Record',
            rows: mine.slice(0, 6).map(d => appRow(d.app, `${fd(d.date)}, score ${d.score ?? 'n/a'}${d.deviated ? ', against advice' : ''}`, { chip: d.outcome })),
            emptyText: 'You have not decided anything yet.'
          }
        ]
      ]
    };
  }

  function dInventory() {
    const sb = E.stockByModel(),
      low = sb.filter(x => x.low),
      n = s => E.s.devices.filter(d => d.status === s).length,
      ready = A_(['Ready for Handover']),
      need = A_(['Agreement Pending', 'Deposit Pending']).filter(a => !a.deviceId);
    const dev = E.s.devices.find(d => d.id === ui.devId) || E.s.devices[0];
    const alloc = E.s.devices.filter(d => ['Reserved', 'Issued'].includes(d.status));
    const holder = d => {
      const L = E.s.leases.find(l => l.deviceId === d.id),
        a = d.applicationId && E.app(d.applicationId);
      return L
        ? { t: `IMEI ${d.imei}`, sub: `${prodName(d.productId)}, ${custName(L.customerId)}, lease ${L.id}`, act: 'openLease', id: L.id }
        : { t: `IMEI ${d.imei}`, sub: `${prodName(d.productId)}, held for ${a ? a.ref + ' ' + custName(a.customerId) : 'an application'}`, act: a ? 'openApp' : 'nav', id: a ? a.id : 'inventory' };
    };
    return {
      eyebrow: 'Inventory',
      title: 'Stock and handover',
      intro: `${plural(low.length, 'model is', 'models are')} low on stock. ${plural(ready.length, 'phone is', 'phones are')} paid for and waiting at handover, and ${plural(need.length, 'approved application has', 'approved applications have')} no phone reserved.`,
      metrics: [
        { h: 'Available devices', v: n('In Stock'), note: 'In stock, ready to reserve', good: 1 },
        { h: 'Reservations', v: n('Reserved'), note: 'Held for an application' },
        { h: 'Allocated', v: n('Issued'), note: 'Issued to customers' },
        { h: 'Low stock models', v: low.length, note: `At or below ${E.s.settings.lowStock} in stock`, bad: low.length }
      ],
      rows: [
        [
          {
            title: 'Handover and reservations',
            label: 'Inventory',
            rows: [
              ...ready.map(a => appRow(a, 'Deposit confirmed. Record the handover')),
              ...need.map(a => appRow(a, `Reserve a phone${a.expiresAt ? ', reservation ends ' + fd(a.expiresAt) : ''}`, { chip: a.status }))
            ],
            empty: 'Nothing to hand over or reserve.'
          },
          {
            title: 'Stock by model',
            label: 'Inventory',
            html: `<table class="t"><thead><tr><th>Model</th><th class="r">In stock</th><th class="r">Reserved</th><th class="r">Issued</th><th class="r">Owned</th></tr></thead><tbody>${sb.map(x => `<tr><td>${esc(prodName(x.product.id))}${x.low ? ' ' + chip('Low stock').replace('chip', 'chip bad') : ''}</td><td class="r">${x.inStock}</td><td class="r">${x.reserved}</td><td class="r">${x.issued}</td><td class="r">${x.owned}</td></tr>`).join('')}</tbody></table>`
          }
        ],
        [
          {
            title: 'Serial and IMEI history',
            label: 'Trace',
            html: dev
              ? `<div class="card-body"><label class="muted small">Phone<br><select data-act="pickDev" style="margin:4px 0 12px">${E.s.devices.map(d => `<option value="${d.id}" ${d.id === dev.id ? 'selected' : ''}>${d.imei}, ${esc(prodName(d.productId))}</option>`).join('')}</select></label><div class="row" style="margin-bottom:8px">${chip(dev.status)}<span class="muted small">${esc(dev.condition)}</span></div><ul class="tl">${(dev.history || []).slice().reverse().map(h => `<li><b>${esc(h.event)}</b> <span class="muted small">${fd(h.date)}, ${esc(h.by)}</span></li>`).join('') || '<li class="muted">No history recorded.</li>'}</ul></div>`
              : '',
            emptyText: 'No phones registered.'
          },
          {
            title: 'Allocation',
            label: 'Inventory',
            rows: alloc.map(d => ({ ...holder(d), chip: d.status })),
            emptyText: 'No phones are reserved or issued.'
          }
        ]
      ]
    };
  }

  function chartCard() {
    const s = E.stats(),
      mx = Math.max(1, ...s.monthly.map(m => Math.max(m.expected, m.collectedInst)));
    return {
      title: 'Expected against collected',
      label: 'Finance',
      html: `<div class="card-body"><div class="bars">${s.monthly.slice(-6).map(m => `<div><div class="pair"><i class="exp" title="Expected ${$m(m.expected)}" style="height:${(m.expected / mx) * 100}%"></i><i class="col" title="Collected ${$m(m.collectedInst)}" style="height:${(m.collectedInst / mx) * 100}%"></i></div><span>${MON[+m.month.slice(5) - 1]}</span></div>`).join('')}</div><div class="legend"><span><i style="background:var(--line)"></i>Installments falling due</span><span><i style="background:var(--brand)"></i>Cash collected against installments</span></div></div>`
    };
  }

  function dFinance() {
    const T = E.s.date,
      mo = T.slice(0, 7),
      day = E.dailyCollections(7),
      td = day[0],
      rq = E.requestsVsReceived(T),
      rm = E.requestsVsReceived(mo),
      rev = E.reversals(),
      revM = rev.filter(e => e.date.startsWith(mo));
    const quar = E.s.payments.filter(p => p.status === 'Quarantined'),
      ev = E.s.events.filter(e => ['Unmatched', 'Retry queued'].includes(e.status)),
      dis = E.s.disputes.filter(d => d.status === 'Open'),
      mxd = Math.max(1, ...day.map(d => d.cash));
    const pair = (n, a) => `${n} (${$m(a)})`;
    return {
      eyebrow: 'Finance',
      title: 'Reconciliation desk',
      intro: `${plural(quar.length + ev.length, 'exception needs', 'exceptions need')} review. A payment counts only after M-PESA confirms it, and no one can mark one paid by hand.`,
      metrics: [
        { h: 'Collected today', v: $m(td.net), note: `${plural(td.count, 'payment', 'payments')}, ${$m(td.reversed)} reversed`, good: td.net > 0 },
        { h: 'Confirmed of requested', v: `${rq.confirmed} of ${rq.requested}`, note: `${$m(rq.confirmedAmt)} of ${$m(rq.requestedAmt)} requested today` },
        { h: 'Unmatched and held', v: quar.length + ev.length, note: 'Quarantined, unmatched, retry', bad: quar.length + ev.length },
        { h: 'Reversals this month', v: $m(revM.reduce((s, e) => s - e.cash, 0)), note: plural(revM.length, 'reversal', 'reversals'), bad: revM.length }
      ],
      rows: [
        [
          {
            title: 'Reconciliation queue',
            label: 'Finance',
            rows: [
              ...quar.map(p => ({ t: `${p.id}: received ${$m(p.receivedAmount)}`, sub: `Expected ${$m(p.amount)} on ${p.leaseId}. Not applied`, chip: 'Quarantined', act: 'nav', id: 'payments' })),
              ...ev.map(e => ({ t: `${e.id}: ${e.kind === 'C2B' ? 'paybill notice' : 'callback'}${e.kind === 'C2B' ? ', ' + $m(e.payload.Amount) : ''}`, sub: e.note, chip: e.status, act: 'nav', id: 'payments' }))
            ],
            empty: 'Ledger and M-PESA agree.'
          },
          {
            title: 'Daily collections',
            label: 'Last 7 days',
            html: `<table class="t"><thead><tr><th>Date</th><th class="r">Payments</th><th class="r">Cash in</th><th class="r">Reversed</th><th class="r">Net</th></tr></thead><tbody>${day.map(d => `<tr><td class="nowrap">${fd(d.date)}</td><td class="r">${d.count}</td><td class="r">${$m(d.cash)}<div style="height:4px;margin-top:4px;border-radius:3px;background:var(--brand);width:${(d.cash / mxd) * 100}%;margin-left:auto"></div></td><td class="r">${d.reversed ? $m(d.reversed) : ''}</td><td class="r"><b>${$m(d.net)}</b></td></tr>`).join('')}</tbody></table>`
          }
        ],
        [
          {
            title: 'Expected against received',
            label: 'Finance',
            html: `<table class="t"><thead><tr><th></th><th class="r">Today</th><th class="r">This month</th></tr></thead><tbody><tr><td>Installments fallen due</td><td class="r">${$m(rq.due)}</td><td class="r">${$m(rm.due)}</td></tr><tr><td>Prompts requested</td><td class="r">${pair(rq.requested, rq.requestedAmt)}</td><td class="r">${pair(rm.requested, rm.requestedAmt)}</td></tr><tr><td>Confirmed by M-PESA</td><td class="r">${pair(rq.confirmed, rq.confirmedAmt)}</td><td class="r">${pair(rm.confirmed, rm.confirmedAmt)}</td></tr><tr><td>Still pending</td><td class="r">${rq.pending}</td><td class="r">${rm.pending}</td></tr><tr><td>Failed, cancelled or expired</td><td class="r">${rq.failed}</td><td class="r">${rm.failed}</td></tr><tr><td>Held for review</td><td class="r">${rq.quarantined}</td><td class="r">${rm.quarantined}</td></tr><tr><td>Reversed</td><td class="r">${rq.reversed}</td><td class="r">${rm.reversed}</td></tr></tbody></table>`
          },
          {
            title: 'Reversals',
            label: 'Ledger',
            rows: rev.slice(0, 6).map(e => ({ t: `${$m(-e.cash)} on ${e.leaseId}`, sub: `${fd(e.date)}. ${e.reason}`, chip: 'Reversed', act: 'openLease', id: e.leaseId })),
            emptyText: 'No reversals.'
          }
        ],
        [chartCard(), { title: 'Open disputes', label: 'Finance', rows: dis.map(d => ({ t: `${d.id} on ${d.leaseId}`, sub: d.reason, chip: 'Disputed', act: 'openLease', id: d.leaseId })), empty: 'No open disputes.' }]
      ]
    };
  }

  function dFinApprover() {
    const adj = E.s.adjustments,
      pend = adj.filter(x => x.status === 'Pending approval'),
      done = adj.filter(x => x.status !== 'Pending approval').slice().reverse(),
      m = E.s.date.slice(0, 7);
    const credit = E.s.leases.reduce((s, L) => s + E.creditBalance(L), 0);
    return {
      eyebrow: 'Finance approval',
      title: 'Adjustment approvals',
      intro: 'Waivers and refunds need a reason and your approval. You cannot approve one you requested, and balances are never edited by hand.',
      metrics: [
        { h: 'Waiting for approval', v: pend.length, note: 'Requested by Finance' },
        { h: 'Value waiting', v: $m(pend.reduce((s, x) => s + x.amount, 0)), note: 'Waivers and refunds' },
        { h: 'Approved this month', v: adj.filter(x => x.status === 'Approved' && (x.decidedAt || '').startsWith(m)).length, note: 'Posted to the ledger', good: 1 },
        { h: 'Customer credit held', v: $m(credit), note: 'Overpayments not yet applied' }
      ],
      rows: [
        [
          {
            title: 'To approve',
            label: 'Finance approver',
            rows: pend.map(x => ({
              t: `${x.type} of ${$m(x.amount)} on ${x.leaseId}`,
              sub: `${x.reason} (requested by ${x.requestedBy}). Balance ${$m(x.before)} to ${$m(x.after)}`,
              act: 'openLease',
              id: x.leaseId,
              extra: btn('adjDecide', 'Approve', { sm: 1, cls: 'primary', d: { id: x.id, ok: 1 } }) + btn('adjDecide', 'Decline', { sm: 1, d: { id: x.id, ok: 0 } })
            })),
            empty: 'No adjustments waiting.'
          },
          {
            title: 'Recently decided',
            label: 'Record',
            rows: done.slice(0, 6).map(x => ({
              t: `${x.type} of ${$m(x.amount)} on ${x.leaseId}`,
              sub: `${x.status} by ${x.decidedBy || 'n/a'}, ${fd(x.decidedAt)}`,
              chip: x.status,
              act: 'openLease',
              id: x.leaseId
            })),
            emptyText: 'Nothing decided yet.'
          }
        ]
      ]
    };
  }

  function dCollect() {
    const st = E.stats(),
      T = E.s.date,
      tasks = E.s.tasks
        .filter(t => t.status !== 'Resolved')
        .map(t => {
          const L = E.lease(t.leaseId),
            i = L.installments.find(x => x.id === t.instId);
          return { t, L, i, days: E.instState(L, i).daysPast, owed: E.instOutstanding(L, i) };
        })
        .sort((a, b) => b.days - a.days);
    const od = [];
    for (const L of E.s.leases) {
      if (L.activationDate && !L.closed) {
        for (const i of L.installments) {
          const x = E.instState(L, i);
          if (x.status === 'Overdue') {
            od.push({ L, i, x, task: E.s.tasks.find(t => t.instId === i.id && t.status !== 'Resolved') });
          }
        }
      }
    }
    od.sort((a, b) => b.x.daysPast - a.x.daysPast);
    const pr = E.promises(),
      open = pr.filter(p => p.state === 'Upcoming').length,
      broken = pr.filter(p => p.state === 'Broken').length,
      kept = pr.filter(p => p.state === 'Kept').length,
      wl = E.workload(),
      unc = tasks.filter(x => !x.t.contacts.length).length;
    const dis = E.s.disputes.filter(d => d.status === 'Open'),
      avg = od.length ? Math.round(od.reduce((s, o) => s + o.x.daysPast, 0) / od.length) : 0;
    return {
      eyebrow: 'Collections',
      title: 'Follow-up desk',
      intro: `${plural(od.length, 'installment is', 'installments are')} overdue. Log every contact. You cannot add penalties or change terms, and disputed amounts pause here.`,
      metrics: [
        { h: 'Overdue installments', v: od.length, note: `${$m(st.overdueAmt)} owed`, bad: od.length },
        { h: 'Average days past due', v: avg, note: 'Across overdue installments' },
        { h: 'Promises to pay', v: open, note: `${broken} broken, ${kept} kept`, good: !broken },
        { h: 'Follow-up workload', v: tasks.length, note: `${unc} not contacted yet`, bad: unc }
      ],
      rows: [
        [
          {
            title: 'Call list, oldest first',
            label: 'Collections',
            rows: tasks.map(x => {
              const lc = x.t.contacts.slice(-1)[0];
              return {
                t: `${custName(x.L.customerId)}, installment ${x.i.no}`,
                sub: `${$m(x.owed)} owed, ${x.days} days past due. ${lc ? 'Last contact ' + fd(lc.date) + ': ' + lc.outcome : 'Not contacted yet'}${x.t.promiseDate ? '. Promised ' + fd(x.t.promiseDate) : ''}`,
                chip: x.t.status,
                act: 'openLease',
                id: x.L.id,
                extra: btn('contact', 'Log contact', { sm: 1, d: { id: x.t.id } })
              };
            }),
            empty: 'No overdue accounts to chase.'
          },
          {
            title: 'Workload by officer',
            label: 'Team',
            html: `<table class="t"><thead><tr><th>Officer</th><th class="r">Open</th><th class="r">Promised</th><th class="r">Not contacted</th><th class="r">Contacts, 7 days</th></tr></thead><tbody>${wl.map(w => `<tr><td>${esc(w.officer)}</td><td class="r">${w.open}</td><td class="r">${w.promised}</td><td class="r">${w.uncontacted}</td><td class="r">${w.contactsWeek}</td></tr>`).join('')}</tbody></table>`
          }
        ],
        [
          {
            title: 'Overdue installments',
            label: 'Days past due',
            html: od.length
              ? `<div class="scroll"><table class="t"><thead><tr><th>Customer</th><th>Due</th><th class="r">Owed</th><th class="r">Days late</th><th>Status</th></tr></thead><tbody>${od.map(o => `<tr><td><button class="link" data-act="openLease" data-id="${o.L.id}">${esc(custName(o.L.customerId))}</button><br><span class="muted small">${o.L.id}, installment ${o.i.no}</span></td><td class="nowrap">${fd(o.i.due)}</td><td class="r">${$m(o.x.outstanding)}${o.x.partial ? '<br><span class="muted small">part paid</span>' : ''}</td><td class="r"><b>${o.x.daysPast}</b></td><td>${o.task ? chip(o.task.status) : chip('Overdue')}${o.x.disputed ? ' ' + chip('Disputed') : ''}</td></tr>`).join('')}</tbody></table></div>`
              : '',
            emptyText: 'Nothing is overdue.'
          },
          {
            title: 'Promises to pay',
            label: 'Follow-up',
            html: pr.length
              ? `<table class="t"><thead><tr><th>Customer</th><th>Promised</th><th>Outcome</th></tr></thead><tbody>${pr.map(p => `<tr><td>${esc(custName(p.L.customerId))}<br><span class="muted small">Installment ${p.i.no}, ${$m(p.i.amount)}</span></td><td class="nowrap">${fd(p.task.promiseDate)}</td><td>${chip(p.state === 'Kept' ? 'Paid' : p.state === 'Broken' ? 'Failed' : 'Pending').replace('>' + (p.state === 'Kept' ? 'Paid' : p.state === 'Broken' ? 'Failed' : 'Pending') + '<', '>' + p.state + '<')}</td></tr>`).join('')}</tbody></table>`
              : '',
            emptyText: 'No promises recorded.'
          }
        ],
        [
          { title: 'Arrears by age', label: 'Collections', html: tbl([...Object.entries(st.aging).map(([k, v]) => [k, $m(v)]), ['<b>Total overdue</b>', `<b>${$m(st.overdueAmt)}</b>`]]) },
          { title: 'Disputes (collections paused)', label: 'Finance', rows: dis.map(d => ({ t: `${d.id} on ${d.leaseId}`, sub: d.reason, chip: 'Disputed', act: 'openLease', id: d.leaseId })), empty: 'No disputes pausing collections.' }
        ]
      ]
    };
  }

  function dAudit() {
    const cons = E.s.customers.filter(c => c.consent && c.consent.given),
      dec = allDecisions(),
      rs = E.reviewStats();
    const quar = E.s.payments.filter(p => p.status === 'Quarantined'),
      adj = E.s.adjustments;
    const exc = [
      ...rs.exceptions.map(x => appRow(x.app, x.why, { chip: x.kind })),
      ...quar.map(p => ({ t: `${p.id} held for review`, sub: `Received ${$m(p.receivedAmount)}, expected ${$m(p.amount)}`, chip: 'Quarantined', act: 'nav', id: 'payments' })),
      ...E.reversals().map(e => ({ t: `Reversal on ${e.leaseId}`, sub: `${fd(e.date)}. ${e.reason}`, chip: 'Reversed', act: 'openLease', id: e.leaseId })),
      ...adj.map(x => ({ t: `${x.type} of ${$m(x.amount)} on ${x.leaseId}`, sub: `${x.reason}. Requested by ${x.requestedBy}${x.decidedBy ? ', decided by ' + x.decidedBy : ''}`, chip: x.status, act: 'openLease', id: x.leaseId }))
    ];
    return {
      eyebrow: E.role === 'Auditor' ? 'Assurance' : 'Compliance',
      title: 'Assurance desk',
      intro: 'Read-only view of customer consent, application decisions and operational exceptions.',
      metrics: [
        { h: 'Consent records', v: `${cons.length} of ${E.s.customers.length}`, note: 'Customers with recorded consent', good: cons.length === E.s.customers.length },
        { h: 'Exceptions', v: exc.length, note: 'Holds, quarantines, reversals and adjustments', bad: exc.length },
        { h: 'Quarantined payments', v: quar.length, note: 'Require finance review', bad: quar.length },
        { h: 'Application decisions', v: dec.length, note: 'Recorded approval decisions' }
      ],
      rows: [
        [
          {
            title: 'Consent records',
            label: 'Customers',
            html: `<div class="scroll"><table class="t"><thead><tr><th>Customer</th><th>Consent given</th><th>Identity</th></tr></thead><tbody>${E.s.customers.map(c => `<tr><td>${esc(c.name)}<br><span class="muted small">${c.id}</span></td><td class="nowrap">${c.consent && c.consent.given ? fd(c.consent.at) : chip('Failed').replace('>Failed<', '>Missing<')}</td><td>${chip(c.kyc.status === 'Pending' ? 'Pending' : c.kyc.status)}${c.kyc.by ? `<br><span class="muted small">${esc(c.kyc.by)}, ${fd(c.kyc.at)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
          },
          {
            title: 'Approval history',
            label: 'Decisions',
            rows: dec.slice(0, 8).map(d => appRow(d.app, `${d.by}, ${fd(d.date)} ${hhmm(d.ts)}${d.score != null ? `. Score ${d.score}, advised ${d.recommendation}` : ''}${d.deviated ? '. Against advice' : ''}. ${d.reason}`, { chip: d.outcome })),
            emptyText: 'No decisions yet.'
          }
        ],
        [
          { title: 'Exceptions', label: 'Review', rows: exc.slice(0, 10), empty: 'No exceptions.' },
          { title: 'Finance adjustments', label: 'Maker-checker', rows: adj.slice().reverse().slice(0, 8).map(x => ({ t: `${x.type} of ${$m(x.amount)} on ${x.leaseId}`, sub: `${x.status}. Requested by ${x.requestedBy}${x.decidedBy ? ', decided by ' + x.decidedBy : ''}`, chip: x.status, act: 'openLease', id: x.leaseId })), empty: 'No finance adjustments.' }
        ]
      ]
    };
  }

  /* ---------- application view ---------- */
  const FLOW = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Agreement Pending', 'Deposit Pending', 'Ready for Handover', 'Activated'];

  function queueHtml() {
    if (myCust()) return '';
    const st = ['Submitted', 'Under Review', 'On Hold', 'More Information Required'];
    const q = E.s.apps.filter(a => st.includes(a.status));
    if (!q.length) return '';
    return `<div class="panel flat scroll"><div class="ph"><h2>Approval queue</h2><span class="muted small">Submitted applications wait here for a Credit/Risk Officer, then an approver with enough authority. Reviews are due ${E.s.settings.reviewSlaDays} days after submission.</span></div><table class="t" style="margin-top:6px"><thead><tr><th>Reference</th><th>Customer</th><th class="r">Lease total</th><th>Decision level</th><th>Assigned to</th><th>Waiting</th><th>Status</th></tr></thead><tbody>${q.map(a => {
      const o = a.offer || E.buildOffer(E.pricing(a.pricingId)),
        late = a.queue && ['Submitted', 'Under Review'].includes(a.status) && E.s.date > a.queue.due;
      return `<tr class="click" data-act="openApp" data-id="${a.id}"><td><b>${a.ref}</b></td><td>${esc(custName(a.customerId))}</td><td class="r">${$m(o.total)}</td><td>${E.requiredApprover(a)}${a.escalation ? `<br><span class="muted small">Escalated to ${a.escalation.to}</span>` : ''}</td><td>${esc((a.queue && a.queue.assignedTo) || 'Unassigned')}</td><td>${D.diff(E.s.date, a.submittedAt || a.createdAt)} days${late ? ' ' + chip('Overdue') : ''}</td><td>${chip(a.status)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function vApps() {
    const list = E.s.apps.filter(a => (ui.appFilter === 'All' || a.status === ui.appFilter) && (!myCust() || a.customerId === myCust())).slice().reverse();
    const statuses = ['All', ...new Set(E.s.apps.map(a => a.status))];
    const salesActions = E.role === 'Sales Agent'
      ? `<div class="row">${btn('newCust', 'Register customer', { off: !E.can('customer.register') })}${btn('newApp', 'New application', { cls: 'primary', off: !E.can('app.create') })}</div>`
      : '';
    const customerFiles = E.role === 'Sales Agent' || E.can('kyc.verify')
      ? E.s.customers.slice().reverse().slice(0, 20).map(customer => {
          const documents = customer.kyc?.documents || {};
          const slots = [
            ['idFront', 'Identity front', '.jpg,.jpeg,.png,.pdf'], ['idBack', 'Identity back', '.jpg,.jpeg,.png,.pdf'],
            ['photo', 'Customer photo', '.jpg,.jpeg,.png'], ['proofAddress', 'Proof of address', '.jpg,.jpeg,.png,.pdf']
          ].filter(([slot]) => !(slot === 'idBack' && customer.idType === 'Passport'));
          const files = slots.map(([slot, label, accept]) => {
            const file = documents[slot];
            const view = file?.storageKey ? `<button type="button" class="link small" data-act="viewCustomerAttachment" data-key="${esc(file.storageKey)}" data-name="${esc(file.name)}">View ${esc(label.toLowerCase())}</button>` : '';
            const upload = `<label class="btn sm attachment-upload">${file ? 'Re-attach' : 'Attach'} ${esc(label.toLowerCase())}<input type="file" data-customer-file="${slot}" data-customer-id="${esc(customer.id)}" accept="${accept}"></label>`;
            return `<span class="customer-file-action">${view}${upload}</span>`;
          }).join(' ');
          return `<tr><td><b>${esc(customer.name)}</b><br><span class="muted small">${esc(customer.id)} · ${esc(customer.phone)}</span></td><td><div class="customer-file-list">${files}</div></td><td>${chip(customer.kyc?.status || 'Pending')}</td></tr>`;
        }).join('')
      : '';
    const customerFilesPanel = customerFiles ? `<div class="panel flat scroll" style="margin-top:14px"><h2>Customer KYC attachments</h2><table class="t"><thead><tr><th>Customer</th><th>Attachments</th><th>Status</th></tr></thead><tbody>${customerFiles}</tbody></table></div>` : '';
    return `<div class="ph"><div><h1>Applications</h1><p class="lede" style="margin:0">Each one moves through review, approval, agreement, deposit and handover. Switch roles at the top to do each step.</p></div>${salesActions}</div>
    <div style="margin-top:14px">${queueHtml()}</div>
    <div class="ph" style="margin-top:6px"><h2>All applications</h2><label class="muted small">Show <select data-act="appFilter" style="width:auto">${statuses.map(s => `<option ${s === ui.appFilter ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <div class="panel flat scroll"><table class="t"><thead><tr><th>Reference</th><th>Customer</th><th>Phone and term</th><th>Status</th><th>Started</th></tr></thead><tbody>${list.map(a => {
      const p = E.pricing(a.pricingId);
      return `<tr class="click" data-act="openApp" data-id="${a.id}"><td><b>${a.ref}</b></td><td>${esc(custName(a.customerId))}</td><td>${esc(prodName(p.productId))}, ${p.months} months</td><td>${chip(a.status)}</td><td>${fd(a.createdAt)}</td></tr>`;
    }).join('') || `<tr><td colspan="5" class="empty">No applications yet.</td></tr>`}</tbody></table></div>${customerFilesPanel}`;
  }

  function waiting(a) {
    const g = a.agreement;
    return ({
      Draft: 'Sales Agent or Customer: upload documents and submit',
      'More Information Required': 'Sales Agent or Customer: supply what was asked for and resubmit',
      Submitted: 'Credit/Risk Officer: pick up the review',
      'Under Review': `Credit/Risk Officer: KYC, assessment, documents and terms. Then a ${E.requiredApprover(a)} or higher decides`,
      'On Hold': 'Credit/Risk Officer or Approver: resume the review once the hold reason is cleared',
      'Agreement Pending': g ? `${g.customer ? '' : 'The customer must sign. '}${g.company ? '' : 'A company representative must authorize. '}A phone can be reserved now` : '',
      'Deposit Pending': 'Inventory Officer: reserve a phone if none yet. Customer: pay the deposit',
      'Ready for Handover': 'Inventory Officer: hand the phone over. This is a separate, deliberate step'
    })[a.status] || '';
  }

  function termsBlock(o, activation) {
    const due = i => (activation ? fd(D.addMonths(activation, i + 1)) : `${i + 1} month${i ? 's' : ''} after handover`);
    return `<div class="facts"><div><span>Deposit, paid before handover</span><b>${$m(o.deposit)}</b></div><div><span>Remaining balance</span><b>${$m(o.balance)}</b></div><div><span>${o.count} monthly installments</span><b>${$m(o.installments[0])}${o.installments[o.count - 1] !== o.installments[0] ? ` (last ${$m(o.installments[o.count - 1])})` : ''}</b></div><div><span>Total payable, no other charges</span><b>${$m(o.total)}</b></div></div>
    <div class="scroll"><table class="t"><thead><tr><th>Payment</th><th>When</th><th class="r">Amount</th></tr></thead><tbody><tr><td>Deposit</td><td>Before handover</td><td class="r">${$m(o.deposit)}</td></tr>${o.installments.map((x, i) => `<tr><td>Installment ${i + 1}</td><td>${due(i)}</td><td class="r">${$m(x)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td class="r"><b>${$m(o.total)}</b></td></tr></tbody></table></div>
    <p class="muted small" style="margin-bottom:0">Grace period of ${o.graceDays} calendar days after each due date. Price version ${o.pricingVersion}.</p>`;
  }

  const hhmm = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function assessmentPanel(a) {
    if (!a.assessment) return '';
    if (!E.can('risk.view')) {
      return `<div class="panel"><h2>Credit assessment</h2><div class="note warn">Risk and credit data is restricted to Credit/Risk Officers, Approvers, Auditors and Compliance. You are acting as ${esc(E.role)}.</div></div>`;
    }
    const m = E.getAssessment(a.id),
      I = m.inputs,
      rc = m.recommendation === 'Approve' ? 'ok' : m.recommendation === 'Refer' ? 'warn' : 'bad',
      h = m.hist;
    return `<div class="panel"><div class="ph"><h2>Credit assessment</h2><span class="muted small">Recorded by ${esc(m.by)}, ${fd(m.at)}. The score is advisory; the reviewer decides under company policy.</span></div>
    <div class="row" style="margin-bottom:6px"><b style="font-size:28px;letter-spacing:-.02em">${m.score}</b><span class="muted">of 100, ${m.band}</span><span class="chip ${rc}">Advisory: ${m.recommendation}</span></div><div class="meter"><i style="width:${m.score}%"></i></div>
    ${m.hardStops.length ? `<div class="note bad" style="margin-top:14px"><b>Policy hard stop.</b> Approval is blocked: ${esc(m.hardStops.join('; '))}.</div>` : ''}
    <div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>Factor</th><th class="r">Points</th><th>Basis</th></tr></thead><tbody>${m.comps.map(c => `<tr><td>${c.name}</td><td class="r">${c.pts} of ${c.max}</td><td class="muted">${esc(c.basis)}</td></tr>`).join('')}</tbody></table></div>
    <div class="two" style="margin-top:14px"><div><h3>Product eligibility</h3><ul class="plain">${m.elig.map(x => `<li><span>${esc(x.rule)}</span>${chip(x.ok ? 'Pass' : 'Failed')}</li>`).join('')}</ul></div>
    <div><h3>Fraud and duplicate checks</h3><ul class="plain">${m.flags.map(f => `<li><span>${esc(f.text)}</span><span class="chip ${f.sev === 'high' ? 'bad' : 'warn'}">${f.sev}</span></li>`).join('') || '<li><span class="muted">No indicators found.</span></li>'}</ul></div></div>
    <div class="two" style="margin-top:14px"><div><h3>History with us</h3><dl class="kv"><dt>Leases</dt><dd>${h.leases} (${h.closed} completed)</dd><dt>Installments on time</dt><dd>${h.installments ? `${h.onTime} of ${h.installments}` : 'No history'}</dd><dt>Longest delay</dt><dd>${h.maxDaysLate} days</dd><dt>Overdue now</dt><dd>${h.currentOverdue}</dd><dt>Disputes</dt><dd>${h.disputes}</dd><dt>Current exposure</dt><dd>${$m(h.exposure)}</dd></dl></div>
    <div><h3>Income and capacity</h3><dl class="kv"><dt>Source</dt><dd>${{ Salaried: 'Salaried', Business: 'Business cash flow', Casual: 'Casual or mobile money' }[I.source]}</dd><dt>Income used</dt><dd>${$m(m.basis)}</dd><dt>Obligations</dt><dd>${$m(I.obligations)}</dd><dt>Installment share</dt><dd>${m.ratio}%</dd><dt>With obligations</dt><dd>${m.dsr}%</dd><dt>Left after obligations</dt><dd>${$m(m.disposable)}</dd>${I.notes ? `<dt>Notes</dt><dd>${esc(I.notes)}</dd>` : ''}</dl></div></div></div>`;
  }

  function decisionsPanel(a) {
    const d = (a.decisions || []).slice().reverse();
    if (!d.length) return '';
    const risk = E.can('risk.view');
    return `<div class="panel flat scroll"><h2>Decision record</h2><table class="t" style="margin-top:8px"><thead><tr><th>Date and time</th><th>By</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>${d.map(x => `<tr><td class="nowrap">${fd(x.date)}<br><span class="muted small">${hhmm(x.ts)}</span></td><td>${esc(x.by)}</td><td>${chip(x.outcome)}${x.deviated ? '<br><span class="chip warn" style="margin-top:4px">Against advice</span>' : ''}${risk && x.score != null ? `<br><span class="muted small">Score ${x.score}, advised ${x.recommendation}</span>` : ''}</td><td>${x.label ? `<b>${esc(x.label)}</b><br>` : ''}${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function agreementDocHtml(doc, g) {
    const sig = `<h3>Acceptance and authorization</h3><dl class="kv"><dt>Customer</dt><dd>${g.customer ? `${esc(g.customer.signedAs)}, signed ${fd(g.customer.at)}` : '<span class="muted">Not yet signed</span>'}</dd><dt>For ${esc(doc.company)}</dt><dd>${g.company ? `${esc(g.company.by)}, authorized ${fd(g.company.at)}` : '<span class="muted">Not yet authorized</span>'}</dd></dl>`;
    const ho = g.handoverRecord
      ? `<h3>Handover record</h3><dl class="kv"><dt>IMEI</dt><dd>${g.handoverRecord.imei}</dd><dt>Handed over</dt><dd>${fd(g.handoverRecord.date)}</dd><dt>Accessories</dt><dd>${esc(g.handoverRecord.accessories)}</dd><dt>Condition</dt><dd>${esc(g.handoverRecord.condition)}</dd></dl>`
      : '';
    return `<div class="doc"><h2>Phone lease agreement</h2>${doc.sections.map(s => `<h3>${esc(s.title)}</h3>` + (s.rows ? `<dl class="kv">${s.rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>` : '') + (s.table ? `<table class="t"><tbody>${s.table.map((r, i) => `<tr><td>${i === s.table.length - 1 && s.id === 'charges' ? '<b>' + esc(r[0]) + '</b>' : esc(r[0])}</td><td class="muted">${esc(r[1])}</td><td class="r">${$m(r[2])}</td></tr>`).join('')}</tbody></table>` : '') + (s.text ? `<p>${esc(s.text)}</p>` : '')).join('')}${sig}${ho}<p class="muted small">Template wording. Have the company's legal adviser approve it before real use.</p></div>`;
  }

  function agreementPanel(a) {
    const g = a.agreement,
      prev = a.agreements || [];
    if (!g && !prev.length) return '';
    let h = `<div class="panel"><div class="ph"><h2>Lease agreement</h2>${g ? chip(g.accepted ? 'Signed' : 'Awaiting signatures') : ''}</div>`;
    if (g) {
      h += `<dl class="kv"><dt>Version</dt><dd>${g.id}, version ${g.version}, from price version ${g.offerVersion}, generated ${fd(g.generatedAt)}</dd><dt>Customer signature</dt><dd>${g.customer ? `${chip('Signed')} ${esc(g.customer.signedAs)}, ${fd(g.customer.at)}` : chip('Awaiting')}</dd><dt>Company authorization</dt><dd>${g.company ? `${chip('Signed')} ${esc(g.company.by)}, ${fd(g.company.at)}` : chip('Awaiting')}</dd></dl><details style="margin-top:12px"><summary class="link">Read the full agreement</summary><div style="margin-top:10px">${agreementDocHtml(g.doc, g)}</div></details>`;
    } else {
      h += '<p class="muted" style="margin:0">The agreement was withdrawn. A new version is issued when the application is approved again.</p>';
    }
    if (prev.length) {
      h += `<h3 style="margin-top:14px">Earlier versions</h3><ul class="plain">${prev.map(v => `<li><span>Version ${v.version} (${v.id}), from price version ${v.offerVersion}<br><span class="muted small">${esc(v.reason)}, ${fd(v.supersededAt)}</span></span>${chip('Superseded')}</li>`).join('')}</ul>`;
    }
    return h + '</div>';
  }

  function vApp() {
    const a = E.app(ui.appId),
      c = E.cust(a.customerId),
      p = E.pricing(a.pricingId),
      L = E.leaseOfApp(a);
    const offer = a.offer || E.buildOffer(p),
      risk = E.can('risk.view'),
      g = a.agreement;
    const R = (x, y) => (E.can(x) ? y : '');
    const idx = FLOW.indexOf(a.status),
      alt = idx < 0;
    const steps = `<div class="steps">${FLOW.map((s, i) => `<span class="step ${i === idx ? 'now' : !alt && i < idx ? 'done' : ''}">${s}</span>`).join('')}</div>${alt ? `<div class="row small" style="margin-top:6px"><span class="muted">Outcome:</span>${chip(a.status)}</div>` : ''}`;
    const docs = Object.entries(DOC_KINDS)
      .map(
        ([k, l]) =>
          `<li><span>${l}${a.docs[k] ? `<br><span class="muted small">${esc(a.docs[k].name)}, ${a.docs[k].sizeKB} KB</span>` : ''}</span>${a.docs[k] ? chip('Received') : ['Draft', 'More Information Required'].includes(a.status) && E.can('app.create') ? `<input type="file" data-doc="${k}" accept=".pdf,.jpg,.jpeg,.png" style="width:auto;max-width:210px;border:0;padding:0">` : '<span class="muted small">Missing</span>'}</li>`
      )
      .join('');
    const customerKycDocs = [
      ['Identity front', c.kyc?.documents?.idFront],
      ['Identity back', c.kyc?.documents?.idBack],
      ['Customer photo', c.kyc?.documents?.photo],
      ['Proof of address', c.kyc?.documents?.proofAddress]
    ].filter(([, file]) => file);
    const customerKycPanel = customerKycDocs.length ? `<div class="panel"><h2>Customer KYC attachments</h2><ul class="plain">${customerKycDocs.map(([label, file]) => `<li><span>${esc(label)}<br><span class="muted small">${esc(file.name)}</span></span>${file.storageKey ? `<button type="button" class="link small" data-act="viewCustomerAttachment" data-key="${esc(file.storageKey)}" data-name="${esc(file.name)}">View attachment</button>` : '<span class="muted small">Preview unavailable for earlier upload</span>'}</li>`).join('')}</ul></div>` : '';
    let act = '';
    const rev = ['Submitted', 'Under Review'].includes(a.status);
    if (['Draft', 'More Information Required'].includes(a.status)) {
      act = R('app.submit', btn('submitApp', 'Submit application', { cls: 'primary' }));
    }
    if (a.status === 'Submitted') {
      act += R('kyc.verify', btn('claim', 'Pick up review', { cls: 'primary' }));
    }
    if (rev) {
      act +=
        R('kyc.verify', btn('kyc', 'Verify KYC') + btn('kycService', 'Run verification service') + btn('assess', a.assessment ? 'Update assessment' : 'Record assessment') + btn('review', 'Confirm documents and terms')) +
        R('app.decide', btn('decide', 'Approve', { cls: 'primary', d: { k: 'approve' } }) + btn('decide', 'Reject', { cls: 'danger', d: { k: 'reject' } })) +
        R('app.refer', btn('decide', 'Ask for information', { d: { k: 'info' } }) + btn('decide', 'Put on hold', { d: { k: 'hold' } }) + btn('escalate', 'Escalate'));
    }
    if (a.status === 'On Hold') {
      act = R('app.refer', btn('resume', 'Resume review', { cls: 'primary' }));
    }
    if (a.status === 'Rejected') {
      act = R('app.decide', btn('reopen', 'Reopen for review'));
    }
    if (a.status === 'Agreement Pending') {
      act =
        R('agreement.accept', g && !g.customer ? btn('accept', 'Customer: review and sign', { cls: 'primary' }) : '') +
        R('agreement.authorize', g && !g.company ? btn('authorize', 'Company: authorize agreement', { cls: 'primary' }) : '') +
        R('device.manage', btn('reserve', a.deviceId ? 'Phone reserved' : 'Reserve a phone', { off: !!a.deviceId })) +
        R('agreement.generate', g && !g.customer && !g.company ? btn('regen', 'Regenerate agreement') : '') +
        R('app.decide', btn('changeTerms', 'Change terms'));
    }
    if (a.status === 'Deposit Pending') {
      act =
        R('device.manage', btn('reserve', a.deviceId ? 'Phone reserved' : 'Reserve a phone', { off: !!a.deviceId })) +
        R('payment.initiate', btn('stk', `Request deposit ${$m(E.depositOutstanding(L))} via M-PESA`, { cls: 'primary', d: { purpose: 'deposit' }, off: E.depositOutstanding(L) <= 0 }));
    }
    if (a.status === 'Ready for Handover') {
      act = R('handover', btn('handover', 'Record handover', { cls: 'primary' }) + btn('cancelHandover', 'Cancel handover'));
    }
    if (E.isOpenApp(a)) {
      act += R('app.cancel', btn('cancelApp', 'Cancel application', { cls: 'danger' }));
    }
    if (a.status === 'Activated') {
      act = btn('openLease', 'Open lease ' + L.id, { cls: 'primary', d: { id: L.id } });
    }
    const dev = a.deviceId ? E.device(a.deviceId) : null,
      pays = L ? E.s.payments.filter(x => x.leaseId === L.id && x.purpose === 'deposit') : [];
    const rv = a.review;
    return `<button class="link small" data-act="nav" data-id="applications">Back to applications</button>
    <div class="ph" style="margin-top:8px">
      <div>
        <h1>${a.ref}: ${esc(c.name)}</h1>
        <div class="row">${chip(a.status)}<span class="muted">${esc(prodName(p.productId))}, ${p.months} months</span></div>
      </div>
    </div>${steps}
    <div class="note" style="margin:14px 0 18px"><b>Next:</b> ${esc(waiting(a) || (a.status === 'Activated' ? 'The phone is issued and the lease is being serviced.' : 'This application is closed.'))}${act ? '' : `<br><span class="muted">You are acting as ${esc(E.role)}, which has no action here. Switch role at the top.</span>`}</div>
    ${act ? `<div class="row" style="margin-bottom:18px">${act}</div>` : ''}
    <div class="two"><div>
      <div class="panel"><div class="ph"><h2>${g && g.accepted ? 'Signed terms' : 'Offer disclosed to the customer'}</h2><span class="muted small">Fixed total, no other charges</span></div>${termsBlock(offer, L && L.activationDate)}</div>
      ${agreementPanel(a)}${assessmentPanel(a)}
      ${pays.length ? `<div class="panel flat scroll"><h2>Deposit payments</h2><table class="t" style="margin-top:8px"><thead><tr><th>Payment</th><th class="r">Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${pays.map(x => `<tr><td>${x.id} ${x.channel}</td><td class="r">${$m(x.amount)}</td><td>${chip(x.status)}</td><td>${esc(x.providerTxId || 'None yet')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div><div>
      <div class="panel"><h2>Review checks</h2><dl class="kv"><dt>Identity (KYC)</dt><dd>${chip(c.kyc.status)}${c.kyc.note ? `<br><span class="muted small">${esc(c.kyc.by)}: ${esc(c.kyc.note)}</span>` : ''}</dd><dt>Documents verified</dt><dd>${rv ? chip(rv.documents ? 'Pass' : 'Failed') : '<span class="muted">Not yet</span>'}</dd><dt>Lease terms verified</dt><dd>${rv ? chip(rv.terms ? 'Pass' : 'Failed') : '<span class="muted">Not yet</span>'}</dd><dt>Credit assessment</dt><dd>${a.assessment ? (risk ? `${chip(a.assessment.recommendation === 'Approve' ? 'Pass' : a.assessment.recommendation === 'Refer' ? 'Refer' : 'Failed')} score ${a.assessment.score}` : 'Recorded. Details are restricted') : '<span class="muted">Not recorded</span>'}</dd><dt>Decision level</dt><dd>${E.requiredApprover(a)}${a.escalation ? `<br><span class="muted small">Escalated to ${a.escalation.to}: ${esc(a.escalation.reason)}</span>` : ''}</dd>${a.queue && rev ? `<dt>Review due</dt><dd>${fd(a.queue.due)}</dd>` : ''}<dt>Customer</dt><dd>${c.id}, ${esc(c.phone)}</dd><dt>Phone reserved</dt><dd>${dev ? `IMEI ${dev.imei}` : '<span class="muted">None yet</span>'}</dd>${a.expiresAt && ['Agreement Pending', 'Deposit Pending'].includes(a.status) ? `<dt>Reservation ends</dt><dd>${fd(a.expiresAt)}</dd>` : ''}</dl></div>
      ${decisionsPanel(a)}
      ${customerKycPanel}
      <div class="panel"><h2>Documents</h2><ul class="plain">${docs}</ul></div>
      <div class="panel"><h2>History</h2><ul class="tl">${a.history.slice().reverse().map(h => `<li><b>${h.to}</b> <span class="muted small">${fd(h.date)}, ${esc(h.by)}</span>${h.note ? `<br><span class="small">${esc(h.note)}</span>` : ''}</li>`).join('')}</ul></div>
    </div></div>`;
  }

  function vSystemConfig() {
    if (E.role !== 'Super Admin') return `<h1>System Configuration</h1><div class="note warn">Only a Super Admin can view or change system configuration.</div>`;
    const S = E.s.systemConfig;
    const field = (label, id, value, type = 'text', extra = '') => `<label class="sys-field"><span>${label}</span><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
    const select = (label, id, value, options) => `<label class="sys-field"><span>${label}</span><select id="${id}">${options.map(option => `<option ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
    const auditRows = E.s.systemConfigAudit.slice().reverse().map(event => `<tr><td class="nowrap">${esc(new Date(event.timestamp).toLocaleString('en-GB'))}</td><td>${esc(event.event)}</td><td><b>${esc(event.reference)}</b></td><td>${esc(event.details)}</td><td>${esc(event.performedBy)}</td></tr>`).join('');
    return `<div class="sys-page-head"><div><h1>System Configuration</h1><p class="lede" style="margin:4px 0 0">Super Admin controls for core platform settings and operational defaults.</p></div><span class="chip warn">♙ Super Admin Only</span></div>
      <section class="panel flat sys-panel"><div class="sys-panel-head"><h2>${svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>')} Core system settings</h2></div><div class="sys-panel-body">
        <div class="sys-grid">${field('Organisation name', 'sysOrganization', S.organizationName)}${select('Default currency', 'sysCurrency', S.currency, ['KES — Kenyan Shilling', 'USD — US Dollar', 'EUR — Euro', 'GBP — Pound Sterling'])}${select('System timezone', 'sysTimezone', S.timezone, ['Africa/Nairobi (EAT)', 'Africa/Kampala (EAT)', 'Africa/Dar_es_Salaam (EAT)', 'UTC'])}${field('Session timeout (minutes)', 'sysSessionTimeout', S.sessionTimeout, 'number', 'min="1" max="1440"')}</div>
        <div class="sys-subhead">DATABASE CONNECTION</div><div class="sys-info">${svg('<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>')} These settings are stored locally for this browser demo. They do not create a live database connection.</div>
        <div class="sys-grid">${select('Database engine', 'sysDbEngine', S.databaseEngine, ['Browser Local Storage', 'PostgreSQL', 'MySQL', 'SQLite'])}${field('Database name', 'sysDbName', S.databaseName)}${field('Host', 'sysHost', S.host)}${field('Port', 'sysPort', S.port, 'number', 'min="1" max="65535"')}${field('Username', 'sysUsername', S.username)}${select('SSL mode', 'sysSslMode', S.sslMode, ['Disabled', 'Require', 'Verify CA', 'Verify Full'])}</div>
        <div class="sys-subhead">SECURITY</div><div class="sys-info">${svg('<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M12 12v4"/>')} Security values are saved as browser-demo settings. Production enforcement requires an authenticated backend.</div>
        <div class="sys-grid">${field('Minimum password length', 'sysMinPassword', S.minPasswordLength, 'number', 'min="8" max="128"')}${field('Password expiry (days)', 'sysPasswordExpiry', S.passwordExpiryDays, 'number', 'min="0" max="3650"')}<span></span><small class="sys-help">Use 0 to disable expiry.</small>${field('Maximum login attempts', 'sysMaxAttempts', S.maxLoginAttempts, 'number', 'min="1" max="50"')}${field('Account lockout duration (minutes)', 'sysLockout', S.lockoutMinutes, 'number', 'min="1" max="1440"')}${select('Multi-factor authentication', 'sysMfa', S.mfa, ['Disabled', 'Optional', 'Required'])}${select('Audit logging', 'sysAuditLogging', S.auditLogging, ['Enabled', 'Disabled'])}</div>
        <label class="sys-field sys-ip"><span>IP whitelisting — range access control list</span><textarea id="sysIpWhitelist" placeholder="Example: 192.168.1.10, 10.0.0.0/24">${esc(S.ipWhitelist)}</textarea><small>Enter one IPv4 address or CIDR range per line. Leave empty to allow access from any IP.</small></label>
        <div class="sys-actions"><button type="button" class="btn primary" data-act="systemConfigSave">▣ Save configuration</button></div>
      </div></section>
      <section class="panel flat sys-panel sys-audit"><div class="sys-panel-head"><h2>${svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>')} System Audit Log</h2><span class="chip blue">${E.s.systemConfigAudit.length} Events</span></div><div class="scroll"><table class="t"><thead><tr><th>Date &amp; Time</th><th>Event</th><th>Reference</th><th>Details</th><th>Performed by</th></tr></thead><tbody>${auditRows || '<tr><td colspan="5" class="empty">No audited events yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function vRoles() {
    if (E.role !== 'Super Admin') return `<h1>Roles and access</h1><div class="note warn">Only a Super Admin can view or manage roles and access.</div>`;
    const can = E.can('perms.manage'),
      S = E.s.settings;
    return `<div class="ph"><div><h1>Roles and access</h1><p class="lede" style="margin:0">The approved minimum access is the starting point. A Super Admin can grant or remove access, and every change goes to the audit log. The safeguards below cannot be switched off.</p></div>${btn('permReset', 'Reset to approved defaults', { off: !can })}</div>
    ${can ? '' : `<div class="note warn" style="margin:14px 0">You are acting as ${esc(E.role)}. Only a Super Admin can change access. Switch role at the top to edit.</div>`}
    <div class="panel flat scroll" style="margin-top:14px"><table class="t matrix"><thead><tr><th>Action</th>${ROLES.map(r => `<th class="c">${r}</th>`).join('')}</tr></thead><tbody>${PERM_ROWS.map(([act, label, note]) => `<tr><td>${label}${note ? `<br><span class="muted small">${note}</span>` : ''}</td>${ROLES.map(r => `<td class="c"><input type="checkbox" data-act="perm" data-a="${act}" data-r="${r}" ${E.s.perms[act].includes(r) ? 'checked' : ''} ${can && !(act === 'audit.view' && r !== 'Super Admin') ? '' : 'disabled'} aria-label="${r}: ${label}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="three"><div class="panel"><h2>Approval limits</h2><dl class="kv"><dt>Approver</dt><dd>Up to ${$m(S.approverLimit)}</dd><dt>Senior Approver</dt><dd>Up to ${$m(S.seniorLimit)}</dd><dt>Above that</dt><dd>Super Admin</dd></dl><p class="muted small">Measured on the total lease price. Larger applications are escalated.</p>${btn('settings', 'Edit limits', { sm: 1, off: !E.can('settings') })}</div>
    <div class="panel"><h2>Verification service</h2><label class="row"><input type="checkbox" data-act="perm" data-a="kyc.verify" data-r="KYC Service" ${E.s.perms['kyc.verify'].includes('KYC Service') ? 'checked' : ''} ${can ? '' : 'disabled'}> The automated verification service may record KYC results</label></div>
    <div class="panel"><h2>System only</h2><ul class="plain">${SYSTEM_ONLY.map(([t, d]) => `<li><span><b>${t}</b><br><span class="muted small">${d}</span></span>${chip('Locked')}</li>`).join('')}</ul></div></div>
    <div class="panel"><h2>Safeguards that always apply</h2><ul class="plain"><li>Nobody can approve a decision, or authorize an agreement, on an application they created.</li><li>Pricing created by a Product Admin must be activated by someone else, or by a Super Admin.</li><li>An adjustment needs a reason, and a Finance Approver other than the requester must approve it.</li><li>Successful payments cannot be deleted. Mistakes are reversed with a linked entry.</li><li>No one can edit a balance or mark a lease paid by hand.</li><li>Every permission change is audited, and Super Admin always keeps the right to change access.</li></ul></div>`;
  }

  function systemRolesPanel() {
    const descriptions = {
      'Super Admin': 'Full system administration and access control.',
      'Product Admin': 'Manage phone catalogue, pricing and operating policy.',
      'Sales Agent': 'Register customers and prepare lease applications.',
      'Customer': 'Access personal applications, leases and payments.',
      'Credit/Risk Officer': 'Verify customer information and assess applications.',
      'Approver': 'Approve applications within the configured limit.',
      'Senior Approver': 'Approve higher value applications within the senior limit.',
      'Inventory Officer': 'Register and manage handset inventory and handovers.',
      'Finance Officer': 'Reconcile payments and manage finance operations.',
      'Finance Approver': 'Review and approve finance adjustments.',
      'Collections Officer': 'Contact customers and manage collections follow-ups.',
      'Auditor': 'Review audit records and operational activity.',
      'Compliance Officer': 'Review risk, compliance and customer records.'
    };
    const rows = ROLES.map(role => {
      const assigned = (E.s.staffAssignments || []).filter(item => item.position === role && item.status === 'Active').length;
      const permissionCount = Object.values(E.s.perms).filter(list => list.includes(role)).length;
      return `<tr><td><b>${esc(role)}</b></td><td>${esc(descriptions[role] || 'System role for controlled application access.')}</td><td>${esc(staffDepartment(role))}</td><td class="r">${assigned}</td><td class="r">${permissionCount}</td><td>${chip('Active')}</td></tr>`;
    }).join('');
    const permissionRows = PERM_ROWS.map(([key, label, note]) => {
      const roles = E.s.perms[key] || [];
      return `<tr><td><b>${esc(label)}</b></td><td><code>${esc(key)}</code></td><td>${roles.length ? roles.map(role => esc(role)).join(', ') : '<span class="muted">No roles granted</span>'}</td><td>${esc(note || 'Role-based access')}</td></tr>`;
    }).join('') + SYSTEM_ONLY.map(([label, note]) => `<tr><td><b>${esc(label)}</b></td><td><code>system.only</code></td><td>${chip('Locked')}</td><td>${esc(note)}</td></tr>`).join('');
    return `<div class="panel flat scroll" style="margin-top:20px"><div class="ph"><div><h2>System Roles</h2><p class="muted small" style="margin:4px 0 0">Built-in roles and their access. Change permissions from Roles and access.</p></div>${btn('nav', 'Manage access', { sm: 1, d: { id: 'roles' } })}</div><table class="t"><thead><tr><th>System role</th><th>Description</th><th>Department</th><th class="r">Active assignments</th><th class="r">Permissions</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel flat scroll" style="margin-top:20px"><div class="ph"><div><h2>Permissions Catalog Reference</h2><p class="muted small" style="margin:4px 0 0">Permission keys, descriptions and current role grants. Manage grants from Roles and access.</p></div></div><table class="t"><thead><tr><th>Permission</th><th>Key</th><th>Roles / control</th><th>Notes</th></tr></thead><tbody>${permissionRows}</tbody></table></div>`;
  }

  function staffPositionsPanel() {
    const positions = (E.s.staffPositions || []).map(position => `<span style="display:inline-flex;align-items:center;gap:10px;padding:5px 8px 5px 13px;border-radius:999px;background:#eef3f8;color:#657791;font-weight:700;letter-spacing:.02em">${esc(position.name)}<button type="button" class="btn" data-act="staffPositionRemove" data-id="${esc(position.id)}" aria-label="Remove ${esc(position.name)}" title="Remove position" style="min-width:32px;height:30px;padding:0 9px;border:1px solid #d7e0e9;background:#fff;color:#334155;border-radius:8px">×</button></span>`).join('');
    return `<div class="panel flat" style="margin-top:20px;padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--line,#dce5ef);display:flex;align-items:center;gap:14px"><h2 style="margin:0">Positions</h2></div><div style="padding:22px 26px 24px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><input id="staffPositionInput" type="text" aria-label="Add a position" placeholder="Add a position" style="width:min(100%,262px);height:48px;padding:0 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit"><button type="button" class="btn primary" data-act="staffPositionAdd" aria-label="Add position" title="Add position" style="height:48px;min-width:64px;font-size:22px">+</button></div><div style="display:flex;flex-wrap:wrap;gap:10px 12px">${positions || '<span class="muted">No positions yet. Add a position above.</span>'}</div></div></div>`;
  }

  function makerCheckerPanel() {
    const approvals = [
      ...(E.s.adjustments || []).map(request => ({
        id: request.id, kind: 'adjustment', summary: `${request.type} ${$m(request.amount)} · ${request.leaseId}: ${request.reason}`,
        submittedBy: request.requestedBy, submittedAt: request.requestedAt, status: request.status, decidedBy: request.decidedBy,
        reviewAct: 'staffApprovalReview', canReview: E.can('adjust.approve')
      })),
      ...(E.s.staffChangeRequests || []).map(request => ({
        id: request.id, kind: 'staff',
        typeLabel: ({
          'staff.add': 'Staff addition', 'staff.delete': 'Staff deletion', 'staff.edit': 'Staff update',
          'assignment.add': 'Position assignment', 'assignment.edit': 'Assignment update'
        })[request.kind] || 'Staff change',
        summary: request.summary,
        submittedBy: request.submittedBy, submittedAt: request.submittedAt, status: request.status, decidedBy: request.decidedBy,
        reviewAct: 'staffChangeReview', canReview: E.can('staff.changes.approve')
      }))
    ].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    const pending = approvals.filter(request => request.status === 'Pending approval');
    const rows = approvals.map(request => `<tr><td><b>${request.kind === 'staff' ? esc(request.typeLabel) : 'Finance adjustment'}</b><br>${esc(request.summary)}</td><td>${esc(request.submittedBy)}</td><td>${fd(request.submittedAt)}</td><td>${chip(request.status)}${request.decidedBy ? `<br><span class="muted small">Checked by ${esc(request.decidedBy)}</span>` : ''}</td><td>${request.status === 'Pending approval' && request.canReview ? btn(request.reviewAct, 'Review', { sm: 1, d: { id: request.id } }) : ''}</td></tr>`).join('');
    const inaccessible = pending.some(request => !request.canReview);
    return `<div class="panel flat scroll" style="margin-top:20px"><div class="ph"><div><h2>Maker-checker approvals</h2><p class="muted small" style="margin:4px 0 0">Staff additions, assignments and deletions need a different checker. Finance adjustments also require separate approval.</p></div><span class="chip ${pending.length ? 'warn' : 'ok'}">${pending.length} Pending</span></div><table class="t"><thead><tr><th>Requested change</th><th>Submitted by</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">No approval requests yet.</td></tr>'}</tbody></table>${inaccessible ? `<p class="muted small" style="margin:10px 0 0">Some requests need another reviewer role. Staff changes are reviewed by a Senior Approver; finance adjustments are reviewed by an authorized Finance Approver or Super Admin.</p>` : ''}</div>`;
  }

  function leaseChips(L) {
    const s = E.leaseStatus(L);
    return chip(s.status) + s.flags.map(f => ' ' + chip(f)).join('');
  }

  function vLeases() {
    const rows = E.s.leases.filter(L => !myCust() || L.customerId === myCust()).slice().reverse();
    return `<h1>Leases</h1><p class="lede">One row per signed agreement. Open a lease for its schedule, ledger and payments.</p><div class="panel flat scroll"><table class="t"><thead><tr><th>Lease</th><th>Customer</th><th>Phone</th><th>Status</th><th class="r">Outstanding</th><th>Next due</th></tr></thead><tbody>${rows.map(L => {
      const n = E.nextInstallment(L);
      const a = E.app(L.appId);
      return `<tr class="click" data-act="openLease" data-id="${L.id}"><td><b>${L.id}</b></td><td>${esc(custName(L.customerId))}</td><td>${esc(prodName(L.terms.productId))}</td><td>${leaseChips(L)}</td><td class="r">${$m(E.outstanding(L))}</td><td>${L.activationDate ? (n ? `${fd(n.due)}, ${$m(E.instOutstanding(L, n))}` : 'Nothing due') : '<span class="muted">' + esc(a.status) + '</span>'}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No signed agreements yet.</td></tr>'}</tbody></table></div>`;
  }

  function stripHtml(L) {
    const segs = [];
    const dp = E.paidOn(L, 'deposit');
    segs.push(`<div class="seg ${dp >= L.terms.deposit ? 'paid' : 'warn'}" style="--c:${dp >= L.terms.deposit ? 'var(--good)' : '#C58A12'}"><b>Deposit</b><small>${fd(L.signedOn)}</small><em>${$m(L.terms.deposit)}</em><i style="width:${Math.min(100, (dp / L.terms.deposit) * 100)}%"></i></div>`);
    const src = L.installments.length ? L.installments : L.terms.installments.map((a, i) => ({ id: null, no: i + 1, due: null, amount: a }));
    src.forEach(i => {
      let cls = '', pct = 0, lab = 'Scheduled';
      if (i.id) {
        const st = E.instState(L, i);
        pct = (st.paid / i.amount) * 100;
        lab = st.status;
        cls = st.status === 'Paid' ? 'paid' : st.status === 'Overdue' ? 'bad' : ['Grace Period', 'Due', 'Partially Paid'].includes(st.status) ? 'warn' : '';
      }
      segs.push(`<div class="seg ${cls}" title="${lab}"><b>Installment ${i.no}</b><small>${i.due ? fd(i.due) : 'After handover'}</small><em>${$m(i.amount)}</em><i style="width:${pct}%"></i></div>`);
    });
    return `<div class="strip" role="img" aria-label="Repayment progress">${segs.join('')}</div>`;
  }

  function vLease() {
    const L = E.lease(ui.leaseId),
      c = E.cust(L.customerId),
      a = E.app(L.appId),
      st = E.leaseStatus(L);
    const paid = E.totalPaid(L),
      out = E.outstanding(L),
      cr = E.creditBalance(L),
      nxt = E.nextInstallment(L);
    const act = [];
    if (L.activationDate && !L.closed) {
      if (E.can('payment.initiate') && nxt) act.push(btn('stk', `Collect installment ${nxt.no} (${$m(E.instOutstanding(L, nxt))})`, { cls: 'primary', d: { purpose: 'installment', inst: nxt.id } }));
      if (E.can('payment.initiate') && out > 0) act.push(btn('quote', 'Settlement quote'));
      if (E.can('dispute.manage')) act.push(btn('dispute', 'Open dispute'));
      if (E.can('adjust.request')) act.push(btn('adjust', 'Request adjustment'));
      if (E.can('ownership.transfer')) act.push(btn('checks', 'Run completion checks') + btn('transfer', 'Complete ownership transfer', { cls: out <= 0 ? 'primary' : '' }));
    }
    const pays = E.s.payments.filter(p => p.leaseId === L.id).slice().reverse(),
      led = E.entries(L).slice().reverse();
    const tasks = E.s.tasks.filter(t => t.leaseId === L.id),
      dis = E.s.disputes.filter(d => d.leaseId === L.id),
      adj = E.s.adjustments.filter(x => x.leaseId === L.id);
    const notes = E.s.notifs.filter(n => n.leaseId === L.id).slice(-8).reverse();
    return `<button class="link small" data-act="nav" data-id="leases">Back to leases</button>
    <div class="ph" style="margin-top:8px">
      <div>
        <h1>${L.id}: ${esc(c.name)}</h1>
        <div class="row">${leaseChips(L)}<span class="muted">${esc(prodName(L.terms.productId))}${L.handover ? ', IMEI ' + L.handover.imei : ''}</span></div>
      </div>
      <button class="link" data-act="openApp" data-id="${a.id}">View application ${a.ref}</button>
    </div>
    <div class="facts">
      <div><span>Total payable</span><b>${$m(L.terms.total)}</b></div>
      <div><span>Paid so far</span><b>${$m(paid)}</b></div>
      <div><span>Outstanding</span><b>${$m(out)}</b></div>
      <div><span>Credit held</span><b>${$m(cr)}</b></div>
      <div><span>Next due</span><b>${nxt ? fd(nxt.due) : 'None'}</b></div>
    </div>
    <div class="panel">
      <div class="ph"><h2>Repayment</h2><span class="muted small">Signed ${fd(L.signedOn)}${L.activationDate ? ', handed over ' + fd(L.activationDate) : ''}. Terms are fixed at price version ${L.terms.pricingVersion}.</span></div>
      ${stripHtml(L)}
      ${act.length ? `<div class="row" style="margin-top:12px">${act.join('')}</div>` : ''}
      ${L.ownership ? `<div class="note" style="margin-top:12px"><b>Ownership transferred</b> on ${fd(L.ownership.date)}. Certificate ${L.ownership.certificate}, IMEI ${L.ownership.imei}.</div>` : ''}
      ${L.ownershipPending ? '<div class="note" style="margin-top:12px">All completion checks pass. The transfer can now be recorded.</div>' : ''}
    </div>
    ${L.installments.length ? `<div class="panel flat scroll"><h2>Schedule</h2><table class="t" style="margin-top:8px"><thead><tr><th>No.</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Outstanding</th><th>Status</th></tr></thead><tbody>${L.installments.map(i => { const s = E.instState(L, i); return `<tr><td>${i.no}</td><td>${fd(i.due)}</td><td class="r">${$m(i.amount)}</td><td class="r">${$m(s.paid)}</td><td class="r">${$m(s.outstanding)}</td><td>${chip(s.status)}${s.partial && s.status !== 'Partially Paid' ? ' ' + chip('Partially Paid') : ''}${s.disputed && s.outstanding ? ' ' + chip('Disputed') : ''}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    <div class="two">
      <div class="panel flat scroll"><h2>Ledger</h2><table class="t" style="margin-top:8px"><thead><tr><th>Date</th><th>Entry</th><th class="r">Cash in</th><th>Applied to</th></tr></thead><tbody>${led.map(e => `<tr><td>${fd(e.date)}</td><td>${e.type.replace('_', ' ').toLowerCase()}${e.receipt ? `<br><span class="muted small">${e.receipt}</span>` : ''}${e.reason ? `<br><span class="muted small">${esc(e.reason)}</span>` : ''}</td><td class="r">${e.cash ? $m(e.cash) : ''}</td><td>${e.allocations.map(x => `${x.target === 'deposit' ? 'Deposit' : 'Inst. ' + x.target.split('-I')[1]} ${$m(x.amount)}`).join(', ')}${e.credit ? `<br><span class="muted small">Credit ${$m(e.credit)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing posted yet.</td></tr>'}</tbody></table></div>
      <div class="stack">
        <div class="panel flat scroll"><h2>Payments</h2><table class="t" style="margin-top:8px"><tbody>${pays.map(p => `<tr><td>${p.id}<br><span class="muted small">${p.channel}, ${p.purpose}</span></td><td class="r">${$m(p.amount)}</td><td>${chip(p.status)}</td></tr>`).join('') || '<tr><td class="empty">No payments yet.</td></tr>'}</tbody></table></div>
        ${dis.length || tasks.length || adj.length ? `<div class="panel"><h2>Follow-up</h2><ul class="plain">${dis.map(d => `<li><span>${chip(d.status === 'Open' ? 'Disputed' : 'Resolved')} ${esc(d.reason)}${d.outcome ? `<br><span class="muted small">Outcome: ${esc(d.outcome)}</span>` : ''}</span>${d.status === 'Open' && E.can('dispute.manage') ? btn('resolveDispute', 'Resolve', { sm: 1, d: { id: d.id } }) : ''}</li>`).join('')}${tasks.map(t => `<li><span>${esc(t.stage)}, installment ${t.instId.split('-I')[1]}</span>${chip(t.status)}</li>`).join('')}${adj.map(x => `<li><span>${x.type} of ${$m(x.amount)}<br><span class="muted small">${esc(x.reason)}</span></span><span>${chip(x.status)}${x.status === 'Pending approval' && E.can('adjust.approve') ? btn('adjDecide', 'Approve', { sm: 1, cls: 'primary', d: { id: x.id, ok: 1 } }) + btn('adjDecide', 'Decline', { sm: 1, d: { id: x.id, ok: 0 } }) : ''}</span></li>`).join('')}</ul></div>` : ''}
        ${notes.length ? `<div class="panel"><h2>Recent messages</h2><ul class="plain">${notes.map(n => `<li><span>${fd(n.date)}: ${n.template}</span>${chip(n.status)}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>`;
  }

  function vPayments() {
    const mc = myCust(),
      PS = E.s.payments.filter(p => !mc || p.customerId === mc);
    const pend = PS.filter(p => p.status === 'Pending' && p.channel === 'STK Push'),
      quar = PS.filter(p => p.status === 'Quarantined');
    const unm = E.s.events.filter(e => e.status === 'Unmatched' && e.kind === 'C2B'),
      retry = E.s.events.filter(e => e.status === 'Retry queued');
    const sim = E.s.sim;
    const phones = pend
      .map(
        p =>
          `<div class="phone"><p><b>M-PESA prompt on ${esc(p.phone)}</b><br>Pay ${$m(p.amount)} to Spectrum Credit Limited for ${p.purpose} ${esc(p.leaseId)}? Enter your PIN.</p><div class="row">${btn('simPay', 'Enter PIN and pay', { cls: 'primary', sm: 1, d: { id: p.id } })}${btn('simCode', 'Cancel', { sm: 1, d: { id: p.id, code: 1032 } })}${btn('simCode', 'No response', { sm: 1, d: { id: p.id, code: 1037 } })}${btn('simCode', 'Insufficient funds', { sm: 1, d: { id: p.id, code: 1 } })}${btn('simWrong', 'Pay a different amount', { sm: 1, d: { id: p.id } })}${btn('simSpoof', 'Send a forged callback', { sm: 1, d: { id: p.id } })}</div></div>`

      )
      .join('');
    const all = PS.slice().reverse().slice(0, 40),
      evs = E.s.events.slice().reverse().slice(0, 14);
    return `<h1>Payments</h1><p class="lede">An STK Push request only asks the customer to pay. Money is recorded when a verified callback arrives. The panel on the left plays the customer and Safaricom so you can try every outcome.</p>
    <div class="two"><div class="panel"><div class="ph"><h2>Customer's phone</h2></div>${phones || '<div class="empty" style="padding:6px 0">No prompts waiting. Request a deposit or installment from an application or lease.</div>'}</div>
    <div class="panel" ${mc ? 'hidden' : ''}><h2>Simulator switches</h2><div class="stack"><label class="row"><input type="checkbox" data-act="toggle" data-k="providerDown" ${sim.providerDown ? 'checked' : ''}> Safaricom is unreachable for new requests</label><label class="row"><input type="checkbox" data-act="toggle" data-k="failNextPost" ${sim.failNextPost ? 'checked' : ''}> Database fails on the next ledger posting</label><div>${btn('c2b', 'Send a paybill payment')}</div></div></div></div>
    <div class="panel" ${mc ? 'hidden' : ''}><div class="ph"><h2>Reconciliation queue</h2></div>${quar.length || unm.length || retry.length ? `<ul class="plain">${quar.map(p => `<li><span><b>${p.id}</b> ${chip('Quarantined')} received ${$m(p.receivedAmount)}, expected ${$m(p.amount)}<br><span class="muted small">${esc(p.leaseId)}, receipt ${esc(p.providerTxId)}. Not applied to the account.</span></span>${E.can('payment.reconcile') ? `<span class="row">${btn('resolveQ', 'Apply as received', { sm: 1, d: { id: p.id, k: 'apply' } })}${btn('resolveQ', 'Do not apply', { sm: 1, d: { id: p.id, k: 'reject' } })}</span>` : ''}</li>`).join('')}${unm.map(e => `<li><span><b>${e.id}</b> ${chip('Unmatched')} ${$m(e.payload.Amount)} with reference "${esc(e.payload.BillRefNumber)}"<br><span class="muted small">${esc(e.note)}</span></span>${E.can('payment.reconcile') ? btn('assign', 'Assign to a lease', { sm: 1, d: { id: e.id } }) : ''}</li>`).join('')}${retry.map(e => `<li><span><b>${e.id}</b> ${chip('Retry queued')}<br><span class="muted small">${esc(e.note)}</span></span>${E.can('payment.reconcile') ? btn('retry', 'Retry posting', { sm: 1, cls: 'primary', d: { id: e.id } }) : ''}</li>`).join('')}</ul>` : '<div class="empty" style="padding:6px 0">Nothing to reconcile.</div>'}</div>
    <div class="panel flat scroll"><h2>All payments</h2><table class="t" style="margin-top:8px"><thead><tr><th>Payment</th><th>Lease</th><th>Purpose</th><th class="r">Amount</th><th>Status</th><th>Receipt</th><th></th></tr></thead><tbody>${all.map(p => `<tr><td>${p.id}<br><span class="muted small">${p.channel}, ${fd(p.requestedAt)}</span></td><td>${p.leaseId}</td><td>${p.purpose}</td><td class="r">${$m(p.amount)}</td><td>${chip(p.status)}${p.resultDesc && p.status !== 'Success' ? `<br><span class="muted small">${esc(p.resultDesc)}</span>` : ''}</td><td>${esc(p.providerTxId || '')}</td><td>${p.status === 'Success' ? (p.channel === 'STK Push' ? btn('replay', 'Replay callback', { sm: 1, d: { id: p.id } }) : '') + (E.can('payment.reconcile') ? btn('reverse', 'Reverse', { sm: 1, d: { id: p.id } }) : '') : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No payments yet.</td></tr>'}</tbody></table></div>
    <div class="panel flat scroll" ${mc ? 'hidden' : ''}><h2>Provider events</h2><table class="t" style="margin-top:8px"><thead><tr><th>Event</th><th>Type</th><th>Outcome</th><th>What happened</th></tr></thead><tbody>${evs.map(e => `<tr><td>${e.id}<br><span class="muted small">${fd(e.date)}</span></td><td>${e.kind === 'STK' ? 'STK callback' : 'Paybill notice'}</td><td>${chip(e.status)}</td><td>${esc(e.note)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No events yet.</td></tr>'}</tbody></table></div>`;
  }

  function vCollections() {
    const tasks = E.s.tasks.slice().reverse(),
      dis = E.s.disputes.slice().reverse(),
      nt = E.s.notifs.slice().reverse().slice(0, 25);
    return `<h1>Collections</h1><p class="lede">Reminders go out before and after each due date. An installment turns overdue only after its grace period, and then one follow-up task is created. Officers record contact; they cannot add penalties or change terms.</p>
    <div class="panel flat scroll"><h2>Follow-up tasks</h2><table class="t" style="margin-top:8px"><thead><tr><th>Task</th><th>Customer</th><th class="r">Owed on installment</th><th>Status</th><th>Last contact</th><th></th></tr></thead><tbody>${tasks.map(t => { const L = E.lease(t.leaseId), i = L.installments.find(x => x.id === t.instId), lc = t.contacts[t.contacts.length - 1]; return `<tr><td><b>${esc(t.stage)}</b><br><span class="muted small">${t.id}, opened ${fd(t.createdAt)}</span></td><td><button class="link" data-act="openLease" data-id="${L.id}">${esc(custName(L.customerId))}</button><br><span class="muted small">${L.id}, installment ${i.no}</span></td><td class="r">${$m(E.instOutstanding(L, i))}</td><td>${chip(t.status)}${t.promiseDate ? `<br><span class="muted small">Promised ${fd(t.promiseDate)}</span>` : ''}${t.resolvedNote ? `<br><span class="muted small">${esc(t.resolvedNote)}</span>` : ''}</td><td>${lc ? `${fd(lc.date)}, ${esc(lc.outcome)}` : '<span class="muted">None yet</span>'}</td><td>${t.status !== 'Resolved' && E.can('collections.record') ? btn('contact', 'Log contact', { sm: 1, d: { id: t.id } }) : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No follow-up tasks. Advance the date to see reminders and overdue tasks appear.</td></tr>'}</tbody></table></div>
    <div class="two"><div class="panel flat scroll"><h2>Disputes</h2><table class="t" style="margin-top:8px"><tbody>${dis.map(d => `<tr><td>${chip(d.status === 'Open' ? 'Disputed' : 'Resolved')}</td><td>${esc(d.reason)}<br><span class="muted small">${d.leaseId}, opened ${fd(d.openedAt)}${d.outcome ? ', outcome: ' + esc(d.outcome) : ''}</span></td><td>${d.status === 'Open' && E.can('dispute.manage') ? btn('resolveDispute', 'Resolve', { sm: 1, d: { id: d.id } }) : ''}</td></tr>`).join('') || '<tr><td class="empty">No disputes.</td></tr>'}</tbody></table></div>
    <div class="panel flat scroll"><h2>Message log</h2><table class="t" style="margin-top:8px"><tbody>${nt.map(n => `<tr><td>${fd(n.date)}<br><span class="muted small">${n.leaseId}</span></td><td>${n.template}${n.reason ? `<br><span class="muted small">${esc(n.reason)}</span>` : ''}</td><td>${chip(n.status)}</td></tr>`).join('') || '<tr><td class="empty">No messages yet.</td></tr>'}</tbody></table></div></div>`;
  }

  function vCatalogue() {
    const S = E.s.settings;
    return `<div class="ph"><div><h1>Catalogue</h1><p class="lede" style="margin:0">Fixed lease prices per phone and duration. Editing a price creates a new version; agreements already signed keep the version they accepted.</p></div><div class="row">${btn('newProduct', 'Add phone', { off: !E.can('pricing.manage') })}${btn('newPricing', 'Add price', { cls: 'primary', off: !E.can('pricing.manage') })}</div></div>
    ${E.s.products.map(p => {
      const pr = E.s.pricings.filter(x => x.productId === p.id).sort((a, b) => a.months - b.months || b.version - a.version);
      return `<div class="panel flat scroll"><div class="ph"><h2>${esc(p.brand)} ${esc(p.model)} ${esc(p.storage)}</h2><span class="muted small">${p.code}, cash price ${$m(p.cashPrice)}, ${p.condition}</span></div><table class="t" style="margin-top:8px"><thead><tr><th>Term</th><th>Version</th><th class="r">Total</th><th class="r">Deposit</th><th class="r">Installment</th><th>Grace</th><th>Status</th><th></th></tr></thead><tbody>${pr.map(x => {
        const dep = E.depositOf(x), sc = buildSchedule(x.total, dep, x.months), bad = E.validatePricing(x);
        return `<tr><td>${x.months} months</td><td>v${x.version}</td><td class="r">${$m(x.total)}</td><td class="r">${$m(dep)}${x.depositType === 'percent' ? `<br><span class="muted small">${x.depositValue}%</span>` : ''}</td><td class="r">${sc.length ? $m(sc[0]) + (sc[sc.length - 1] !== sc[0] ? `<br><span class="muted small">last ${$m(sc[sc.length - 1])}</span>` : '') : '<span class="muted">Invalid</span>'}</td><td>${x.graceDays} days</td><td>${chip(x.status)}${x.status === 'Active' && !E.pricingAvailable(x) ? '<br><span class="muted small">Not yet effective</span>' : ''}${bad.length && x.status === 'Draft' ? `<br><span class="small" style="color:var(--bad)">${esc(bad[0])}</span>` : ''}</td><td class="nowrap">${x.status !== 'Active' && E.can('pricing.activate') ? btn('activatePrice', 'Activate', { sm: 1, cls: 'primary', d: { id: x.id } }) : ''}${E.can('pricing.manage') ? btn('revisePrice', 'New version', { sm: 1, d: { id: x.id } }) : ''}${x.status === 'Active' && E.can('pricing.activate') ? btn('deactivatePrice', 'Deactivate', { sm: 1, d: { id: x.id } }) : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="8" class="empty">No prices yet.</td></tr>'}</tbody></table></div>`;
    }).join('')}
    <div class="panel"><div class="ph"><h2>Policy</h2>${btn('settings', 'Edit policy', { sm: 1, off: !E.can('settings') })}</div><dl class="kv"><dt>Permitted durations</dt><dd>${S.durations.join(', ')} months</dd><dt>Default grace period</dt><dd>${S.graceDays} calendar days after the due date</dd><dt>Reminder days</dt><dd>${S.reminderOffsets.map(x => x < 0 ? `${-x} before` : x === 0 ? 'on the day' : `${x} after`).join(', ')}</dd><dt>Reservation holds for</dt><dd>${S.reservationDays} days after approval</dd><dt>Approval limits</dt><dd>Approver up to ${$m(S.approverLimit)}, Senior Approver up to ${$m(S.seniorLimit)}, above that Super Admin</dd><dt>Credit rules</dt><dd>Installment up to ${S.affordability}% of income, debt service up to ${S.maxDsr}%, minimum income ${$m(S.minIncome)}, exposure up to ${$m(S.exposureLimit)} per customer</dd><dt>Ownership transfer</dt><dd>${S.autoOwnership ? 'The system transfers it once every check passes' : 'Finance completes it by hand'}</dd><dt>Agreement wording</dt><dd>${esc(S.company)}, Paybill ${esc(S.paybill)} ${btn('clauses', 'Edit wording', { sm: 1, off: !E.can('settings') })}</dd><dt>Overpayments</dt><dd>Held as customer credit, applied when the next installment falls due, or refunded with approval</dd></dl></div>`;
  }

  function vInventory() {
    const statuses = ['All', ...new Set(E.s.devices.map(d => d.status))];
    const query = ui.inventoryQuery.trim().toLowerCase();
    const dv = E.s.devices.filter(d => {
      const a = d.applicationId && E.app(d.applicationId),
        L = E.s.leases.find(l => l.deviceId === d.id),
        heldBy = L ? custName(L.customerId) : a ? a.ref : '';
      return (ui.inventoryFilter === 'All' || d.status === ui.inventoryFilter) &&
        (!query || [d.imei, prodName(d.productId), d.condition, d.status, heldBy].some(value => String(value || '').toLowerCase().includes(query)));
    });
    return `<div class="ph"><div><h1>Inventory</h1><p class="lede" style="margin:0">Every handset is tracked by IMEI. A phone is Customer-Owned only after the lease completes.</p></div>${btn('newDevice', 'Register phone', { cls: 'primary', off: !E.can('device.manage') })}</div>
    <div class="row" style="margin:14px 0;gap:10px;flex-wrap:wrap"><input id="inventorySearch" type="search" value="${esc(ui.inventoryQuery)}" placeholder="Search IMEI, model, condition or status" aria-label="Search inventory" style="width:min(100%,360px)">${btn('inventorySearch', 'Search', { cls: 'primary' })}<label class="muted small">Filter by status <select data-act="inventoryFilter" style="width:auto;margin-left:6px">${statuses.map(status => `<option ${status === ui.inventoryFilter ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></label></div>
    <div class="panel flat scroll"><table class="t"><thead><tr><th>IMEI</th><th>Model</th><th>Condition</th><th>Status</th><th>Held by</th><th></th></tr></thead><tbody>${dv.map(d => {
      const a = d.applicationId && E.app(d.applicationId);
      const L = E.s.leases.find(l => l.deviceId === d.id);
      return `<tr><td><b>${d.imei}</b></td><td>${esc(prodName(d.productId))}</td><td>${d.condition}</td><td>${chip(d.status)}</td><td>${L ? `<button class="link" data-act="openLease" data-id="${L.id}">${esc(custName(L.customerId))}</button>` : a ? `<button class="link" data-act="openApp" data-id="${a.id}">${a.ref}</button>` : ''}</td><td>${E.can('device.manage') && d.status === 'In Stock' ? btn('quarantine', 'Quarantine', { sm: 1, d: { id: d.id, on: 1 } }) : ''}${E.can('device.manage') && d.status === 'Quarantined' ? btn('quarantine', 'Release', { sm: 1, d: { id: d.id, on: 0 } }) : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No inventory matches your search and filter.</td></tr>'}</tbody></table></div>`;
  }

  function vStaff() {
    if (E.role === 'Senior Approver' && E.can('staff.changes.approve')) {
      return `<div class="ph"><div><h1>Staff management</h1><p class="lede" style="margin:0">Review staff change requests. The maker cannot approve their own request.</p></div></div>${makerCheckerPanel()}`;
    }
    if (E.role !== 'Super Admin') {
      return `<h1>Staff management</h1><div class="note warn">Only a Super Admin can manage staff. Switch role at the top to continue.</div>`;
    }
    const staff = E.s.staff.slice().sort((a, b) => a.name.localeCompare(b.name));
    const staffById = id => E.s.staff.find(person => person.id === id);
    const assignments = E.s.staffAssignments || [];
    return `<div class="ph"><div><h1>Staff management</h1><p class="lede" style="margin:0">Manage staff names, roles and active status. Changes are recorded in the audit log.</p></div>${btn('staffAdd', 'Add staff member', { cls: 'primary' })}</div>
    <div class="panel flat scroll"><div class="ph"><div><h2>Position assignments</h2><p class="muted small" style="margin:4px 0 0">Manage employee allocation, assigned positions and branch placement.</p></div>${btn('staffAssignment', 'New assignment', { cls: 'primary', d: { mode: 'new' } })}</div><table class="t"><thead><tr><th>User / Staff member</th><th>Assigned position</th><th>Organization</th><th>Department</th><th>Role type</th><th>Status</th><th>Actions</th></tr></thead><tbody>${assignments.map(assignment => { const person = staffById(assignment.staffId); return person ? `<tr><td><b>${esc(person.name)}</b>${person.email ? `<br><span class="muted small">${esc(person.email)}</span>` : ''}</td><td>${esc(assignment.position)}</td><td>${esc(assignment.organization)}</td><td>${esc(assignment.department)}</td><td>${chip(assignment.roleType)}</td><td>${chip(assignment.status)}</td><td class="nowrap">${btn('staffAssignmentView', 'View', { sm: 1, d: { id: assignment.id } })}${btn('staffAssignment', 'Edit', { sm: 1, d: { id: assignment.id, mode: 'edit' } })}</td></tr>` : ''; }).join('') || '<tr><td colspan="7" class="empty">No position assignments yet.</td></tr>'}</tbody></table></div>${staffPositionsPanel()}
    <div class="ph" style="margin-top:20px"><div><h2>Staff directory</h2><p class="muted small" style="margin:4px 0 0">Manage staff names, roles and active status.</p></div></div>
    <div class="panel flat scroll"><table class="t"><thead><tr><th>Name</th><th>System role</th><th>Position</th><th>Branch</th><th>Email</th><th>Phone</th><th>Gender</th><th>Status</th><th></th></tr></thead><tbody>${staff.map(person => {
      const primary = assignments.find(item => item.staffId === person.id && item.roleType === 'Primary');
      return `<tr><td><b>${esc(person.name)}</b></td><td>${esc(person.role)}</td><td>${esc(primary?.position || '—')}</td><td>${esc(primary?.organization || '—')}</td><td>${person.email ? esc(person.email) : '<span class="muted">—</span>'}</td><td>${person.phone ? esc(person.phone) : '<span class="muted">—</span>'}</td><td>${person.gender ? esc(person.gender) : '<span class="muted">—</span>'}</td><td>${chip(person.status)}</td><td class="nowrap">${person.status !== 'Deleted' ? btn('staffEdit', 'Edit', { sm: 1, d: { id: person.id } }) + btn('staffToggle', person.status === 'Active' ? 'Deactivate' : 'Activate', { sm: 1, d: { id: person.id } }) + btn('staffDelete', 'Request deletion', { sm: 1, d: { id: person.id } }) : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">No staff members yet.</td></tr>'}</tbody></table></div>${makerCheckerPanel()}${systemRolesPanel()}`;
  }

  function vAudit() {
    if (E.role !== 'Super Admin') {
      return `<h1>Audit log</h1><div class="note warn">Only a Super Admin can view the audit log.</div>`;
    }
    const rows = E.s.audit.slice().reverse().filter(a => !ui.secOnly || ['SECURITY', 'WARN'].includes(a.kind)).slice(0, 150);
    return `<div class="ph"><div><h1>Audit log</h1><p class="lede" style="margin:0">Append-only record of who did what and when. Showing the latest ${rows.length}.</p></div><label class="row"><input type="checkbox" data-act="secOnly" ${ui.secOnly ? 'checked' : ''}> Security and warnings only</label></div>
    <div class="panel flat scroll"><table class="t"><thead><tr><th>Business date</th><th>Actor</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>${rows.map(a => `<tr><td class="nowrap">${fd(a.date)}</td><td>${esc(a.actor)}</td><td>${a.kind === 'SECURITY' ? chip('Rejected') : a.kind === 'WARN' ? chip('Pending') : ''} ${esc(a.action)}</td><td>${esc(a.entity)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- Action Handlers ---------- */
  const H = {
    signOut() {
      sessionStorage.removeItem(AUTH_KEY);
      ui.loginMethod = 'password';
      ui.loginPhone = '';
      render();
    },
    async viewCustomerAttachment(el) {
      try {
        const record = await getCustomerAttachment(el.dataset.key);
        if (!record) return toast('This attachment is no longer available in local storage.', 'bad');
        const url = URL.createObjectURL(record.blob);
        const isPdf = record.type === 'application/pdf' || record.name.toLowerCase().endsWith('.pdf');
        const viewer = document.createElement('dialog');
        viewer.className = 'attachment-viewer';
        const form = document.createElement('form');
        form.method = 'dialog';
        const heading = document.createElement('div');
        heading.className = 'attachment-viewer-heading';
        const title = document.createElement('h2');
        title.textContent = el.dataset.name || record.name;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn';
        close.textContent = 'Close';
        close.onclick = () => viewer.close();
        heading.append(title, close);
        const body = document.createElement('div');
        body.className = 'attachment-viewer-body';
        if (isPdf) {
          const pdf = document.createElement('object');
          pdf.data = url;
          pdf.type = 'application/pdf';
          pdf.setAttribute('aria-label', `PDF attachment ${record.name}`);
          const fallback = document.createElement('p');
          fallback.textContent = 'Inline PDF viewing is not supported here. Download the file to open it.';
          pdf.append(fallback);
          body.append(pdf);
        } else {
          const image = document.createElement('img');
          image.src = url;
          image.alt = `Attachment ${record.name}`;
          body.append(image);
        }
        const download = document.createElement('a');
        download.className = 'btn primary';
        download.href = url;
        download.download = record.name;
        download.textContent = `Download ${record.name}`;
        body.append(download);
        form.append(heading, body);
        viewer.append(form);
        viewer.addEventListener('close', () => {
          URL.revokeObjectURL(url);
          viewer.remove();
        }, { once: true });
        document.body.append(viewer);
        viewer.showModal();
      } catch (error) {
        toast(`Could not open the attachment: ${error.message}`, 'bad');
      }
    },
    staffPositionAdd() {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage positions.', 'bad');
      const input = $('#staffPositionInput');
      const name = input?.value.trim();
      if (!name) return toast('Enter a position name.', 'bad');
      if (REMOVED_STAFF_POSITIONS.has(name.toLowerCase())) return toast('That position is no longer available.', 'bad');
      if (ROLES.some(role => role.toLowerCase() === name.toLowerCase()) || E.s.staffPositions.some(position => position.name.toLowerCase() === name.toLowerCase())) return toast('That position already exists.', 'bad');
      E.s.staffPositions.push({ id: E.id('POS'), name, department: 'Operations', description: '', createdBy: E.role, createdAt: E.s.date });
      E.log('STAFF', 'position catalog', `Added position ${name}`, 'WARN');
      save();
      render();
      toast(`${name} added to the position catalog.`);
    },
    staffPositionRemove(el) {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage positions.', 'bad');
      const position = E.s.staffPositions.find(item => item.id === el.dataset.id);
      if (!position) return toast('Position not found.', 'bad');
      const assigned = E.s.staffAssignments.some(item => item.position === position.name) || E.s.staffChangeRequests.some(request => request.status === 'Pending approval' && request.kind.startsWith('assignment.') && request.payload.position === position.name);
      if (assigned) return toast('This position is assigned to staff or has an assignment awaiting approval. Remove or update those assignments first.', 'bad');
      E.s.staffPositions = E.s.staffPositions.filter(item => item.id !== position.id);
      E.log('STAFF', 'position catalog', `Removed position ${position.name}`, 'WARN');
      save();
      render();
      toast(`${position.name} removed from the position catalog.`);
    },
    nav(el) {
      ui.view = el.dataset.id;
      ui.appId = ui.leaseId = null;
      render();
      window.scrollTo(0, 0);
    },
    role(el) {
      E.role = el.value;
      if (E.role === 'Customer') {
        myCust();
        if (!CUSTOMER_VIEWS.includes(ui.view)) ui.view = 'overview';
      }
      ui.appId = ui.leaseId = null;
      if (['app', 'lease'].includes(ui.view)) ui.view = 'overview';
      render();
    },
    theme(el) {
      applyTheme(el.dataset.theme, true);
    },
    pickDev(el) {
      ui.devId = el.value;
      render();
    },
    receipt(el) {
      const p = E.pay(el.dataset.id),
        L = E.lease(p.leaseId),
        c = E.cust(p.customerId),
        ents = E.entries(L),
        k = ents.findIndex(x => x.id === p.ledgerId),
        en = ents[k];
      const after = L.terms.total - ents.slice(0, k + 1).reduce((s, e) => s + e.allocations.reduce((a, x) => a + x.amount, 0), 0);
      const d = $('#dlg');
      d.innerHTML = `<form method="dialog"><h2>Payment receipt</h2><p class="muted small">${esc(E.s.settings.company)}</p><dl class="kv"><dt>Receipt number</dt><dd><b>${esc(p.providerTxId)}</b></dd><dt>Date</dt><dd>${fd(p.confirmedAt)}</dd><dt>Received from</dt><dd>${esc(c.name)}, ${esc(p.phone)}</dd><dt>Lease</dt><dd>${L.id}, ${esc(prodName(L.terms.productId))}</dd><dt>Amount</dt><dd><b>${$m(p.amount)}</b> by ${p.channel}</dd><dt>Applied to</dt><dd>${en ? en.allocations.map(x => (x.target === 'deposit' ? 'Deposit' : 'Installment ' + x.target.split('-I')[1]) + ' ' + $m(x.amount)).join(', ') + (en.credit ? `, credit ${$m(en.credit)}` : '') : 'n/a'}</dd><dt>Balance after</dt><dd>${$m(after)}</dd></dl><div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" class="btn" id="fclose">Close</button></div></form>`;
      d.querySelector('#fclose').onclick = () => d.close();
      d.showModal();
    },
    adv(el) {
      if ($('#dlg').open) $('#dlg').close();
      run(() => E.advanceDays(+el.dataset.n), `Moved on ${el.dataset.n} day${el.dataset.n > 1 ? 's' : ''}. Reminders and overdue checks ran for each day.`);
    },
    reset() {
      if ($('#dlg').open) $('#dlg').close();
      if (!confirm('Clear all application data? This cannot be undone.')) return;
      try {
        localStorage.removeItem(KEY);
      } catch (e) {}
      const r = E.role;
      E = new Engine(Engine.blank());
      E.role = r;
      ensureStaffRecords();
      ensureSystemConfig();
      syncStaffPools();
      save();
      ui.view = 'overview';
      render();
      toast('All application data cleared.');
    },
    dateMenu() {
      const d = $('#dlg');
      d.innerHTML = `<form method="dialog"><h2>Business date</h2><p class="muted small">This demo runs on a simulated calendar. Moving it forward runs daily jobs for every day passed: reminders, grace periods, overdue flags, collections tasks and reservation expiry.</p><p style="font-size:18px;margin:14px 0"><b>${fdl(E.s.date)}</b></p><div class="row">${btn('adv', '+1 day', { d: { n: 1 } })}${btn('adv', '+7 days', { d: { n: 7 } })}${btn('adv', '+30 days', { cls: 'primary', d: { n: 30 } })}</div><div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" class="btn" id="fclose">Close</button></div></form>`;
      d.querySelector('#fclose').onclick = () => d.close();
      d.showModal();
    },
    appFilter(el) {
      ui.appFilter = el.value;
      render();
    },
    inventorySearch() {
      ui.inventoryQuery = ($('#inventorySearch') || {}).value || '';
      render();
    },
    inventoryFilter(el) {
      ui.inventoryFilter = el.value;
      render();
    },
    secOnly(el) {
      ui.secOnly = el.checked;
      render();
    },
    openApp(el) {
      ui.view = 'app';
      ui.appId = el.dataset.id;
      render();
      window.scrollTo(0, 0);
    },
    openLease(el) {
      ui.view = 'lease';
      ui.leaseId = el.dataset.id;
      render();
      window.scrollTo(0, 0);
    },
    newCust() {
      const registeringAgent = E.s.staff.find(person => person.role === E.role && person.status === 'Active')?.name || E.role;
      const privacyNotice = 'Spectrum Credit Limited collects your name, identity document, mobile number, date of birth, address, county, alternative contact and employment details to assess your application, verify your identity, service your lease and collect payments. We share them only with identity and credit verification providers, M-PESA, and regulators where the law requires. You may ask to see or correct your data, and to withdraw marketing consent at any time. Data needed to service a lease is kept while the lease is active and for the period the law requires after it ends.';
      openForm({
        title: 'Register customer',
        intro: 'Registering on behalf of a customer. Their consent is recorded with this registration.',
        submit: 'Register',
        grid: true,
        registerForm: true,
        fields: [
          { n: 'identitySection', l: 'Identity', t: 'section' },
          { n: 'name', l: 'Full legal name', p: 'As it appears on the identity document' },
          { n: 'idType', l: 'Identity document', t: 'select', o: [['National ID', 'National ID'], ['Passport', 'Passport'], ['Alien ID', 'Alien ID'], ['Military ID', 'Military ID']], v: 'National ID' },
          { n: 'idNo', l: 'Document number', p: 'Enter the document number', h: 'National ID: 7 or 8 digits.' },
          { n: 'dob', l: 'Date of birth', t: 'date', h: 'Required for eligibility.' },

          { n: 'contactSection', l: 'Contact and address', t: 'section' },
          { n: 'phone', l: 'Primary mobile number', t: 'tel', p: '+254 700 000 000', h: 'This number receives the M-PESA payment prompts.' },
          { n: 'address', l: 'Residential address', t: 'textarea', p: 'Required' },
          { n: 'county', l: 'County', t: 'select', o: [['', 'Choose a county'], ...COUNTIES.map(county => [county, county])] },

          { n: 'alternativeSection', l: 'Alternative contact (optional — provide only when justified)', t: 'section' },
          { n: 'alternativeHelp', l: 'Add one only when there is a reason, such as a customer who is hard to reach. A reason is required when an alternative contact is provided.', t: 'notice' },
          { n: 'altName', l: 'Name', p: 'Alternative contact name' },
          { n: 'altRelationship', l: 'Relationship', t: 'select', o: [['', 'Choose relationship'], ['Spouse', 'Spouse'], ['Parent', 'Parent'], ['Sibling', 'Sibling'], ['Employer', 'Employer'], ['Friend', 'Friend'], ['Other', 'Other']] },
          { n: 'altPhone', l: 'Mobile number', t: 'tel', p: '+254 700 000 000' },
          { n: 'altEmail', l: 'Email (optional)', t: 'email' },
          { n: 'altReason', l: 'Why is an alternative contact needed?', t: 'select', o: [['', 'Choose a reason'], ['Often unreachable', 'Customer is often unreachable on the primary number'], ['No fixed address', 'Customer has no fixed address'], ['Next of kin policy', 'Next of kin required by policy'], ['Other', 'Other (explain in the note)']] },
          { n: 'altNote', l: 'Note (required for Other)', t: 'textarea', p: 'Explain why the alternative contact is needed' },

          { n: 'employmentSection', l: 'Employment or business', t: 'section' },
          { n: 'employmentType', l: 'How the customer earns a living', t: 'select', o: [['', 'Choose'], ['Salaried employee', 'Salaried employee'], ['Self-employed or business owner', 'Self-employed or business owner'], ['Casual work or mobile-money income', 'Casual work or mobile-money income']] },
          { n: 'employer', l: 'Employer or business name' },
          { n: 'position', l: 'Position or role' },
          { n: 'months', l: 'Months in this work', t: 'number', p: '0', step: '1' },
          { n: 'workLocation', l: 'Workplace location', t: 'textarea' },

          { n: 'kycSection', l: 'Identity verification (KYC)', t: 'section' },
          { n: 'kycHelp', l: 'Identity front and back (or passport photo page) and a customer photo are required. JPG, PNG or PDF, up to 5 MB each.', t: 'notice' },
          { n: 'idFront', l: 'Identity document, front', t: 'file' },
          { n: 'idBack', l: 'Identity document, back (not needed for a passport)', t: 'file' },
          { n: 'customerPhoto', l: 'Customer photo (selfie)', t: 'file', accept: '.jpg,.jpeg,.png' },
          { n: 'proofAddress', l: 'Proof of address (optional)', t: 'file' },
          { n: 'originalSeen', l: 'I have seen the original identity document and it matches the customer.', t: 'checkbox' },
          { n: 'autoKyc', l: 'Run the automated identity check as soon as the customer is registered.', t: 'checkbox', v: true },
          { n: 'kycNote', l: 'KYC note (optional)', t: 'textarea', p: 'For example, how the document was checked.' },

          { n: 'consentSection', l: 'Consent and privacy notice', t: 'section' },
          { n: 'privacyNotice', l: 'Privacy notice, version 1.0\n\n' + privacyNotice, t: 'notice' },
          { n: 'privacyConsent', l: 'The customer has read and accepts the privacy notice, version 1.0.', t: 'checkbox' },
          { n: 'creditConsent', l: 'The customer agrees to identity verification and credit checks.', t: 'checkbox' },
          { n: 'marketingConsent', l: 'The customer agrees to receive offers by SMS (optional).', t: 'checkbox' }
        ],
        onSubmit: async v => {
          const files = { idFront: v.idFront, idBack: v.idBack, photo: v.customerPhoto, proofAddress: v.proofAddress };
          for (const file of Object.values(files).filter(Boolean)) {
            if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than the 5 MB limit.`);
            if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) throw new Error(`${file.name} must be a JPG, PNG or PDF file.`);
          }
          if (v.customerPhoto && !/\.(jpe?g|png)$/i.test(v.customerPhoto.name)) throw new Error('The customer photo must be a JPG or PNG file.');
          if (!v.originalSeen) throw new Error('Confirm that you have seen and matched the original identity document.');
          const storedKeys = [], fileKeys = {};
          let customer;
          try {
            for (const [slot, file] of Object.entries(files)) {
              if (!file) continue;
              const key = `customer-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              await saveCustomerAttachment(key, file);
              storedKeys.push(key);
              fileKeys[slot] = key;
            }
            const meta = (file, slot) => file ? { name: file.name, sizeKB: Math.ceil(file.size / 1024), type: file.type || '', storageKey: fileKeys[slot] } : null;
            customer = E.registerCustomer({
              name: v.name, idType: v.idType, idNo: v.idNo.trim(), phone: v.phone, dob: v.dob,
              address: v.address, county: v.county,
              alternativeContact: { name: v.altName, relationship: v.altRelationship, phone: v.altPhone, email: v.altEmail, reason: v.altReason, note: v.altNote },
              employment: { type: v.employmentType, name: v.employer.trim(), position: v.position.trim(), months: v.months, location: v.workLocation.trim() },
              registeringAgent,
              kyc: { idFront: meta(v.idFront, 'idFront'), idBack: meta(v.idBack, 'idBack'), photo: meta(v.customerPhoto, 'photo'), proofAddress: meta(v.proofAddress, 'proofAddress'), originalSeen: v.originalSeen, note: v.kycNote.trim() },
              consent: { privacy: v.privacyConsent, creditCheck: v.creditConsent, marketingSms: v.marketingConsent }
            });
          } catch (error) {
            await Promise.all(storedKeys.map(key => deleteCustomerAttachment(key).catch(() => {})));
            throw error;
          }
          let kycPassed = null;
          let kycUnavailable = false;
          if (v.autoKyc) {
            try {
              kycPassed = E.as('KYC Service', () => E.verifyCustomerKyc(customer.id));
            } catch (error) {
              // Customer registration is already complete. Keep it successful and leave KYC pending for review.
              kycUnavailable = true;
              console.warn('Customer registered; automated KYC could not run.', error);
            }
          }
          ui.customerForApplication = customer.id;
          return `Customer registered${kycPassed === null ? (kycUnavailable ? '; automated identity checks could not run, so the profile remains pending review.' : '.') : kycPassed ? ' and automated identity checks passed.' : '; automated identity checks flagged the profile for manual review.'}`;
        }
      });
    },
    newApp() {
      if (!E.can('app.create')) return toast('Switch to Sales Agent or Customer to start an application.', 'bad');
      const cu = E.s.customers.filter(c => !myCust() || c.id === myCust());
      const pr = E.s.pricings.filter(p => E.pricingAvailable(p));
      const selectedCustomer = cu.some(customer => customer.id === ui.customerForApplication) ? ui.customerForApplication : cu[0]?.id;
      ui.customerForApplication = null;
      openForm({
        title: 'New application',
        submit: 'Start application',
        fields: [
          { n: 'c', l: 'Customer', t: 'select', o: cu.map(c => [c.id, `${c.name} (${c.phone})`]), v: selectedCustomer },
          ...(E.role === 'Sales Agent' ? [{ n: 'ag', l: 'Agent', t: 'select', o: E.s.settings.agents.map(x => [x, x]), v: E.s.settings.agents.includes(ui.agent) ? ui.agent : E.s.settings.agents[0] }] : []),
          { n: 'p', l: 'Phone and term', t: 'select', o: pr.map(p => [p.id, `${prodName(p.productId)}, ${p.months} months, ${$m(p.total)} total`]) }
        ],
        onSubmit: v => {
          const a = E.createApplication({ customerId: v.c, pricingId: v.p, agent: v.ag });
          ui.view = 'app';
          ui.appId = a.id;
          return 'Application started.';
        }
      });
    },
    submitApp() {
      run(() => E.submitApplication(ui.appId), 'Submitted to the Credit/Risk Officer.');
    },
    kyc() {
      openForm({
        title: 'Verify identity',
        fields: [
          { n: 'r', l: 'Result', t: 'select', o: [['Verified', 'Identity verified'], ['Failed', 'Identity check failed']] },
          { n: 'n', l: 'Note', t: 'textarea' }
        ],
        onSubmit: v => {
          E.verifyKyc(ui.appId, v.r, v.n);
          return 'KYC recorded.';
        }
      });
    },
    kycService() {
      run(() => E.runKycService(ui.appId), 'Verification service result recorded.');
    },
    claim() {
      run(() => E.claimReview(ui.appId), 'You picked up this review.');
    },
    review() {
      const r = E.app(ui.appId).review || {};
      openForm({
        title: 'Confirm documents and lease terms',
        intro: 'Approval stays blocked until both are confirmed.',
        fields: [
          { n: 'd', l: 'I checked the documents. They are legible, look genuine and match the application.', t: 'checkbox', v: r.documents },
          { n: 't', l: 'I checked the lease terms. Price, deposit, schedule and duration match the approved catalogue.', t: 'checkbox', v: r.terms },
          { n: 'n', l: 'Note', t: 'textarea', v: r.note || '' }
        ],
        onSubmit: v => {
          E.verifyReview(ui.appId, { documents: v.d, terms: v.t, note: v.n });
          return 'Review recorded.';
        }
      });
    },
    assess() {
      const a = E.app(ui.appId), I = (a.assessment && a.assessment.inputs) || {};
      const k = x => (x ? x / 100 : '');
      openForm({
        title: 'Credit assessment',
        intro: `Identity, affordability, repayment capacity, history with us, fraud indicators and risk limits are checked together. Policy limit for the installment is ${E.s.settings.affordability}% of income.`,
        fields: [
          { n: 's', l: 'Income source', t: 'select', o: [['Salaried', 'Salaried'], ['Business', 'Self-employed or business (uses cash flow)'], ['Casual', 'Casual or mobile-money income (counted at 80%)']], v: I.source || 'Salaried' },
          { n: 'i', l: 'Declared monthly income (KES)', t: 'number', v: k(I.income) },
          { n: 'f', l: 'Average monthly net cash flow (KES)', t: 'number', v: k(I.cashflow), h: 'Required for business income. Take it from statements.' },
          { n: 'o', l: 'Existing monthly obligations (KES)', t: 'number', v: k(I.obligations) || 0, h: 'Loans, other leases and regular commitments.' },
          { n: 'x', l: 'I suspect fraud on this application', t: 'checkbox', v: I.fraudSuspected },
          { n: 'n', l: 'Reviewer notes', t: 'textarea', v: I.notes || '' }
        ],
        onSubmit: v => {
          const r = E.assess(ui.appId, { income: KES(+v.i || 0), source: v.s, cashflow: KES(+v.f || 0), obligations: KES(+v.o || 0), fraudSuspected: v.x, notes: v.n });
          return `Score ${r.score}, ${r.band}. Advisory: ${r.recommendation}.`;
        }
      });
    },
    decide(el) {
      const k = el.dataset.k, a = E.app(ui.appId);
      const T = {
        approve: ['Approve application', 'Approval note', 'Approve'],
        reject: ['Reject application', 'Explain the rejection in a sentence', 'Reject'],
        info: ['Ask for more information', 'What is needed?', 'Send request'],
        hold: ['Put application on hold', 'Why is it on hold?', 'Put on hold']
      }[k];
      let intro = '';
      if (E.can('risk.view') && a.assessment) {
        intro = `Advisory score ${a.assessment.score} (${a.assessment.band}): ${a.assessment.recommendation}. The decision is yours and follows company policy.`;
        if (k === 'approve' && a.assessment.recommendation !== 'Approve') {
          intro += ' A written reason is required to approve against the advice.';
        }
      }
      openForm({
        title: T[0],
        intro,
        submit: T[2],
        fields: [...(k === 'approve' ? [] : [{ n: 'c', l: 'Reason code', t: 'select', o: REASON_CODES[k] }]), { n: 'r', l: T[1], t: 'textarea' }],
        onSubmit: v => {
          E.decide(ui.appId, k, v.r, v.c);
          return k === 'approve'
            ? 'Approved. The agreement is generated and a phone can be reserved. Handover still needs signatures and the deposit.'
            : 'Decision recorded.';
        }
      });
    },
    escalate() {
      const a = E.app(ui.appId);
      reasonForm('Escalate to a senior approver', 'Why is it being escalated?', 'Escalate', r => {
        E.escalate(ui.appId, r);
        return 'Escalated.';
      }, `Decision level needed by lease total: ${E.requiredApprover(a)}.`);
    },
    resume() {
      reasonForm('Resume review', 'Why is the hold lifted?', 'Resume', r => {
        E.resumeHold(ui.appId, r);
        return 'Review resumed.';
      });
    },
    reopen() {
      reasonForm('Reopen application', 'Why is it being reopened?', 'Reopen', r => {
        E.reopen(ui.appId, r);
        return 'Reopened for review. History is kept.';
      }, 'A reopened application returns to review. It cannot jump straight to an agreement.');
    },
    changeTerms() {
      const a = E.app(ui.appId);
      openForm({
        title: 'Change terms',
        intro: 'Changing a material term voids the agreement and sends the application back for approval.',
        fields: [
          {
            n: 'p',
            l: 'New phone and term',
            t: 'select',
            o: E.s.pricings.filter(p => E.pricingAvailable(p)).map(p => [p.id, `${prodName(p.productId)}, ${p.months} months, ${$m(p.total)}`]),
            v: a.pricingId
          }
        ],
        onSubmit: v => {
          E.changeTerms(ui.appId, v.p);
          return 'Terms changed. Reapproval required.';
        }
      });
    },
    accept() {
      const a = E.app(ui.appId), c = E.cust(a.customerId);
      openForm({
        title: 'Customer: sign the agreement',
        intro: termsSummary(a.offer),
        submit: 'Sign agreement',
        fields: [
          { n: 'ok', l: `I have read the agreement, including the deposit, every installment, the due dates and the total payable of ${$m(a.offer.total)}. No other charges apply.`, t: 'checkbox' },
          { n: 'sig', l: 'Type your full name to sign', h: `As registered: ${esc(c.name)}` }
        ],
        onSubmit: v => {
          E.acceptAgreement(ui.appId, { acknowledged: v.ok, signature: v.sig });
          return E.app(ui.appId).status === 'Deposit Pending'
            ? 'Both parties have signed. The deposit is now due.'
            : 'Customer signature recorded. Waiting for company authorization.';
        }
      });
    },
    authorize() {
      run(
        () => E.authorizeAgreement(ui.appId),
        () => (E.app(ui.appId).status === 'Deposit Pending' ? 'Both parties have signed. The deposit is now due.' : 'Company authorization recorded. Waiting for the customer to sign.')
      );
    },
    regen() {
      run(() => E.regenerateAgreement(ui.appId), 'A new agreement version was generated.');
    },
    reserve() {
      const a = E.app(ui.appId);
      const free = E.s.devices.filter(d => d.productId === a.offer.productId && d.status === 'In Stock');
      if (!free.length) return toast('No phones of this model are in stock.', 'bad');
      openForm({
        title: 'Reserve a phone',
        fields: [{ n: 'd', l: 'IMEI', t: 'select', o: free.map(d => [d.id, d.imei]) }],
        onSubmit: v => {
          E.reserveDevice(ui.appId, v.d);
          return 'Phone reserved.';
        }
      });
    },
    stk(el) {
      const d = el.dataset;
      let aid = d.app || ui.appId;
      if (!d.app && ui.view === 'lease') aid = E.lease(ui.leaseId).appId;
      const L = E.leaseOfApp(E.app(aid));
      const amt = d.purpose === 'deposit' ? E.depositOutstanding(L) : d.inst ? E.instOutstanding(L, L.installments.find(i => i.id === d.inst)) : 0;
      openForm({
        title: 'Request M-PESA payment',
        intro: `The amount is taken from the contract, not typed in: ${$m(amt)}.`,
        submit: 'Send STK Push',
        fields: [{ n: 'ph', l: 'Phone to prompt', t: 'tel', v: E.cust(L.customerId).phone, h: 'Defaults to the customer\'s registered number.' }],
        onSubmit: v => {
          const p = E.initiateStk({ appId: aid, purpose: d.purpose, installmentId: d.inst, phone: v.ph });
          return p.status === 'Pending'
            ? 'Prompt sent. Nothing is recorded until M-PESA confirms. Open Payments to play the customer.'
            : 'M-PESA was unreachable. Nothing was charged; try again.';
        }
      });
    },
    handover() {
      openForm({
        title: 'Record handover',
        submit: 'Hand over phone',
        fields: [
          { n: 'a', l: 'Accessories handed over', v: 'Charger, USB cable' },
          { n: 'c', l: 'Condition', v: 'New, sealed box' },
          { n: 'ok', l: 'The customer has confirmed receipt of the phone', t: 'checkbox' }
        ],
        onSubmit: v => {
          const L = E.handover(ui.appId, { accessories: v.a, condition: v.c, customerConfirmed: v.ok });
          ui.view = 'lease';
          ui.leaseId = L.id;
          return `Lease active. First installment due ${fd(L.installments[0].due)}.`;
        }
      });
    },
    cancelHandover() {
      reasonForm('Cancel handover', 'Reason', 'Cancel handover', r => {
        E.cancelHandover(ui.appId, r);
        return 'Handover cancelled. Phone released.';
      });
    },
    cancelApp() {
      reasonForm('Cancel application', 'Reason', 'Cancel application', r => {
        E.cancelApplication(ui.appId, r);
        return 'Application cancelled.';
      });
    },
    quote() {
      const L = E.lease(ui.leaseId);
      const q = E.settlementQuote(L);
      openForm({
        title: 'Settlement quote',
        intro: `${q.note}`,
        submit: 'Collect settlement',
        fields: [],
        onSubmit: () => {
          const p = E.initiateStk({ appId: L.appId, purpose: 'settlement' });
          return 'Settlement prompt sent for ' + $m(p.amount) + '.';
        }
      });
      $('#dlg h2').insertAdjacentHTML(
        'afterend',
        `<div class="facts"><div><span>Outstanding installments</span><b>${$m(q.gross)}</b></div><div><span>Less credit held</span><b>${$m(q.credit)}</b></div><div><span>Settle today</span><b>${$m(q.amount)}</b></div></div>`
      );
    },
    dispute() {
      const L = E.lease(ui.leaseId);
      openForm({
        title: 'Open dispute',
        intro: 'Underlying payment history is kept. Reminders and new collections tasks pause for the disputed installment.',
        fields: [
          { n: 'i', l: 'Installment', t: 'select', o: [['', 'Whole account'], ...L.installments.map(i => [i.id, `Installment ${i.no}, ${fd(i.due)}`])] },
          { n: 'r', l: 'What is being disputed?', t: 'textarea' }
        ],
        onSubmit: v => {
          E.openDispute(L.id, v.r, v.i);
          return 'Dispute opened.';
        }
      });
    },
    resolveDispute(el) {
      reasonForm('Resolve dispute', 'Outcome', 'Resolve', r => {
        E.resolveDispute(el.dataset.id, r);
        return 'Dispute resolved.';
      });
    },
    adjust() {
      const L = E.lease(ui.leaseId);
      openForm({
        title: 'Request adjustment',
        intro: 'A Finance Approver must approve before anything changes. The balance is never edited directly.',
        fields: [
          { n: 't', l: 'Type', t: 'select', o: [['waiver', 'Waive part of an installment'], ['refund', 'Refund customer credit']] },
          { n: 'i', l: 'Installment (for a waiver)', t: 'select', o: L.installments.map(i => [i.id, `Installment ${i.no}, ${$m(E.instOutstanding(L, i))} outstanding`]) },
          { n: 'a', l: 'Amount (KES)', t: 'number' },
          { n: 'r', l: 'Reason', t: 'textarea' }
        ],
        onSubmit: v => {
          E.requestAdjustment({ leaseId: L.id, type: v.t, target: v.t === 'waiver' ? v.i : null, amount: KES(+v.a), reason: v.r.trim() });
          return 'Adjustment sent for approval.';
        }
      });
    },
    adjDecide(el) {
      run(() => E.decideAdjustment(el.dataset.id, el.dataset.ok === '1'), el.dataset.ok === '1' ? 'Adjustment approved and posted.' : 'Adjustment declined.');
    },
    checks() {
      const c = E.runCompletionChecks(ui.leaseId);
      save();
      render();
      toast(
        c.every(x => x.ok) ? 'All completion checks pass.' : 'Not ready: ' + c.filter(x => !x.ok).map(x => x.label).join('; ') + '.',
        c.every(x => x.ok) ? '' : 'bad'
      );
    },
    transfer() {
      run(() => E.completeOwnership(ui.leaseId), 'Ownership transferred and the lease is closed.');
    },
    simPay(el) {
      run(() => E.simPay(el.dataset.id), 'M-PESA confirmed. Callback processed.');
    },
    simCode(el) {
      run(() => E.simResult(el.dataset.id, +el.dataset.code), 'Provider result received. Nothing was posted.');
    },
    simWrong(el) {
      const p = E.pay(el.dataset.id);
      openForm({
        title: 'Pay a different amount',
        intro: `Requested ${$m(p.amount)}. A mismatch is held for review and is not applied.`,
        fields: [{ n: 'a', l: 'Amount paid (KES)', t: 'number', v: p.amount / 100 - 500 }],
        onSubmit: v => {
          E.simPay(p.id, { amount: KES(+v.a) });
          return 'Callback received with a different amount.';
        }
      });
    },
    simSpoof(el) {
      run(() => E.simPay(el.dataset.id, { authentic: false }), 'A forged callback was rejected and logged.');
    },
    replay(el) {
      run(() => {
        const ev = E.s.events.slice().reverse().find(e => e.paymentId === el.dataset.id && e.payload.ResultCode === 0);
        E.as('M-PESA (simulated)', () => E.receiveCallback(ev.payload));
      }, 'Same callback delivered again. No second posting.');
    },
    toggle(el) {
      E.s.sim[el.dataset.k] = el.checked;
      save();
    },
    c2b() {
      openForm({
        title: 'Send a paybill payment',
        intro: 'The customer pays to the business paybill with the lease number as account reference. Try a wrong reference, or an amount above what is due.',
        submit: 'Send payment',
        fields: [
          { n: 'r', l: 'Account reference', t: 'select', o: [...E.s.leases.map(l => [l.id, `${l.id}, ${custName(l.customerId)}`]), ['LSE-9999', 'LSE-9999 (unknown reference)']] },
          { n: 'a', l: 'Amount (KES)', t: 'number', v: 2000 }
        ],
        onSubmit: v => {
          E.simC2B({ ref: v.r, amount: KES(+v.a) });
          return 'Paybill notice received.';
        }
      });
    },
    resolveQ(el) {
      reasonForm(el.dataset.k === 'apply' ? 'Apply as received' : 'Do not apply', 'Reason for this decision', 'Confirm', r => {
        E.resolveQuarantine(el.dataset.id, el.dataset.k, r);
        return 'Exception resolved.';
      });
    },
    assign(el) {
      openForm({
        title: 'Assign to a lease',
        fields: [
          { n: 'l', l: 'Lease', t: 'select', o: E.s.leases.map(l => [l.id, `${l.id}, ${custName(l.customerId)}`]) },
          { n: 'r', l: 'Reason', t: 'textarea' }
        ],
        onSubmit: v => {
          E.assignUnmatched(el.dataset.id, v.l, v.r.trim());
          return 'Assigned and posted once.';
        }
      });
    },
    retry(el) {
      run(() => E.retryEvent(el.dataset.id), 'Posting retried safely.');
    },
    reverse(el) {
      reasonForm(
        'Reverse payment',
        'Reason (for example, the Safaricom reversal reference)',
        'Reverse',
        r => {
          E.reversePayment(el.dataset.id, r);
          return 'Reversal recorded and balance recalculated.';
        },
        'This writes a linked reversal entry. The original payment stays in the ledger.'
      );
    },
    contact(el) {
      openForm({
        title: 'Log contact',
        fields: [
          { n: 'c', l: 'Channel', t: 'select', o: ['Phone call', 'SMS', 'WhatsApp', 'Visit'].map(x => [x, x]) },
          { n: 'o', l: 'Outcome', t: 'select', o: ['Promised to pay', 'No answer', 'Refused to pay', 'Disputes the amount', 'Wrong number'].map(x => [x, x]) },
          { n: 'd', l: 'Promised payment date', t: 'date', h: 'Only for "Promised to pay".' },
          { n: 'n', l: 'Note', t: 'textarea' }
        ],
        onSubmit: v => {
          E.recordContact(el.dataset.id, { channel: v.c, outcome: v.o, promiseDate: v.d, note: v.n });
          return 'Contact logged.';
        }
      });
    },
    newProduct() {
      openForm({
        title: 'Add phone',
        fields: [
          { n: 'code', l: 'Product code', p: 'GAL-A15-128' },
          { n: 'brand', l: 'Brand' },
          { n: 'model', l: 'Model' },
          { n: 'storage', l: 'Storage', p: '128GB' },
          { n: 'cond', l: 'Condition', t: 'select', o: [['New', 'New'], ['Refurbished', 'Refurbished']] },
          { n: 'cash', l: 'Cash reference price (KES)', t: 'number' }
        ],
        onSubmit: v => {
          E.addProduct({ code: v.code.trim(), brand: v.brand.trim(), model: v.model.trim(), storage: v.storage, condition: v.cond, cashPrice: KES(+v.cash) });
          return 'Phone added. Add a price to make it available.';
        }
      });
    },
    newPricing() {
      priceForm(null);
    },
    revisePrice(el) {
      priceForm(E.pricing(el.dataset.id));
    },
    activatePrice(el) {
      run(() => E.activatePricing(el.dataset.id), 'Price activated. Earlier versions stay with signed agreements.');
    },
    deactivatePrice(el) {
      run(() => E.deactivatePricing(el.dataset.id), 'Price deactivated for new applications.');
    },
    systemConfigSave() {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can save system configuration.', 'bad');
      const value = id => $(`#${id}`).value.trim();
      let validationError = '';
      const integer = (id, label, min, max) => {
        const result = Number(value(id));
        if (!Number.isInteger(result) || result < min || result > max) {
          validationError = `${label} must be a whole number from ${min} to ${max}.`;
          return null;
        }
        return result;
      };
      const validIpv4 = ip => {
        const parts = ip.split('.');
        return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
      };
      const organizationName = value('sysOrganization');
      const databaseName = value('sysDbName');
      const host = value('sysHost');
      const username = value('sysUsername');
      if (!organizationName || !databaseName || !host || !username) return toast('Complete the organisation and database fields before saving.', 'bad');
      const ipWhitelist = value('sysIpWhitelist');
      const ranges = ipWhitelist.split(/[\n,]+/).map(ip => ip.trim()).filter(Boolean);
      for (const range of ranges) {
        const [address, prefix, ...rest] = range.split('/');
        if (!validIpv4(address) || rest.length || (prefix !== undefined && (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32))) return toast(`Invalid IPv4 address or CIDR range: ${range}`, 'bad');
      }
      const next = {
        organizationName, currency: value('sysCurrency'), timezone: value('sysTimezone'),
        sessionTimeout: integer('sysSessionTimeout', 'Session timeout', 1, 1440),
        databaseEngine: value('sysDbEngine'), databaseName, host,
        port: integer('sysPort', 'Database port', 1, 65535), username,
        sslMode: value('sysSslMode'), minPasswordLength: integer('sysMinPassword', 'Minimum password length', 8, 128),
        passwordExpiryDays: integer('sysPasswordExpiry', 'Password expiry', 0, 3650),
        maxLoginAttempts: integer('sysMaxAttempts', 'Maximum login attempts', 1, 50),
        lockoutMinutes: integer('sysLockout', 'Account lockout duration', 1, 1440),
        mfa: value('sysMfa'), auditLogging: value('sysAuditLogging'), ipWhitelist
      };
      if (validationError) return toast(validationError, 'bad');
      E.s.systemConfig = next;
      E.s.settings.company = organizationName;
      const reference = E.id('CFG');
      const timestamp = new Date().toISOString();
      E.s.systemConfigAudit.push({ reference, timestamp, event: 'Configuration Saved', details: `System configuration updated for ${organizationName}.`, performedBy: E.role });
      E.log('SYSTEM CONFIG', reference, `System configuration updated for ${organizationName}.`, 'WARN');
      save();
      render();
      toast('System configuration saved.');
    },
    settings() {
      const S = E.s.settings, k = x => x / 100;
      openForm({
        title: 'Edit policy',
        intro: 'Existing signed agreements keep their own terms.',
        fields: [
          { n: 'du', l: 'Permitted durations (months, comma separated)', v: S.durations.join(', ') },
          { n: 'gr', l: 'Default grace period (days)', t: 'number', v: S.graceDays },
          { n: 'rs', l: 'Reservation hold (days from approval)', t: 'number', v: S.reservationDays },
          { n: 'al', l: 'Approver limit (KES, total lease price)', t: 'number', v: k(S.approverLimit) },
          { n: 'sl', l: 'Senior Approver limit (KES)', t: 'number', v: k(S.seniorLimit) },
          { n: 'el', l: 'Exposure limit per customer (KES)', t: 'number', v: k(S.exposureLimit) },
          { n: 'af', l: 'Affordability limit (% of income)', t: 'number', v: S.affordability },
          { n: 'ds', l: 'Maximum debt service ratio (%)', t: 'number', v: S.maxDsr },
          { n: 'mi', l: 'Minimum monthly income (KES)', t: 'number', v: k(S.minIncome) },
          { n: 'co', l: 'Company name on agreements', v: S.company },
          { n: 'pb', l: 'Paybill number on agreements', v: S.paybill },
          { n: 'ao', l: 'System transfers ownership automatically when every completion check passes', t: 'checkbox', v: S.autoOwnership }
        ],
        onSubmit: v => {
          const du = v.du.split(',').map(x => +x.trim()).filter(x => Number.isInteger(x) && x > 0);
          if (!du.length) throw new Error('Enter at least one duration.');
          E.updateSettings({
            durations: du,
            graceDays: +v.gr,
            reservationDays: +v.rs,
            approverLimit: KES(+v.al),
            seniorLimit: KES(+v.sl),
            exposureLimit: KES(+v.el),
            affordability: +v.af,
            maxDsr: +v.ds,
            minIncome: KES(+v.mi),
            company: v.co.trim(),
            paybill: v.pb.trim(),
            autoOwnership: v.ao
          });
          return 'Policy saved.';
        }
      });
    },
    clauses() {
      const S = E.s.settings;
      openForm({
        title: 'Agreement wording',
        intro: 'New agreement versions use this wording. Signed agreements keep the text they were signed with. You can use {phone}, {paybill}, {grace} and {company}.',
        fields: CLAUSE_KEYS.map(k => ({ n: k, l: CLAUSE_TITLES[k], t: 'textarea', v: S.clauses[k] })),
        onSubmit: v => {
          E.updateSettings({ clauses: Object.fromEntries(CLAUSE_KEYS.map(k => [k, v[k].trim()])) });
          return 'Wording saved for new agreements.';
        }
      });
    },
    perm(el) {
      run(() => E.setPermission(el.dataset.a, el.dataset.r, el.checked), 'Access updated and logged.');
    },
    staffAdd() {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage staff.', 'bad');
      const positions = [...new Set([...(E.s.staffPositions || []).map(position => position.name), ...ROLES.filter(role => role !== 'Customer')])].map(name => [name, name]);
      openForm({
        title: 'Add Staff Member',
        sectionTitle: 'Staff details',
        staffForm: true,
        grid: true,
        submit: 'Save staff member',
        fields: [
          { n: 'name', l: 'Full name', p: 'e.g. Jane Wambui' },
          { n: 'email', l: 'Email address', t: 'email', p: 'jane@spectrum.co.ke' },
          { n: 'phone', l: 'Phone', t: 'tel', p: '+254 700 000 000' },
          { n: 'gender', l: 'Gender', t: 'select', o: [['', 'Select gender'], ['Female', 'Female'], ['Male', 'Male'], ['Prefer not to say', 'Prefer not to say']] },
          { n: 'role', l: 'System role', t: 'select', o: ROLES.filter(role => role !== 'Customer').map(role => [role, role]), v: 'Sales Agent' },
          { n: 'position', l: 'Position', t: 'select', o: [['', 'Select position'], ...positions] },
          { n: 'status', l: 'Status', t: 'select', o: [['Active', 'Active'], ['Inactive', 'Inactive']], v: 'Active' }
        ],
        onSubmit: v => {
          const name = v.name.trim(), email = v.email.trim(), phone = normPhone(v.phone);
          if (!name) throw new Error('Enter the staff member’s name.');
          if (E.s.staff.some(person => person.name.toLowerCase() === name.toLowerCase())) throw new Error('A staff member with that name already exists.');
          if (E.s.staffChangeRequests.some(request => request.kind === 'staff.add' && request.status === 'Pending approval' && request.payload.name.toLowerCase() === name.toLowerCase())) throw new Error('A request for that staff member is already awaiting approval.');
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
          if (!phone) throw new Error('Enter a valid Kenyan phone number.');
          if (!v.gender) throw new Error('Select a gender.');
          if (!v.position) throw new Error('Select a position.');
          const position = (E.s.staffPositions || []).find(item => item.name === v.position);
          submitStaffChangeRequest('staff.add', `Add ${name} as ${v.role} · ${v.position}`, {
            id: E.id('STF'), name, role: v.role, email, phone: `+${phone}`, gender: v.gender,
            position: v.position, branch: 'Unassigned', department: position?.department || staffDepartment(v.role), status: v.status
          });
          return `${name} submitted for maker-checker approval.`;
        }
      });
    },
    staffEdit(el) {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage staff.', 'bad');
      const person = E.s.staff.find(record => record.id === el.dataset.id);
      if (!person) return;
      openForm({
        title: 'Edit staff member',
        fields: [
          { n: 'name', l: 'Full name', v: person.name },
          { n: 'role', l: 'Role', t: 'select', o: ROLES.filter(role => role !== 'Customer').map(role => [role, role]), v: person.role },
          { n: 'email', l: 'Email (optional)', t: 'email', v: person.email || '' }
        ],
        onSubmit: v => {
          const name = v.name.trim(), email = v.email.trim();
          if (!name) throw new Error('Enter the staff member’s name.');
          if (E.s.staff.some(record => record.id !== person.id && record.name.toLowerCase() === name.toLowerCase())) throw new Error('A staff member with that name already exists.');
          if (E.s.staffChangeRequests.some(request => request.kind === 'staff.edit' && request.targetId === person.id && request.status === 'Pending approval')) throw new Error('An update request for this staff member is already awaiting approval.');
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
          submitStaffChangeRequest('staff.edit', `Update ${person.name}: ${name} · ${v.role}`, { name, role: v.role, email }, person.id);
          return 'Staff update submitted for maker-checker approval.';
        }
      });
    },
    staffToggle(el) {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage staff.', 'bad');
      const person = E.s.staff.find(record => record.id === el.dataset.id);
      if (!person) return;
      const status = person.status === 'Active' ? 'Inactive' : 'Active';
      run(() => commitStaffChange(`${status === 'Active' ? 'Activated' : 'Deactivated'} ${person.name}`, () => { person.status = status; }), `${person.name} ${status.toLowerCase()}.`);
    },
    staffDelete(el) {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can request staff deletion.', 'bad');
      const person = E.s.staff.find(record => record.id === el.dataset.id && record.status !== 'Deleted');
      if (!person) return toast('Staff member not found.', 'bad');
      if (E.s.staffChangeRequests.some(request => request.kind === 'staff.delete' && request.targetId === person.id && request.status === 'Pending approval')) return toast('A deletion request is already awaiting approval.', 'bad');
      reasonForm('Request staff deletion', 'Reason for deletion', 'Submit for approval', reason => {
        if (!reason) throw new Error('Enter a reason for deletion.');
        submitStaffChangeRequest('staff.delete', `Delete ${person.name} (${person.role}) · ${reason}`, {}, person.id);
        return `Deletion of ${person.name} submitted for maker-checker approval.`;
      });
    },
    staffAssignment(el) {
      if (E.role !== 'Super Admin') return toast('Only a Super Admin can manage staff assignments.', 'bad');
      const assignment = el.dataset.mode === 'edit' ? E.s.staffAssignments.find(record => record.id === el.dataset.id) : null;
      if (el.dataset.mode === 'edit' && !assignment) return toast('Assignment not found.', 'bad');
      const fields = [
        { n: 'staffId', l: 'User / Staff Member', t: 'select', o: [['', 'Select staff member'], ...E.s.staff.map(person => [person.id, person.name])], v: assignment?.staffId || '' },
        { n: 'position', l: 'Assigned Position', t: 'select', o: [['', 'Select position'], ...ROLES.filter(role => role !== 'Customer').map(role => [role, role]), ...(E.s.staffPositions || []).filter(position => !ROLES.includes(position.name)).map(position => [position.name, position.name])], v: assignment?.position || '' },
        { n: 'organization', l: 'Organization', t: 'select', o: STAFF_ORGANIZATIONS.map(x => [x, x]), v: assignment?.organization || 'Unassigned' },
        { n: 'department', l: 'Department', t: 'select', o: STAFF_DEPARTMENTS.map(x => [x, x]), v: assignment?.department || 'Origination' },
        { n: 'roleType', l: 'Role Type', t: 'select', o: [['Primary', 'Primary'], ['Secondary', 'Secondary']], v: assignment?.roleType || 'Primary' },
        { n: 'status', l: 'Status', t: 'select', o: [['Active', 'Active'], ['Inactive', 'Inactive']], v: assignment?.status || 'Active' }
      ];
      openForm({
        title: assignment ? 'Edit Assignment' : 'New Assignment', submit: 'Save Assignment', fields, grid: true,
        onSubmit: v => {
          const person = E.s.staff.find(record => record.id === v.staffId);
          if (!person) throw new Error('Select a staff member.');
          if (!v.position) throw new Error('Select an assigned position.');
          if (E.s.staffAssignments.some(record => record.id !== assignment?.id && record.staffId === v.staffId && record.position === v.position && record.roleType === v.roleType)) {
            throw new Error('This staff member already has that position and role type.');
          }
          if (E.s.staffChangeRequests.some(request => request.status === 'Pending approval' && ((assignment && request.kind === 'assignment.edit' && request.targetId === assignment.id) || (!assignment && request.kind === 'assignment.add' && request.payload.staffId === v.staffId && request.payload.position === v.position && request.payload.roleType === v.roleType)))) {
            throw new Error('A matching assignment request is already awaiting approval.');
          }
          const details = { staffId: v.staffId, position: v.position, organization: v.organization, department: v.department, roleType: v.roleType, status: v.status };
          if (assignment) {
            submitStaffChangeRequest('assignment.edit', `Update ${person.name} assignment to ${v.position} · ${v.organization} · ${v.department}`, details, assignment.id);
          } else {
            const created = { id: E.id('ASN'), ...details };
            submitStaffChangeRequest('assignment.add', `Assign ${person.name} to ${v.position} · ${v.organization} · ${v.department}`, created);
          }
          return 'Staff assignment submitted for maker-checker approval.';
        }
      });
    },
    staffAssignmentView(el) {
      const assignment = E.s.staffAssignments.find(record => record.id === el.dataset.id);
      const person = assignment && E.s.staff.find(record => record.id === assignment.staffId);
      if (!assignment || !person) return;
      const d = $('#dlg');
      d.innerHTML = `<form method="dialog"><h2>Position assignment</h2><dl class="kv"><dt>User / Staff member</dt><dd>${esc(person.name)}${person.email ? ` · ${esc(person.email)}` : ''}</dd><dt>Assigned position</dt><dd>${esc(assignment.position)}</dd><dt>Organization</dt><dd>${esc(assignment.organization)}</dd><dt>Department</dt><dd>${esc(assignment.department)}</dd><dt>Role type</dt><dd>${esc(assignment.roleType)}</dd><dt>Status</dt><dd>${esc(assignment.status)}</dd></dl><div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" class="btn" id="fclose">Close</button></div></form>`;
      d.querySelector('#fclose').onclick = () => d.close();
      d.showModal();
    },
    staffApprovalReview(el) {
      if (!E.can('adjust.approve')) return toast('Your role cannot review approval requests.', 'bad');
      const request = E.s.adjustments.find(item => item.id === el.dataset.id && item.status === 'Pending approval');
      if (!request) return toast('This request has already been reviewed.', 'bad');
      openForm({
        title: 'Review maker-checker request',
        intro: `${request.type} of ${$m(request.amount)} for ${request.leaseId}. Submitted by ${request.requestedBy}: ${request.reason}`,
        fields: [
          { n: 'decision', l: 'Decision', t: 'select', o: [['approve', 'Approve'], ['decline', 'Decline']] },
          { n: 'note', l: 'Checker note', t: 'textarea', h: 'A note is optional. The request and checker decision are retained.' }
        ],
        onSubmit: v => {
          E.decideAdjustment(request.id, v.decision === 'approve', v.note.trim());
          return v.decision === 'approve' ? 'Request approved.' : 'Request declined.';
        }
      });
    },
    staffChangeReview(el) {
      if (!E.can('staff.changes.approve')) return toast('Your role cannot review staff change requests.', 'bad');
      const request = E.s.staffChangeRequests.find(item => item.id === el.dataset.id && item.status === 'Pending approval');
      if (!request) return toast('This staff change request has already been reviewed.', 'bad');
      if (request.submittedBy === E.role) return toast('The maker cannot approve their own staff change request.', 'bad');
      openForm({
        title: 'Review staff change request',
        intro: `${request.summary}. Submitted by ${request.submittedBy} on ${fd(request.submittedAt)}.`,
        fields: [
          { n: 'decision', l: 'Decision', t: 'select', o: [['approve', 'Approve'], ['decline', 'Decline']] },
          { n: 'note', l: 'Checker note', t: 'textarea', h: 'Optional note retained with the checker decision.' }
        ],
        onSubmit: v => {
          decideStaffChangeRequest(request.id, v.decision === 'approve', v.note.trim());
          return v.decision === 'approve' ? 'Staff change approved.' : 'Staff change declined.';
        }
      });
    },
    permReset() {
      if (!confirm('Reset every permission to the approved defaults?')) return;
      run(() => E.resetPermissions(), 'Permissions reset to the approved defaults.');
    },
    newDevice() {
      const sug = makeImei('35' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'));
      openForm({
        title: 'Register phone',
        fields: [
          { n: 'p', l: 'Model', t: 'select', o: E.s.products.map(p => [p.id, prodName(p.id)]) },
          { n: 'i', l: 'IMEI', v: sug, h: '15 digits with a valid check digit. A valid sample is filled in.' },
          { n: 'c', l: 'Condition', v: 'New' }
        ],
        onSubmit: v => {
          E.registerDevice({ imei: v.i.trim(), productId: v.p, condition: v.c });
          return 'Phone registered.';
        }
      });
    },
    quarantine(el) {
      const on = el.dataset.on === '1';
      reasonForm(on ? 'Quarantine phone' : 'Release phone', 'Reason', on ? 'Quarantine' : 'Release', r => {
        E.setQuarantine(el.dataset.id, on, r);
        return on ? 'Phone quarantined.' : 'Phone released to stock.';
      });
    },
  };

  function termsSummary(o) {
    return `Deposit ${$m(o.deposit)}, then ${o.count} monthly installments of ${$m(o.installments[0])}${o.installments[o.count - 1] !== o.installments[0] ? ` (the last is ${$m(o.installments[o.count - 1])})` : ''}. Total payable ${$m(o.total)}.`;
  }

  function priceForm(base) {
    openForm({
      title: base ? `New version of ${prodName(base.productId)}, ${base.months} months` : 'Add price',
      intro: base ? 'Creates a draft. The current version keeps serving signed agreements.' : 'New prices start as drafts and need activation.',
      fields: [
        ...(base ? [] : [{ n: 'p', l: 'Phone', t: 'select', o: E.s.products.map(p => [p.id, prodName(p.id)]) }, { n: 'm', l: 'Duration', t: 'select', o: E.s.settings.durations.map(m => [m, m + ' months']) }]),
        { n: 't', l: 'Total lease price (KES)', t: 'number', v: base ? base.total / 100 : '' },
        { n: 'dt', l: 'Deposit rule', t: 'select', o: [['fixed', 'Fixed amount (KES)'], ['percent', 'Percentage of total']], v: base ? base.depositType : 'fixed' },
        { n: 'dv', l: 'Deposit value', t: 'number', v: base ? (base.depositType === 'percent' ? base.depositValue : base.depositValue / 100) : '', h: 'KES for a fixed amount, or a percentage.' },
        { n: 'g', l: 'Grace period (days)', t: 'number', v: base ? base.graceDays : E.s.settings.graceDays },
        { n: 'f', l: 'Effective from', t: 'date', v: base ? E.s.date : E.s.date }
      ],
      onSubmit: v => {
        const d = { total: KES(+v.t), depositType: v.dt, depositValue: v.dt === 'fixed' ? KES(+v.dv) : +v.dv, graceDays: +v.g, from: v.f };
        const p = base ? E.revisePricing(base.id, d) : E.addPricing({ productId: v.p, months: +v.m, ...d });
        const e = E.validatePricing(p);
        return e.length ? 'Saved as a draft, but it cannot be activated yet: ' + e[0] : 'Draft saved. Activate it to offer it to customers.';
      }
    });
  }

  document.addEventListener('input', ev => {
    if (ev.target.id === 'inventorySearch' && !ev.target.value.trim() && ui.inventoryQuery) {
      ui.inventoryQuery = '';
      render();
      return;
    }
    if (ev.target.id !== 'q') return;
    const r = searchAll(ev.target.value),
      box = $('#sres');
    box.innerHTML = ev.target.value.trim().length < 2 ? '' : r.length ? r.map(x => `<button data-act="${x.act}" data-id="${x.id}">${esc(x.t)}<span>${esc(x.s)}</span></button>`).join('') : '<p>No match.</p>';
  });

  document.addEventListener('submit', ev => {
    if (ev.target.id === 'forgotForm') {
      ev.preventDefault();
      ui.resetEmail = $('#resetEmail').value.trim();
      ui.resetNotice = 'Password reset email delivery is not configured yet. Contact your administrator to reset your password.';
      renderLogin();
      return;
    }
    if (ev.target.id !== 'loginForm') return;
    ev.preventDefault();
    if (ui.loginMethod === 'mobile') {
      const phone = $('#loginPhone').value.trim();
      if (!phone) return;
      ui.loginPhone = phone;
      $('#loginMethodNote').textContent = `Mobile number captured: ${phone}. OTP delivery is not connected yet.`;
      $('#loginError').textContent = '';
      return;
    }
    if (ui.loginMethod === 'email' || ui.loginMethod === 'magic') {
      const email = $('#loginEmail').value.trim();
      if (!email) return;
      ui.loginEmail = email;
      $('#loginMethodNote').textContent = ui.loginMethod === 'magic'
        ? `Email captured: ${email}. Magic-link delivery is not connected yet.`
        : `Email captured: ${email}. Email OTP delivery is not connected yet.`;
      $('#loginError').textContent = '';
      return;
    }
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const error = $('#loginError');
    if (!email || !password) {
      error.textContent = 'Enter your email address and password.';
      return;
    }
    const account = LOGIN_ACCOUNTS.find(item => item.email === email && item.password === password);
    if (!account) {
      error.textContent = 'Email address or password is incorrect.';
      return;
    }
    E.role = account.role;
    sessionStorage.setItem(AUTH_KEY, 'signed-in');
    render();
  });

  document.addEventListener('click', ev => {
    const methodButton = ev.target.closest('[data-login-method]');
    if (methodButton) {
      const selected = methodButton.dataset.loginMethod;
      ui.loginMethod = selected;
      renderLogin();
      return;
    }
    const action = ev.target.closest('[data-login-act]')?.dataset.loginAct;
    if (!action) return;
    if (action === 'togglePassword') {
      const password = $('#loginPassword');
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      ev.target.closest('button').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    } else if (action === 'forgot') {
      ui.resetEmail = $('#loginEmail').value.trim();
      ui.resetNotice = '';
      ui.authView = 'forgot';
      renderLogin();
    } else if (action === 'backToSignIn') {
      ui.authView = 'login';
      ui.resetNotice = '';
      renderLogin();
    } else if (action === 'register') {
      $('#loginError').textContent = 'Access is managed by your Spectrum Credit administrator.';
    }
  });

  document.addEventListener('click', ev => {
    if (!ev.target.closest('.search-box')) {
      const b = $('#sres');
      if (b) b.innerHTML = '';
    }
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    if (el.disabled) return;
    const f = H[el.dataset.act];
    if (f) f(el);
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.matches('input[data-customer-file]')) {
      const file = el.files?.[0];
      if (file) attachCustomerFile(el.dataset.customerId, el.dataset.customerFile, file).catch(error => toast(error.message, 'bad'));
      return;
    }
    if (el.matches('select[data-act],input[data-act]')) {
      const f = H[el.dataset.act];
      if (f) f(el);
      return;
    }
    if (el.matches('input[data-doc]')) {
      const f = el.files[0];
      if (f) run(() => E.uploadDoc(ui.appId, el.dataset.doc, f.name, Math.round(f.size / 1024)), 'Document received.');
    }
  });

  function showTime() {
    const el = document.getElementById('currentTime');
    if (!el) return;
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi'
    }).format(now);
    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Africa/Nairobi'
    }).format(now);
    el.textContent = `${date} • ${time}`;
  }

  // Initialize
  E = loadEngine();
  try {
    if (localStorage.getItem(AUDIT_CLEAR_KEY) !== '1') {
      E.s.audit = [];
      if (Array.isArray(E.s.systemConfigAudit)) E.s.systemConfigAudit = [];
      localStorage.setItem(AUDIT_CLEAR_KEY, '1');
    }
  } catch (e) {
    console.warn('Could not clear stored audit history:', e);
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { console.warn('Could not load theme preference.', e); }
  applyTheme(savedTheme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  // Add Super Admin as a maker-checker reviewer when migrating the prior default.
  if (Array.isArray(E.s.perms['adjust.approve']) && E.s.perms['adjust.approve'].length === 1 && E.s.perms['adjust.approve'][0] === 'Finance Approver') {
    E.s.perms['adjust.approve'].push('Super Admin');
  }
  E.role = 'Super Admin';
  ensureStaffRecords();
  ensureSystemConfig();
  E.s.perms['audit.view'] = ['Super Admin'];
  syncStaffPools();
  save();
  render();
  setInterval(showTime, 1000);
})();
