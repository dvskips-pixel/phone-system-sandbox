(function () {
'use strict';

let _DATA, _LEDGER;
if (typeof module !== 'undefined' && module.exports) {
  _DATA = require('./data');
  _LEDGER = require('./ledger');
} else {
  _DATA = window.SpectrumData || window.SpectrumDataData;
  _LEDGER = window.SpectrumLedger || window.SpectrumLedger;
}

const {
  ROLES, DEFAULT_PERMS, DOC_KINDS, REASON_CODES,
  CLAUSE_KEYS, CLAUSE_TITLES, DEFAULT_CLAUSES
} = _DATA;

const {
  KES, money, D, normPhone, luhnOk, makeImei, buildSchedule
} = _LEDGER;

class Engine {
  constructor(s) {
    this.s = s || Engine.blank();
    this.role = 'Super Admin';
  }

  static blank(date = '2026-10-14') {
    return {
      v: 3,
      date,
      perms: JSON.parse(JSON.stringify(DEFAULT_PERMS)),
      seq: {},
      settings: {
        durations: [3, 6, 9, 12],
        graceDays: 3,
        reminderOffsets: [-3, 0, 1, 2, 3],
        reservationDays: 7,
        approverLimit: KES(60000),
        affordability: 40,
        minAge: 18,
        escalationDays: 14,
        oneActiveApp: true,
        company: 'Spectrum Credit Limited',
        paybill: '400200',
        seniorLimit: KES(250000),
        exposureLimit: KES(120000),
        maxDsr: 60,
        minIncome: KES(10000),
        premiumThreshold: KES(40000),
        premiumMinIncome: KES(35000),
        maxActiveLeases: 2,
        reviewSlaDays: 2,
        autoOwnership: true,
        agents: [],
        officers: [],
        lowStock: 2,
        clauses: JSON.parse(JSON.stringify(DEFAULT_CLAUSES))
      },
      products: [],
      pricings: [],
      customers: [],
      apps: [],
      devices: [],
      leases: [],
      payments: [],
      events: [],
      ledger: [],
      tasks: [],
      notifs: [],
      adjustments: [],
      disputes: [],
      audit: [],
      receipts: {},
      sim: { providerDown: false, failNextPost: false }
    };
  }

  /* ---------- plumbing ---------- */
  id(p) {
    const n = (this.s.seq[p] = (this.s.seq[p] || 0) + 1);
    return p + '-' + String(n).padStart(4, '0');
  }

  fail(m) {
    throw new Error(m);
  }

  can(a) {
    return (this.s.perms[a] || []).includes(this.role);
  }

  need(a) {
    if (!this.can(a)) {
      this.log('DENIED', a, `${this.role} attempted "${a}" and was refused`, 'SECURITY');
      this.fail(`Permission denied: ${this.role} cannot perform this action.`);
    }
  }

  log(action, entity, detail, kind = 'INFO') {
    this.s.audit.push({
      id: this.id('AUD'),
      ts: new Date().toISOString(),
      date: this.s.date,
      actor: this.role,
      action,
      entity,
      detail,
      kind
    });
  }

  as(role, fn) {
    const keep = this.role;
    this.role = role;
    try {
      return fn();
    } finally {
      this.role = keep;
    }
  }

  atomic(fn) {
    const keys = ['ledger', 'payments', 'receipts', 'leases', 'apps', 'devices', 'tasks', 'notifs'];
    const snap = JSON.stringify(keys.map(k => this.s[k]));
    try {
      return fn();
    } catch (e) {
      const a = JSON.parse(snap);
      keys.forEach((k, i) => (this.s[k] = a[i]));
      throw e;
    }
  }

  get(list, id, label) {
    const x = this.s[list].find(o => o.id === id);
    if (!x) this.fail(`${label} ${id} not found`);
    return x;
  }

  app(id) { return this.get('apps', id, 'Application'); }
  lease(id) { return this.get('leases', id, 'Lease'); }
  cust(id) { return this.get('customers', id, 'Customer'); }
  pricing(id) { return this.get('pricings', id, 'Pricing'); }
  product(id) { return this.get('products', id, 'Product'); }
  device(id) { return this.get('devices', id, 'Device'); }
  pay(id) { return this.get('payments', id, 'Payment'); }
  leaseOfApp(a) { return a.leaseId ? this.lease(a.leaseId) : null; }

  /* ---------- catalogue & pricing ---------- */
  addProduct(d) {
    this.need('pricing.manage');
    if (!d.code || !d.brand || !d.model) this.fail('Product code, brand and model are required.');
    if (this.s.products.some(p => p.code === d.code)) this.fail(`Product code ${d.code} already exists.`);
    const p = {
      id: d.code,
      code: d.code,
      brand: d.brand,
      model: d.model,
      storage: d.storage || '',
      condition: d.condition || 'New',
      cashPrice: d.cashPrice,
      status: d.status || 'Active'
    };
    this.s.products.push(p);
    this.log('PRODUCT', p.code, `Product added: ${p.brand} ${p.model}`);
    return p;
  }

  depositOf(p) {
    return p.depositType === 'percent'
      ? Math.round((p.total * p.depositValue) / 100 / 100) * 100
      : p.depositValue;
  }

  validatePricing(p) {
    const err = [], S = this.s.settings;
    if (!this.s.products.find(x => x.id === p.productId)) err.push('Product not found.');
    if (!Number.isInteger(p.months) || p.months <= 0) {
      err.push('Duration must be a positive whole number of months.');
    } else if (!S.durations.includes(p.months)) {
      err.push(`${p.months} months is not a permitted duration (${S.durations.join(', ')}).`);
    }
    if (!(p.total > 0)) err.push('Total lease price must be positive.');
    if (p.depositType === 'percent' && !(p.depositValue > 0 && p.depositValue < 100)) {
      err.push('Deposit percentage must be above 0 and below 100.');
    }
    const dep = this.depositOf(p);
    if (!(dep > 0)) {
      err.push('Deposit must be positive.');
    } else if (dep >= p.total) {
      err.push('Deposit must be less than the total lease price.');
    }
    if (!p.from) err.push('Effective start date is required.');
    if (p.to && p.to < p.from) err.push('Effective end date is before the start date.');
    if (!Number.isInteger(p.graceDays) || p.graceDays < 0) {
      err.push('Grace period must be a whole number of days.');
    }
    if (!Array.isArray(p.reminderOffsets) || p.reminderOffsets.some(x => !Number.isInteger(x))) {
      err.push('Reminder schedule must be whole days relative to the due date.');
    }
    if (!err.length) {
      const sch = buildSchedule(p.total, dep, p.months);
      if (sch.length !== p.months || dep + sch.reduce((a, b) => a + b, 0) !== p.total) {
        err.push('Installment schedule does not reconcile to the total.');
      }
    }
    return err;
  }

  addPricing(d) {
    this.need('pricing.manage');
    this.product(d.productId);
    const same = this.s.pricings.filter(x => x.productId === d.productId && x.months === d.months);
    const p = {
      id: this.id('PRC'),
      productId: d.productId,
      months: d.months,
      total: d.total,
      depositType: d.depositType || 'fixed',
      depositValue: d.depositValue,
      frequency: 'Monthly',
      graceDays: d.graceDays ?? this.s.settings.graceDays,
      reminderOffsets: d.reminderOffsets || [...this.s.settings.reminderOffsets],
      from: d.from || this.s.date,
      to: d.to || null,
      status: 'Draft',
      version: same.length ? Math.max(...same.map(x => x.version)) + 1 : 1,
      createdBy: this.role,
      supersedes: d.supersedes || null
    };
    this.s.pricings.push(p);
    this.log('PRICING', p.id, `Draft v${p.version} created: ${p.months} months, ${money(p.total)}`);
    return p;
  }

  revisePricing(id, ch) {
    this.need('pricing.manage');
    const o = this.pricing(id);
    return this.addPricing({ ...o, ...ch, supersedes: o.id });
  }

  activatePricing(id) {
    this.need('pricing.activate');
    const p = this.pricing(id);
    if (p.status === 'Active') this.fail('This pricing is already active.');
    if (p.createdBy === this.role && this.role !== 'Super Admin') {
      this.fail('Segregation of duties: a Super Admin (or another approver) must activate pricing you created.');
    }
    const e = this.validatePricing(p);
    if (e.length) this.fail('Cannot activate: ' + e.join(' '));
    this.s.pricings
      .filter(x => x.productId === p.productId && x.months === p.months && x.status === 'Active')
      .forEach(x => {
        x.status = 'Inactive';
        x.supersededBy = p.id;
      });
    p.status = 'Active';
    p.approvedBy = this.role;
    p.approvedAt = this.s.date;
    this.log('PRICING', p.id, `Activated v${p.version} (${money(p.total)}). Earlier versions stay attached to signed agreements.`);
    return p;
  }

  deactivatePricing(id) {
    this.need('pricing.activate');
    const p = this.pricing(id);
    p.status = 'Inactive';
    this.log('PRICING', p.id, 'Deactivated for new applications');
    return p;
  }

  pricingAvailable(p) {
    const t = this.s.date;
    const prod = this.s.products.find(x => x.id === p.productId);
    return p.status === 'Active' && p.from <= t && (!p.to || t <= p.to) && prod && prod.status === 'Active';
  }

  buildOffer(p) {
    const dep = this.depositOf(p);
    const inst = buildSchedule(p.total, dep, p.months);
    return {
      pricingId: p.id,
      pricingVersion: p.version,
      productId: p.productId,
      months: p.months,
      total: p.total,
      deposit: dep,
      balance: p.total - dep,
      installments: inst,
      count: inst.length,
      frequency: p.frequency,
      graceDays: p.graceDays,
      reminderOffsets: [...p.reminderOffsets]
    };
  }

  updateSettings(o) {
    this.need('settings');
    Object.assign(this.s.settings, o);
    this.log('SETTINGS', 'policy', JSON.stringify(o));
  }

  /* ---------- customers ---------- */
  registerCustomer(d) {
    this.need('customer.register');
    const err = [];
    const phone = normPhone(d.phone);
    if (!d.name || d.name.trim().length < 3) err.push('Full name is required.');
    const idValid = {
      'National ID': /^\d{7,8}$/,
      Passport: /^(?=.*[A-Za-z])[A-Za-z0-9]{6,9}$/,
      'Alien ID': /^\d{6,9}$/,
      'Military ID': /^[A-Za-z0-9]{6,12}$/
    }[d.idType || 'National ID'];
    if (!idValid || !idValid.test(d.idNo || '')) err.push(`Enter a valid ${d.idType || 'National ID'} document number.`);
    if (!phone) err.push('Enter a valid Safaricom number, for example 0712 345 678.');
    const dob = d.dob && D.parse(d.dob);
    const age = dob ? Math.floor(D.diff(this.s.date, d.dob) / 365.25) : -1;
    if (!dob || isNaN(dob)) {
      err.push('Date of birth is required.');
    } else if (age < this.s.settings.minAge) {
      err.push(`Customer must be at least ${this.s.settings.minAge} years old.`);
    }
    if (!d.address || !d.address.trim()) err.push('Residential address is required.');
    if (!d.county) err.push('Select a county.');
    if (!d.employment || !d.employment.type || !d.employment.name || !d.employment.position || !Number.isFinite(+d.employment.months) || +d.employment.months < 0 || !d.employment.location) err.push('Complete the employment or business details.');
    if (!d.consent || !d.consent.privacy || !d.consent.creditCheck) err.push('The customer must accept the privacy notice and identity/credit checks.');
    if (!d.registeringAgent) err.push('Select the registering agent.');
    if (!d.kyc || !d.kyc.idFront || !d.kyc.photo || (d.idType !== 'Passport' && !d.kyc.idBack)) err.push('Upload the required identity document images and customer photo.');
    const alt = d.alternativeContact || {};
    if ([alt.name, alt.relationship, alt.phone, alt.email, alt.reason, alt.note].some(value => String(value || '').trim())) {
      if (!alt.name || !alt.relationship || !normPhone(alt.phone) || !alt.reason) err.push('Complete the alternative contact details and select a reason.');
      if (alt.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alt.email)) err.push('Enter a valid alternative contact email address.');
      if (alt.reason === 'Other' && !alt.note) err.push('Explain why an alternative contact is needed.');
    }
    if (err.length) this.fail(err.join(' '));
    const dup = this.s.customers.find(c => c.idNo === d.idNo && (c.idType || 'National ID') === (d.idType || 'National ID') || c.phone === phone);
    if (dup) this.fail(`Possible duplicate of ${dup.id} (${dup.name}). Review that profile instead of creating another.`);
    const c = {
      id: this.id('CUS'),
      name: d.name.trim(),
      idNo: d.idNo,
      idType: d.idType || 'National ID',
      phone,
      dob: d.dob,
      address: d.address.trim(), county: d.county,
      alternativeContact: d.alternativeContact && d.alternativeContact.name ? { ...d.alternativeContact, phone: normPhone(d.alternativeContact.phone) } : null,
      employment: { ...d.employment, months: +d.employment.months },
      kyc: { status: 'Pending', by: null, at: null, note: d.kyc.note || '', documents: d.kyc },
      registeringAgent: d.registeringAgent,
      consent: { given: true, privacyNoticeVersion: '1.0', identityAndCreditChecks: true, marketingSms: !!d.consent.marketingSms, at: this.s.date },
      createdAt: this.s.date
    };
    this.s.customers.push(c);
    this.log('CUSTOMER', c.id, `Registered ${c.name}`);
    return c;
  }

  verifyCustomerKyc(customerId) {
    this.need('kyc.verify');
    const c = this.cust(customerId), d = c.kyc.documents || {};
    const formats = {
      'National ID': /^\d{7,8}$/,
      Passport: /^(?=.*[A-Za-z])[A-Za-z0-9]{6,9}$/,
      'Alien ID': /^\d{6,9}$/,
      'Military ID': /^[A-Za-z0-9]{6,12}$/
    };
    const idMatches = formats[c.idType] && formats[c.idType].test(c.idNo || '');
    const docsPresent = !!(d.idFront && d.photo && (c.idType === 'Passport' || d.idBack));
    const age = D.diff(this.s.date, c.dob) / 365.25;
    const ok = !!(idMatches && normPhone(c.phone) && age >= this.s.settings.minAge && docsPresent && d.originalSeen);
    c.kyc.status = ok ? 'Verified' : 'Failed';
    c.kyc.by = this.role;
    c.kyc.at = this.s.date;
    c.kyc.note = d.note || (ok ? 'Automated identity checks passed.' : 'Automated identity checks need manual review.');
    this.log('KYC', c.id, `Automated identity check ${ok ? 'passed' : 'needs manual review'}`);
    return ok;
  }

  /* ---------- inventory ---------- */
  registerDevice(d) {
    this.need('device.manage');
    this.product(d.productId);
    if (!luhnOk(d.imei)) this.fail('IMEI must be 15 digits with a valid check digit.');
    if (this.s.devices.some(x => x.imei === d.imei)) this.fail(`IMEI ${d.imei} is already registered.`);
    const v = {
      id: this.id('DEV'),
      imei: d.imei,
      productId: d.productId,
      condition: d.condition || 'New',
      status: 'In Stock',
      applicationId: null,
      history: []
    };
    this.s.devices.push(v);
    this.devEvent(v, 'Registered into stock');
    this.log('DEVICE', v.id, `Registered IMEI ${v.imei}`);
    return v;
  }

  devEvent(d, event) {
    (d.history = d.history || []).push({
      date: this.s.date,
      ts: new Date().toISOString(),
      by: this.role,
      event
    });
  }

  freeDevice(productId) {
    return this.s.devices.find(d => d.productId === productId && d.status === 'In Stock');
  }

  setQuarantine(id, on, reason) {
    this.need('device.manage');
    const d = this.device(id);
    if (on) {
      if (d.status !== 'In Stock') this.fail('Only in-stock devices can be quarantined.');
      d.status = 'Quarantined';
    } else {
      if (d.status !== 'Quarantined') this.fail('Device is not quarantined.');
      d.status = 'In Stock';
    }
    this.devEvent(d, `${on ? 'Quarantined' : 'Released from quarantine'}: ${reason || 'no reason given'}`);
    this.log('DEVICE', d.id, `${on ? 'Quarantined' : 'Released'}: ${reason || 'no reason given'}`);
  }

  reserveDevice(appId, devId) {
    this.need('device.manage');
    const a = this.app(appId), d = this.device(devId);
    if (!['Agreement Pending', 'Deposit Pending'].includes(a.status)) {
      this.fail(`Application is ${a.status}. A phone can be reserved once the application is approved.`);
    }
    if (a.deviceId) this.fail('A device is already reserved for this application.');
    if (d.productId !== a.offer.productId) this.fail('Device model does not match the approved product.');
    if (d.status !== 'In Stock') this.fail(`Device is not available (status: ${d.status}).`);
    d.status = 'Reserved';
    d.applicationId = a.id;
    a.deviceId = d.id;
    this.devEvent(d, `Reserved for ${a.ref}`);
    this.log('DEVICE', d.id, `Reserved for ${a.ref}`);
    this.checkReady(a);
    return d;
  }

  releaseDevice(a, why) {
    if (!a.deviceId) return;
    const d = this.device(a.deviceId);
    if (d.status === 'Reserved') {
      d.status = 'In Stock';
      d.applicationId = null;
      this.devEvent(d, `Reservation released: ${why}`);
      this.log('DEVICE', d.id, `Reservation released: ${why}`);
    }
    a.deviceId = null;
  }

  /* ---------- applications ---------- */
  setApp(a, to, note = '') {
    a.history.push({ date: this.s.date, ts: Date.now(), by: this.role, from: a.status, to, note });
    this.log('STATUS', a.ref, `${a.status} to ${to}${note ? ': ' + note : ''}`);
    a.status = to;
  }

  isOpenApp(a) {
    return !['Rejected', 'Cancelled', 'Expired', 'Activated'].includes(a.status);
  }

  createApplication({ customerId, pricingId, agent }) {
    this.need('app.create');
    const c = this.cust(customerId), p = this.pricing(pricingId);
    if (!this.pricingAvailable(p)) this.fail('That product and duration is not available for new applications.');
    if (this.s.settings.oneActiveApp && this.s.apps.some(x => x.customerId === c.id && this.isOpenApp(x))) {
      this.fail(`${c.name} already has an open application.`);
    }
    const a = {
      id: this.id('APP'),
      ref: '',
      customerId: c.id,
      pricingId: p.id,
      status: 'Draft',
      docs: {},
      assessment: null,
      offer: null,
      agreement: null,
      deviceId: null,
      leaseId: null,
      createdBy: this.role,
      agent: this.role === 'Sales Agent' ? (this.s.settings.agents.includes(agent) ? agent : this.s.settings.agents[0]) : 'Customer self-service',
      createdAt: this.s.date,
      history: [],
      decision: null,
      expiresAt: null
    };
    a.ref = a.id;
    this.s.apps.push(a);
    this.setApp(a, 'Draft', 'Application started');
    a.history[0].from = '-';
    return a;
  }

  uploadDoc(appId, kind, name, sizeKB) {
    this.need('app.create');
    const a = this.app(appId);
    if (!['Draft', 'More Information Required'].includes(a.status)) {
      this.fail('Documents can only be changed while the application is a draft or needs more information.');
    }
    if (!DOC_KINDS[kind]) this.fail('Unknown document type.');
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) this.fail('Unsupported file type. Upload a PDF, JPG or PNG.');
    if (sizeKB > 5120) this.fail('File is larger than the 5 MB limit.');
    a.docs[kind] = { name, sizeKB, at: this.s.date };
    this.log('DOC', a.ref, `${DOC_KINDS[kind]} uploaded (${name})`);
  }

  submitApplication(appId) {
    this.need('app.submit');
    const a = this.app(appId), c = this.cust(a.customerId);
    if (!['Draft', 'More Information Required'].includes(a.status)) {
      this.fail(`Application is already ${a.status}.`);
    }
    const miss = [];
    if (!c.consent.given) miss.push('customer consent');
    Object.keys(DOC_KINDS).forEach(k => {
      if (!a.docs[k]) miss.push(DOC_KINDS[k]);
    });
    if (miss.length) this.fail('Cannot submit. Missing: ' + miss.join(', ') + '.');
    if (c.kyc.status === 'Failed') {
      this.fail('Identity verification failed for this customer. Resolve it under policy before resubmitting.');
    }
    a.review = null;
    a.escalation = null;
    a.submittedAt = this.s.date;
    a.queue = { assignedTo: 'Credit/Risk Officer', due: D.addDays(this.s.date, this.s.settings.reviewSlaDays) };
    this.setApp(a, 'Submitted', 'Mandatory fields validated. Entered the approval queue');
    return a;
  }

  startReview(a) {
    if (a.status === 'Submitted') this.setApp(a, 'Under Review', 'Checks started');
  }

  verifyKyc(appId, result, note) {
    this.need('kyc.verify');
    const a = this.app(appId), c = this.cust(a.customerId);
    if (!['Submitted', 'Under Review'].includes(a.status)) {
      this.fail('KYC can only be recorded on a submitted application.');
    }
    if (!['Verified', 'Failed'].includes(result)) this.fail('Result must be Verified or Failed.');
    this.startReview(a);
    c.kyc = { status: result, by: this.role, at: this.s.date, note: note || '' };
    this.log('KYC', c.id, `${result}: ${note || ''}`);
    if (a.assessment) this.computeAssessment(a);
    return c;
  }

  claimReview(appId) {
    this.need('kyc.verify');
    const a = this.app(appId);
    if (a.status !== 'Submitted') this.fail('Only a submitted application can be picked up for review.');
    a.queue = { ...(a.queue || {}), assignedTo: this.role, pickedUpAt: this.s.date };
    this.startReview(a);
  }

  verifyReview(appId, { documents, terms, note }) {
    this.need('kyc.verify');
    const a = this.app(appId);
    if (!['Submitted', 'Under Review'].includes(a.status)) {
      this.fail('Documents and terms can only be verified on an application in review.');
    }
    this.startReview(a);
    a.review = { documents: !!documents, terms: !!terms, note: note || '', by: this.role, at: this.s.date };
    this.log('REVIEW', a.ref, `Documents ${documents ? 'verified' : 'not verified'}; lease terms ${terms ? 'verified' : 'not verified'}`);
    return a.review;
  }

  requiredApprover(a) {
    const S = this.s.settings, t = (a.offer || this.buildOffer(this.pricing(a.pricingId))).total;
    return t <= S.approverLimit ? 'Approver' : t <= S.seniorLimit ? 'Senior Approver' : 'Super Admin';
  }

  assess(appId, inp) {
    this.need('kyc.verify');
    const a = this.app(appId);
    if (!['Submitted', 'Under Review'].includes(a.status)) {
      this.fail('Assessment can only be recorded on an application in review.');
    }
    const i = typeof inp === 'number' ? { income: inp } : { ...inp };
    i.source = i.source || 'Salaried';
    i.obligations = i.obligations || 0;
    i.cashflow = i.cashflow || 0;
    if (!['Salaried', 'Business', 'Casual'].includes(i.source)) this.fail('Choose an income source.');
    if (i.source === 'Business') {
      if (!(i.cashflow > 0)) this.fail('Enter the average monthly net cash flow from the business statements.');
    } else if (!(i.income > 0)) {
      this.fail('Enter the customer\'s monthly income.');
    }
    if (i.obligations < 0) this.fail('Existing obligations cannot be negative.');
    this.startReview(a);
    a.assessment = {
      inputs: {
        income: i.income || 0,
        source: i.source,
        obligations: i.obligations,
        cashflow: i.cashflow,
        fraudSuspected: !!i.fraudSuspected,
        notes: i.notes || ''
      },
      by: this.role,
      at: this.s.date
    };
    const r = this.computeAssessment(a);
    this.log('ASSESS', a.ref, `Score ${r.score} (${r.band}), advisory: ${r.recommendation}`);
    return r;
  }

  computeAssessment(a) {
    const S = this.s.settings,
      I = a.assessment.inputs,
      c = this.cust(a.customerId),
      offer = a.offer || this.buildOffer(this.pricing(a.pricingId));
    const inst = Math.max(...offer.installments);
    const basis = I.source === 'Business' ? I.cashflow : I.source === 'Casual' ? Math.round(I.income * 0.8) : I.income;
    const ratio = Math.round((inst / basis) * 1000) / 10;
    const dsr = Math.round(((I.obligations + inst) / basis) * 1000) / 10;
    const hist = this.paymentHistory(c.id);
    const flags = this.fraudFlags(a, I);
    const exposureAfter = hist.exposure + offer.total;
    const age = Math.floor(D.diff(this.s.date, c.dob) / 365.25);
    const elig = [
      { rule: `Customer is at least ${S.minAge} years old`, ok: age >= S.minAge },
      { rule: `Income basis is at least ${money(S.minIncome)} a month`, ok: basis >= S.minIncome },
      { rule: `Leases above ${money(S.premiumThreshold)} need income of ${money(S.premiumMinIncome)} or more`, ok: offer.total <= S.premiumThreshold || basis >= S.premiumMinIncome },
      { rule: 'No installment overdue beyond grace on an existing lease', ok: hist.currentOverdue === 0 },
      { rule: `No more than ${S.maxActiveLeases} active leases`, ok: hist.activeLeases < S.maxActiveLeases }
    ];
    const kyc = c.kyc.status;
    const hi = flags.filter(f => f.sev === 'high').length;
    const med = flags.filter(f => f.sev === 'medium').length;
    const aff = ratio <= S.affordability / 2 ? 25 : ratio <= S.affordability ? 18 : ratio <= S.affordability * 1.25 ? 8 : 0;
    const cap = dsr <= 40 ? 15 : dsr <= S.maxDsr ? 9 : 0;
    const histPts = hist.installments === 0 ? 12 : Math.min(hist.currentOverdue ? 5 : 20, Math.round((hist.onTime / hist.installments) * 20));
    const comps = [
      { name: 'Identity verification', pts: kyc === 'Verified' ? 15 : 0, max: 15, basis: `KYC is ${kyc.toLowerCase()}` },
      { name: 'Affordability', pts: aff, max: 25, basis: `Installment is ${ratio}% of income (limit ${S.affordability}%)` },
      { name: 'Repayment capacity', pts: cap, max: 15, basis: `Obligations plus installment are ${dsr}% of income (limit ${S.maxDsr}%)` },
      { name: 'Payment history with us', pts: histPts, max: 20, basis: hist.installments ? `${hist.onTime} of ${hist.installments} installments on time` : 'No history. Scored neutral' },
      { name: 'Fraud and duplicates', pts: Math.max(0, 15 - hi * 10 - med * 5), max: 15, basis: flags.length ? `${flags.length} indicator${flags.length > 1 ? 's' : ''} found` : 'No indicators found' },
      { name: 'Risk limits', pts: exposureAfter <= S.exposureLimit ? 10 : 0, max: 10, basis: `Exposure after approval ${money(exposureAfter)} (limit ${money(S.exposureLimit)})` }
    ];
    const score = comps.reduce((s, x) => s + x.pts, 0);
    const hardStops = [];
    if (kyc === 'Failed') hardStops.push('identity verification failed');
    if (exposureAfter > S.exposureLimit) hardStops.push(`exposure of ${money(exposureAfter)} is above the ${money(S.exposureLimit)} limit`);
    elig.filter(x => !x.ok).forEach(x => hardStops.push('product eligibility: ' + x.rule.toLowerCase()));
    if (hi) hardStops.push('unresolved high-severity fraud indicator');
    const recommendation = hardStops.length ? 'Reject' : score >= 75 ? 'Approve' : score >= 55 ? 'Refer' : 'Reject';
    Object.assign(a.assessment, {
      basis,
      inst,
      ratio,
      dsr,
      disposable: basis - I.obligations,
      hist,
      flags,
      elig,
      comps,
      score,
      band: score >= 75 ? 'Low risk' : score >= 55 ? 'Medium risk' : 'High risk',
      recommendation,
      hardStops,
      exposureAfter,
      income: I.income,
      result: ratio <= S.affordability ? 'Pass' : 'Refer'
    });
    return a.assessment;
  }

  getAssessment(appId) {
    this.need('risk.view');
    return this.app(appId).assessment;
  }

  paymentHistory(cid) {
    const ls = this.s.leases.filter(l => l.customerId === cid && l.activationDate);
    let n = 0, onTime = 0, maxLate = 0, curOver = 0;
    for (const L of ls) {
      for (const i of L.installments) {
        const o = this.instOutstanding(L, i);
        if (o > 0 && i.due > this.s.date) continue;
        let days;
        if (o > 0) {
          days = Math.max(0, D.diff(this.s.date, i.due));
        } else {
          const last = this.s.ledger
            .filter(e => e.leaseId === L.id && e.allocations.some(x => x.target === i.id))
            .reduce((m, e) => (e.date > m ? e.date : m), '0000');
          days = Math.max(0, D.diff(last, i.due));
        }
        n++;
        if (days <= L.terms.graceDays) onTime++;
        maxLate = Math.max(maxLate, days);
        if (o > 0 && days > L.terms.graceDays) curOver++;
      }
    }
    const open = ls.filter(l => !l.closed && !l.terminated);
    return {
      leases: ls.length,
      closed: ls.filter(l => l.closed).length,
      installments: n,
      onTime,
      late: n - onTime,
      maxDaysLate: maxLate,
      currentOverdue: curOver,
      activeLeases: open.length,
      exposure: open.reduce((s, l) => s + this.outstanding(l), 0),
      disputes: this.s.disputes.filter(d => ls.some(l => l.id === d.leaseId)).length
    };
  }

  fraudFlags(a, I) {
    const f = [], c = this.cust(a.customerId), A = this.s.apps;
    const dup = this.s.customers.filter(x => x.id !== c.id && (x.idNo === c.idNo || x.phone === c.phone));
    if (dup.length) f.push({ sev: 'high', text: `National ID or phone number also appears on ${dup.map(x => x.id).join(', ')}` });
    const other = A.filter(x => x.id !== a.id && x.customerId === c.id && this.isOpenApp(x));
    if (other.length) f.push({ sev: 'medium', text: `Another open application exists (${other[0].ref})` });
    if (A.some(x => x.id !== a.id && x.customerId === c.id && x.status === 'Rejected' && D.diff(this.s.date, (x.decision && x.decision.at) || x.createdAt) <= 30)) {
      f.push({ sev: 'medium', text: 'Re-applied within 30 days of a rejection' });
    }
    for (const [k, d] of Object.entries(a.docs)) {
      const same = A.find(x => x.id !== a.id && x.customerId !== c.id && x.docs[k] && x.docs[k].name === d.name && x.docs[k].sizeKB === d.sizeKB);
      if (same) f.push({ sev: 'high', text: `${DOC_KINDS[k]} is an identical file to one on ${same.ref}` });
    }
    if (I && I.fraudSuspected) f.push({ sev: 'high', text: 'Reviewer suspects fraud: ' + (I.notes || 'no note given') });
    return f;
  }

  recordDecision(a, d) {
    const all = [...REASON_CODES.reject, ...REASON_CODES.info, ...REASON_CODES.hold];
    const lab = (all.find(r => r[0] === d.code) || [])[1] || '';
    const asm = a.assessment;
    (a.decisions = a.decisions || []).push({
      id: this.id('DEC'),
      ts: new Date().toISOString(),
      date: this.s.date,
      by: this.role,
      outcome: d.outcome,
      code: d.code || '',
      label: lab,
      reason: d.reason || '',
      score: asm ? asm.score : null,
      recommendation: asm ? asm.recommendation : null,
      deviated: !!d.deviated
    });
  }

  decide(appId, decision, reason, code) {
    if (!['approve', 'reject', 'info', 'hold'].includes(decision)) this.fail('Unknown decision.');
    const a = this.app(appId);
    this.need(['approve', 'reject'].includes(decision) ? 'app.decide' : 'app.refer');
    reason = (reason || '').trim();
    if (['approve', 'reject'].includes(decision) && a.createdBy === this.role) {
      this.log('DENIED', a.ref, `${this.role} tried to decide an application they created`, 'SECURITY');
      this.fail('Segregation of duties: you cannot decide an application you created.');
    }
    if (decision === 'approve') {
      if (a.status === 'Submitted') this.fail('Mandatory checks are incomplete. Start KYC and affordability review first.');
      if (a.status !== 'Under Review') this.fail(`Application is ${a.status} and cannot be approved.`);
      const c = this.cust(a.customerId);
      if (c.kyc.status !== 'Verified') this.fail(`KYC is ${c.kyc.status.toLowerCase()}. Approval is blocked until identity is verified.`);
      if (!a.assessment) this.fail('The credit assessment has not been recorded.');
      if (!(a.review && a.review.documents && a.review.terms)) {
        this.fail('The reviewer has not confirmed that documents and lease terms were verified.');
      }
      const p = this.pricing(a.pricingId);
      if (!this.pricingAvailable(p) && !a.offer) {
        this.fail('This pricing is no longer available. Change the product terms and re-run review.');
      }
      const asm = this.computeAssessment(a);
      if (asm.hardStops.length) this.fail('Policy blocks approval: ' + asm.hardStops.join('; ') + '.');
      const rank = { 'Approver': 1, 'Senior Approver': 2, 'Super Admin': 3 };
      const need = this.requiredApprover(a);
      const total = this.buildOffer(p).total;
      if (rank[this.role] < rank[need]) {
        this.fail(`Total ${money(total)} is above the ${this.role} limit of ${money(this.role === 'Approver' ? this.s.settings.approverLimit : this.s.settings.seniorLimit)}. Escalate it to a ${need}.`);
      }
      if (a.escalation && rank[this.role] < rank[a.escalation.to]) {
        this.fail(`This application was escalated to a ${a.escalation.to}.`);
      }
      const dev = asm.recommendation !== 'Approve';
      if (dev && !reason) {
        this.fail(`The advisory score recommends "${asm.recommendation}". Enter your reason to approve against it.`);
      }
      a.offer = this.buildOffer(p);
      a.decision = { by: this.role, at: this.s.date, result: 'Approved', reason };
      a.expiresAt = D.addDays(this.s.date, this.s.settings.reservationDays);
      this.recordDecision(a, { outcome: 'Approved', reason, deviated: dev });
      this.setApp(a, 'Approved', reason || 'Within policy and delegated limits');
      this.newAgreement(a);
      this.setApp(a, 'Agreement Pending', `Agreement ${a.agreement.id} version ${a.agreement.version} generated from price version ${a.offer.pricingVersion}. Phone can now be reserved. Handover still needs signatures and the deposit.`);
      return a;
    }
    if (!['Submitted', 'Under Review'].includes(a.status)) {
      this.fail(`Application is ${a.status}; this decision is not available.`);
    }
    if (!REASON_CODES[decision].some(r => r[0] === code)) this.fail('Choose a reason code.');
    if (!reason) this.fail('Add a short explanation for the record.');
    const out = { reject: 'Rejected', info: 'More Information Required', hold: 'On Hold' }[decision];
    if (decision === 'reject') a.decision = { by: this.role, at: this.s.date, result: 'Rejected', reason, code };
    this.recordDecision(a, { outcome: out, code, reason });
    this.setApp(a, out, reason);
    return a;
  }

  resumeHold(appId, reason) {
    this.need('app.refer');
    const a = this.app(appId);
    if (a.status !== 'On Hold') this.fail('This application is not on hold.');
    if (!reason) this.fail('Say why the hold is lifted.');
    this.recordDecision(a, { outcome: 'Hold lifted', reason });
    this.setApp(a, 'Under Review', 'Hold lifted: ' + reason);
  }

  escalate(appId, reason) {
    this.need('app.refer');
    const a = this.app(appId);
    if (!['Submitted', 'Under Review'].includes(a.status)) this.fail('Only an application in review can be escalated.');
    if (!reason) this.fail('Say why it is being escalated.');
    const req = this.requiredApprover(a);
    a.escalation = { by: this.role, at: this.s.date, reason, to: req === 'Approver' ? 'Senior Approver' : req };
    a.queue = { ...(a.queue || {}), assignedTo: a.escalation.to };
    this.recordDecision(a, { outcome: 'Escalated to ' + a.escalation.to, reason });
    this.log('ESCALATE', a.ref, `To ${a.escalation.to}: ${reason}`);
  }

  reopen(appId, reason) {
    this.need('app.decide');
    const a = this.app(appId);
    if (a.status !== 'Rejected') this.fail('Only rejected applications can be reopened.');
    if (!reason) this.fail('A reason is required to reopen.');
    a.reopened = (a.reopened || 0) + 1;
    this.recordDecision(a, { outcome: 'Reopened', reason });
    this.setApp(a, 'Under Review', 'Reopened: ' + reason);
  }

  cancelApplication(appId, reason) {
    this.need('app.cancel');
    const a = this.app(appId);
    if (!this.isOpenApp(a)) this.fail(`Application is already ${a.status}.`);
    this.releaseDevice(a, 'application cancelled');
    this.setApp(a, 'Cancelled', reason || 'Cancelled');
  }

  /* ---------- agreement ---------- */
  agreementDoc(a) {
    const S = this.s.settings,
      c = this.cust(a.customerId),
      o = a.offer,
      p = this.product(o.productId),
      dev = a.deviceId ? this.device(a.deviceId) : null;
    const fill = t =>
      t.replace(/\{(\w+)\}/g, (m, k) => ({ phone: c.phone, paybill: S.paybill, grace: o.graceDays, company: S.company })[k] ?? m);
    return {
      company: S.company,
      priceVersion: o.pricingVersion,
      sections: [
        { id: 'parties', title: 'Parties', rows: [['Lessor', S.company], ['Customer', c.name], ['National ID', c.idNo], ['Mobile number', c.phone], ['Customer number', c.id], ['Application', a.ref]] },
        { id: 'device', title: 'Device', rows: [['Description', `${p.brand} ${p.model} ${p.storage}, ${p.condition}`], ['IMEI', dev ? dev.imei : 'Recorded when a phone is reserved, and confirmed at handover'], ['Accessories', 'Recorded at handover']] },
        { id: 'term', title: 'Duration and commencement', rows: [['Lease duration', `${o.count} months`], ['Commencement', 'The day the phone is handed over'], ['First installment', 'One month after commencement'], ['Billing', 'Monthly']] },
        { id: 'schedule', title: 'Deposit and installment schedule', table: [['Deposit', 'Before handover', o.deposit], ...o.installments.map((x, i) => [`Installment ${i + 1}`, `${i + 1} month${i ? 's' : ''} after commencement`, x])] },
        { id: 'charges', title: 'Total payable and itemised charges', table: [['Deposit', '', o.deposit], [`Installments (${o.count})`, '', o.balance], ['Delivery, administration, insurance or any other charge', 'None', 0], ['Total payable', '', o.total]] },
        ...CLAUSE_KEYS.map(k => ({ id: k, title: CLAUSE_TITLES[k], text: fill(S.clauses[k]) }))
      ]
    };
  }

  newAgreement(a) {
    a.agreementVersion = (a.agreementVersion || 0) + 1;
    a.agreement = {
      id: this.id('AGR'),
      version: a.agreementVersion,
      offerVersion: a.offer.pricingVersion,
      generatedAt: this.s.date,
      accepted: false,
      customer: null,
      company: null,
      doc: null
    };
    a.agreement.doc = this.agreementDoc(a);
  }

  archiveAgreement(a, reason) {
    if (a.agreement) {
      (a.agreements = a.agreements || []).push({
        id: a.agreement.id,
        version: a.agreement.version,
        offerVersion: a.agreement.offerVersion,
        generatedAt: a.agreement.generatedAt,
        status: 'Superseded',
        supersededAt: this.s.date,
        reason
      });
      a.agreement = null;
    }
  }

  regenerateAgreement(appId) {
    this.need('agreement.generate');
    const a = this.app(appId);
    if (a.status !== 'Agreement Pending' || !a.agreement) {
      this.fail('An agreement can only be regenerated while it awaits signatures.');
    }
    if (a.agreement.customer || a.agreement.company) {
      this.fail('Signing has started on this version. Change the terms to issue a new version.');
    }
    this.archiveAgreement(a, 'Regenerated by staff');
    this.newAgreement(a);
    this.log('AGREEMENT', a.ref, `Version ${a.agreement.version} generated`);
  }

  changeTerms(appId, pricingId) {
    this.need('app.decide');
    const a = this.app(appId), p = this.pricing(pricingId);
    if (a.status !== 'Agreement Pending') {
      this.fail(a.agreement && a.agreement.accepted ? 'The agreement is signed, so its terms are fixed. Cancel this application and start a new one to change them.' : 'Terms can only be changed while the agreement awaits signatures.');
    }
    if (!this.pricingAvailable(p)) this.fail('Chosen pricing is not available.');
    this.archiveAgreement(a, 'Material terms changed after approval');
    a.pricingId = p.id;
    a.offer = null;
    a.review = null;
    a.escalation = null;
    if (a.deviceId && this.device(a.deviceId).productId !== p.productId) {
      this.releaseDevice(a, 'phone model changed');
    }
    this.recordDecision(a, { outcome: 'Terms changed', reason: 'Reapproval and a new agreement are required' });
    this.setApp(a, 'Under Review', 'Material terms changed. Reapproval and renewed acceptance are required');
  }

  acceptAgreement(appId, { acknowledged, signature }) {
    this.need('agreement.accept');
    const a = this.app(appId), c = this.cust(a.customerId);
    if (a.status !== 'Agreement Pending' || !a.agreement) {
      this.fail(`Agreement cannot be accepted while the application is ${a.status}.`);
    }
    if (a.agreement.customer) this.fail('The customer has already accepted this version.');
    if (!acknowledged) this.fail('The customer must confirm they have reviewed the total payable and schedule.');
    if (a.agreement.offerVersion !== a.offer.pricingVersion) {
      this.fail('Agreement does not match the approved offer version.');
    }
    const nm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (nm(signature) !== nm(c.name)) {
      this.fail('To sign, type the customer\'s full name exactly as registered.');
    }
    a.agreement.customer = {
      name: c.name,
      signedAs: signature.trim(),
      at: this.s.date,
      ts: new Date().toISOString(),
      by: this.role
    };
    this.log('AGREEMENT', a.ref, `Version ${a.agreement.version} signed by the customer`);
    return this.finalizeAgreement(a);
  }

  authorizeAgreement(appId) {
    this.need('agreement.authorize');
    const a = this.app(appId);
    if (a.status !== 'Agreement Pending' || !a.agreement) {
      this.fail('There is no agreement awaiting company authorization.');
    }
    if (a.agreement.company) this.fail('The company has already authorized this version.');
    if (a.createdBy === this.role) {
      this.log('DENIED', a.ref, 'Creator tried to authorize the agreement', 'SECURITY');
      this.fail('Segregation of duties: you cannot authorize an agreement for an application you created.');
    }
    a.agreement.company = { by: this.role, at: this.s.date, ts: new Date().toISOString() };
    this.log('AGREEMENT', a.ref, `Version ${a.agreement.version} authorized for ${this.s.settings.company}`);
    return this.finalizeAgreement(a);
  }

  finalizeAgreement(a) {
    const g = a.agreement;
    if (!g.customer || !g.company) return null;
    g.accepted = true;
    g.acceptedAt = this.s.date;
    g.doc = this.agreementDoc(a);
    const L = {
      id: this.id('LSE'),
      appId: a.id,
      customerId: a.customerId,
      terms: JSON.parse(JSON.stringify(a.offer)),
      agreementId: g.id,
      agreementVersion: g.version,
      signedOn: this.s.date,
      activationDate: null,
      installments: [],
      deviceId: null,
      ownership: null,
      closed: false,
      terminated: false,
      ownershipPending: false,
      handover: null
    };
    this.s.leases.push(L);
    a.leaseId = L.id;
    this.setApp(a, 'Deposit Pending', `Agreement signed by both parties. Deposit due before ${a.expiresAt}`);
    return L;
  }

  checkReady(a) {
    const L = this.leaseOfApp(a);
    if (!L) return;
    if (a.status === 'Deposit Pending' && this.depositOutstanding(L) <= 0 && a.deviceId) {
      this.setApp(a, 'Ready for Handover', 'Deposit verified and device reserved');
    } else if (a.status === 'Ready for Handover' && this.depositOutstanding(L) > 0) {
      this.setApp(a, 'Deposit Pending', 'Deposit no longer fully satisfied');
    }
  }

  handover(appId, { accessories, condition, customerConfirmed }) {
    this.need('handover');
    const a = this.app(appId), L = this.leaseOfApp(a);
    if (!L || !a.agreement || !a.agreement.accepted) this.fail('Handover blocked: agreement acceptance is missing.');
    if (this.depositOutstanding(L) > 0) this.fail(`Handover blocked: deposit of ${money(this.depositOutstanding(L))} is not confirmed.`);
    if (a.status !== 'Ready for Handover') this.fail(`Handover blocked: application is ${a.status}.`);
    const d = a.deviceId && this.device(a.deviceId);
    if (!d || d.status !== 'Reserved' || d.applicationId !== a.id) this.fail('Handover blocked: no valid reserved device.');
    if (!customerConfirmed) this.fail('The customer must confirm receipt of the phone.');
    this.atomic(() => {
      d.status = 'Issued';
      L.deviceId = d.id;
      this.devEvent(d, `Issued to ${this.cust(a.customerId).name} on lease ${L.id}`);
      L.activationDate = this.s.date;
      L.installments = L.terms.installments.map((amt, i) => ({
        id: `${L.id}-I${i + 1}`,
        no: i + 1,
        due: D.addMonths(this.s.date, i + 1),
        amount: amt
      }));
      L.handover = { by: this.role, date: this.s.date, imei: d.imei, accessories: accessories || '', condition: condition || '' };
      a.agreement.handoverRecord = { ...L.handover };
      this.setApp(a, 'Activated', `Phone issued (IMEI ${d.imei}). First installment due ${L.installments[0].due}`);
    });
    return L;
  }

  cancelHandover(appId, reason) {
    this.need('handover');
    const a = this.app(appId);
    if (a.status !== 'Ready for Handover') this.fail('Only a pending handover can be cancelled.');
    this.releaseDevice(a, reason || 'handover cancelled');
    this.setApp(a, 'Deposit Pending', 'Handover cancelled: ' + (reason || 'no reason'));
  }

  /* ---------- ledger-derived balances ---------- */
  entries(L) {
    return this.s.ledger.filter(e => e.leaseId === L.id);
  }

  paidOn(L, target) {
    let s = 0;
    for (const e of this.entries(L)) for (const x of e.allocations) if (x.target === target) s += x.amount;
    return s;
  }

  totalPaid(L) {
    let s = 0;
    for (const e of this.entries(L)) for (const x of e.allocations) s += x.amount;
    return s;
  }

  depositOutstanding(L) {
    return L.terms.deposit - this.paidOn(L, 'deposit');
  }

  instOutstanding(L, i) {
    return i.amount - this.paidOn(L, i.id);
  }

  outstanding(L) {
    return L.terms.total - this.totalPaid(L);
  }

  creditBalance(L) {
    return this.entries(L).reduce((s, e) => s + (e.credit || 0), 0);
  }

  openDisputes(L) {
    return this.s.disputes.filter(d => d.leaseId === L.id && d.status === 'Open');
  }

  instState(L, i) {
    const o = this.instOutstanding(L, i),
      paid = i.amount - o,
      t = this.s.date,
      g = L.terms.graceDays;
    const dis = this.openDisputes(L).some(d => !d.instId || d.instId === i.id);
    let st;
    if (o <= 0) st = 'Paid';
    else if (t < i.due) st = paid > 0 ? 'Partially Paid' : 'Scheduled';
    else if (t === i.due) st = paid > 0 ? 'Partially Paid' : 'Due';
    else if (t <= D.addDays(i.due, g)) st = 'Grace Period';
    else st = 'Overdue';
    return { status: st, outstanding: o, paid, partial: paid > 0 && o > 0, disputed: dis, daysPast: Math.max(0, D.diff(t, i.due)) };
  }

  leaseStatus(L) {
    const flags = [];
    if (this.openDisputes(L).length) flags.push('Disputed');
    if (L.terminated) return { status: 'Terminated', flags };
    if (L.closed) return { status: 'Closed', flags };
    if (!L.activationDate) return { status: 'Pending Activation', flags };
    if (this.outstanding(L) <= 0) return { status: L.ownershipPending ? 'Ownership Transfer Pending' : 'Fully Paid', flags };
    if (this.s.payments.some(p => p.leaseId === L.id && p.purpose === 'settlement' && p.status === 'Pending')) {
      return { status: 'Settlement Pending', flags };
    }
    const st = L.installments.map(i => this.instState(L, i));
    let status = 'Active';
    if (st.some(x => x.status === 'Overdue')) {
      status = this.s.tasks.some(t => t.leaseId === L.id && t.status !== 'Resolved') ? 'Collections' : 'Overdue';
    } else if (st.some(x => x.status === 'Grace Period')) {
      status = 'Grace Period';
    } else if (st.some(x => x.partial)) {
      status = 'Partially Paid';
    }
    return { status, flags };
  }

  nextInstallment(L) {
    return L.installments.find(i => this.instOutstanding(L, i) > 0);
  }

  /* ---------- posting & allocations ---------- */
  allocate(L, purpose, amount, target) {
    const allocs = [];
    let rem = amount;
    if (purpose === 'deposit') {
      const a = Math.min(this.depositOutstanding(L), rem);
      if (a > 0) {
        allocs.push({ target: 'deposit', amount: a });
        rem -= a;
      }
    } else {
      const t = this.s.date,
        order = [...L.installments].sort((a, b) => (a.due < b.due ? -1 : 1));
      const nextUp = order.find(i => i.due > t && this.instOutstanding(L, i) > 0);
      const elig = order.filter(i => purpose === 'settlement' || i.due <= t || i === nextUp || i.id === target);
      if (target) {
        const k = elig.findIndex(x => x.id === target);
        if (k > 0) elig.unshift(elig.splice(k, 1)[0]);
      }
      for (const i of elig) {
        if (rem <= 0) break;
        const o = this.instOutstanding(L, i);
        if (o > 0) {
          const a = Math.min(o, rem);
          allocs.push({ target: i.id, amount: a });
          rem -= a;
        }
      }
    }
    return { allocs, credit: rem };
  }

  entry(L, e) {
    const x = {
      id: this.id('LED'),
      date: this.s.date,
      ts: Date.now(),
      leaseId: L.id,
      by: this.role,
      cash: 0,
      credit: 0,
      allocations: [],
      ...e
    };
    this.s.ledger.push(x);
    return x;
  }

  postPayment(p, amount, receipt) {
    const L = this.lease(p.leaseId);
    const { allocs, credit } = this.allocate(L, p.purpose, amount, p.installmentId);
    const en = this.entry(L, { type: 'PAYMENT', paymentId: p.id, receipt, cash: amount, allocations: allocs, credit });
    p.status = 'Success';
    p.providerTxId = receipt;
    p.recon = 'Matched';
    p.confirmedAt = this.s.date;
    p.ledgerId = en.id;
    this.s.receipts[receipt] = p.id;
    this.afterPosting(L);
    return en;
  }

  afterPosting(L) {
    for (const t of this.s.tasks) {
      if (t.leaseId === L.id && t.status !== 'Resolved') {
        const i = L.installments.find(x => x.id === t.instId);
        if (i && this.instOutstanding(L, i) <= 0) {
          t.status = 'Resolved';
          t.resolvedNote = 'Installment paid';
        }
      }
    }
    if (L.activationDate && this.outstanding(L) > 0) L.ownershipPending = false;
    const a = this.app(L.appId);
    this.checkReady(a);
    if (this.s.settings.autoOwnership && L.activationDate && !L.closed && !L.ownership && this.outstanding(L) <= 0 && this.completionChecks(L).every(x => x.ok)) {
      this.as('System', () => this.performTransfer(L));
    }
  }

  applyCredit(L) {
    let cr = this.creditBalance(L);
    if (cr <= 0) return;
    for (const i of L.installments) {
      if (cr <= 0) break;
      if (i.due > this.s.date) break;
      const o = this.instOutstanding(L, i);
      if (o > 0) {
        const a = Math.min(o, cr);
        this.entry(L, {
          type: 'CREDIT_APPLY',
          allocations: [{ target: i.id, amount: a }],
          credit: -a,
          reason: 'Customer credit applied to due installment'
        });
        cr -= a;
      }
    }
    this.afterPosting(L);
  }

  /* ---------- M-PESA simulation & processing ---------- */
  settlementQuote(L) {
    if (!L.activationDate || L.closed) this.fail('A settlement quote is only available for an active lease.');
    const gross = L.installments.reduce((s, i) => s + this.instOutstanding(L, i), 0),
      cr = this.creditBalance(L);
    return {
      amount: Math.max(0, gross - cr),
      gross,
      credit: cr,
      note: 'Remaining contractual balance. No penalty and no rebate is applied because neither is in the signed agreement.'
    };
  }

  initiateStk({ appId, purpose, installmentId, phone }) {
    this.need('payment.initiate');
    const a = this.app(appId), L = this.leaseOfApp(a), c = this.cust(a.customerId);
    if (!L) this.fail('There is no signed agreement to collect against.');
    if (!['deposit', 'installment', 'settlement'].includes(purpose)) this.fail('Unknown payment purpose.');
    let amount, target = null;
    if (purpose === 'deposit') {
      if (!['Deposit Pending', 'Ready for Handover'].includes(a.status)) {
        this.fail('Deposit cannot be collected at this stage.');
      }
      amount = this.depositOutstanding(L);
      if (amount <= 0) this.fail('Deposit is already fully paid.');
    } else {
      if (!L.activationDate || L.closed || L.terminated) this.fail('This lease is not collecting installments.');
      if (purpose === 'installment') {
        const i = installmentId ? L.installments.find(x => x.id === installmentId) : this.nextInstallment(L);
        if (!i) this.fail('No installment is outstanding.');
        target = i.id;
        amount = this.instOutstanding(L, i);
        if (amount <= 0) this.fail('That installment is already paid and cannot be charged again.');
      } else {
        amount = this.settlementQuote(L).amount;
      }
      if (amount <= 0) this.fail('Nothing is owed.');
    }
    const ph = normPhone(phone || c.phone);
    if (!ph) this.fail('Phone number is not a valid M-PESA number.');
    if (this.s.payments.some(p => p.leaseId === L.id && p.purpose === purpose && p.installmentId === target && p.status === 'Pending')) {
      this.fail('A payment prompt for this item is already waiting for the customer.');
    }
    const key = `${L.id}:${purpose}:${target || '-'}:${amount}:${this.entries(L).length}`;
    const p = {
      id: this.id('PAY'),
      leaseId: L.id,
      customerId: c.id,
      channel: 'STK Push',
      purpose,
      installmentId: target,
      amount,
      currency: 'KES',
      phone: ph,
      idemKey: key,
      status: 'Pending',
      requestedAt: this.s.date,
      requestedBy: this.role,
      recon: 'Awaiting provider',
      checkoutRequestId: null,
      merchantRequestId: null,
      providerTxId: null
    };
    this.s.payments.push(p);
    if (this.s.sim.providerDown) {
      p.status = 'Initiation Failed';
      p.recon = 'Retry allowed';
      p.resultDesc = 'Provider unavailable. Nothing was charged.';
      this.log('PAYMENT', p.id, 'Provider unavailable before submission; kept retryable, not paid', 'WARN');
      return p;
    }
    p.checkoutRequestId = 'ws_CO_' + this.s.date.replace(/-/g, '') + String(this.s.seq.PAY).padStart(6, '0');
    p.merchantRequestId = 'MR-' + this.s.seq.PAY;
    p.providerResponse = { ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' };
    this.log('PAYMENT', p.id, `STK Push ${purpose} for ${money(amount)} sent to ${ph}. Request accepted; this is not proof of payment.`);
    return p;
  }

  receiveCallback(cb) {
    const ev = { id: this.id('EVT'), date: this.s.date, ts: Date.now(), kind: 'STK', payload: cb, status: 'Received', note: '', paymentId: null };
    this.s.events.push(ev);
    if (!cb.authentic) {
      ev.status = 'Rejected';
      ev.note = 'Origin could not be authenticated. Ignored.';
      this.log('CALLBACK', ev.id, 'Unauthenticated callback rejected', 'SECURITY');
      return ev;
    }
    const p = this.s.payments.find(x => x.checkoutRequestId === cb.CheckoutRequestID);
    if (!p) {
      ev.status = 'Unmatched';
      ev.note = 'No payment request matches this reference. Recorded for investigation; nobody was credited.';
      return ev;
    }
    ev.paymentId = p.id;
    return this.runEvent(ev);
  }

  runEvent(ev) {
    try {
      this.processEvent(ev);
    } catch (e) {
      ev.status = 'Retry queued';
      ev.note = e.message;
      this.log('CALLBACK', ev.id, 'Posting failed, queued for safe retry: ' + e.message, 'WARN');
    }
    return ev;
  }

  processEvent(ev) {
    if (ev.kind === 'C2B') return this.processC2B(ev);
    const cb = ev.payload,
      p = this.s.payments.find(x => x.id === ev.paymentId);
    if (cb.ResultCode !== 0) {
      if (['Pending', 'Initiation Failed'].includes(p.status)) {
        p.status = cb.ResultCode === 1032 ? 'Cancelled' : cb.ResultCode === 1037 ? 'Expired' : 'Failed';
      }
      p.resultCode = cb.ResultCode;
      p.resultDesc = cb.ResultDesc;
      p.recon = 'Not collected';
      ev.status = 'Processed';
      ev.note = `Provider result ${cb.ResultCode}: nothing posted; amount stays outstanding.`;
      return;
    }
    if (this.s.receipts[cb.MpesaReceiptNumber] || ['Success', 'Reversed'].includes(p.status)) {
      ev.status = 'Duplicate';
      ev.note = 'Already posted. Acknowledged without a second posting.';
      return;
    }
    const bad =
      cb.Amount !== p.amount
        ? `Received ${money(cb.Amount)} but ${money(p.amount)} was requested.`
        : cb.PhoneNumber && cb.PhoneNumber !== p.phone
        ? 'Payer number differs from the number prompted.'
        : '';
    if (bad) {
      p.status = 'Quarantined';
      p.recon = 'Needs review';
      p.receivedAmount = cb.Amount;
      p.providerTxId = cb.MpesaReceiptNumber;
      p.resultCode = 0;
      ev.status = 'Quarantined';
      ev.note = bad + ' Held for Finance review; not applied.';
      this.log('RECON', p.id, bad, 'WARN');
      return;
    }
    this.atomic(() => {
      if (this.s.sim.failNextPost) {
        this.s.sim.failNextPost = false;
        throw new Error('Database error while posting. Transaction rolled back, callback kept for retry.');
      }
      this.postPayment(this.s.payments.find(x => x.id === p.id), cb.Amount, cb.MpesaReceiptNumber);
    });
    ev.status = 'Processed';
    ev.note = 'Posted once to the ledger.';
  }

  receiveC2B(cb) {
    const ev = { id: this.id('EVT'), date: this.s.date, ts: Date.now(), kind: 'C2B', payload: cb, status: 'Received', note: '', paymentId: null };
    this.s.events.push(ev);
    if (!cb.authentic) {
      ev.status = 'Rejected';
      ev.note = 'Origin could not be authenticated. Ignored.';
      this.log('CALLBACK', ev.id, 'Unauthenticated paybill notice rejected', 'SECURITY');
      return ev;
    }
    return this.runEvent(ev);
  }

  processC2B(ev) {
    const cb = ev.payload;
    if (this.s.receipts[cb.TransID]) {
      ev.status = 'Duplicate';
      ev.note = 'Transaction already posted.';
      return;
    }
    const L = this.s.leases.find(l => l.id === cb.BillRefNumber || this.s.apps.some(a => a.ref === cb.BillRefNumber && a.leaseId === l.id));
    if (!L || L.closed || L.terminated) {
      ev.status = 'Unmatched';
      ev.note = `Account reference "${cb.BillRefNumber}" matches no open lease. Recorded for investigation; nobody was credited.`;
      return;
    }
    this.atomic(() => {
      if (this.s.sim.failNextPost) {
        this.s.sim.failNextPost = false;
        throw new Error('Database error while posting. Transaction rolled back, notice kept for retry.');
      }
      const p = {
        id: this.id('PAY'),
        leaseId: L.id,
        customerId: L.customerId,
        channel: 'Paybill',
        purpose: L.activationDate ? 'installment' : 'deposit',
        installmentId: null,
        amount: cb.Amount,
        currency: 'KES',
        phone: cb.MSISDN,
        status: 'Pending',
        requestedAt: this.s.date,
        recon: '',
        providerTxId: cb.TransID,
        idemKey: cb.TransID
      };
      this.s.payments.push(p);
      ev.paymentId = p.id;
      this.postPayment(p, cb.Amount, cb.TransID);
    });
    ev.status = 'Processed';
    ev.note = 'Matched by account reference and posted once.';
  }

  retryEvent(id) {
    this.need('payment.reconcile');
    const ev = this.get('events', id, 'Event');
    if (ev.status !== 'Retry queued') this.fail('Only events waiting for retry can be retried.');
    return this.runEvent(ev);
  }

  resolveQuarantine(payId, decision, reason) {
    this.need('payment.reconcile');
    const p = this.pay(payId);
    if (p.status !== 'Quarantined') this.fail('This payment is not in the review queue.');
    if (!reason) this.fail('A reason is required to resolve a reconciliation exception.');
    if (decision === 'apply') {
      this.atomic(() => {
        this.postPayment(this.s.payments.find(x => x.id === payId), p.receivedAmount, p.providerTxId);
      });
      this.s.payments.find(x => x.id === payId).recon = 'Resolved: applied as received';
    } else {
      p.status = 'Rejected';
      p.recon = 'Resolved: not applied, refund payer';
    }
    this.log('RECON', p.id, `${decision}: ${reason}`);
  }

  reversePayment(payId, reason) {
    this.need('payment.reconcile');
    const p = this.pay(payId);
    if (p.status !== 'Success') this.fail('Only confirmed payments can be reversed.');
    if (!reason) this.fail('A reason is required.');
    const L = this.lease(p.leaseId);
    if (L.closed) this.fail('This lease is closed. Reversals need a controlled exception process.');
    const orig = this.s.ledger.find(e => e.paymentId === p.id && e.type === 'PAYMENT');
    if (orig.credit > this.creditBalance(L)) {
      this.fail('Part of this payment was held as credit and has been applied already. Use an approved adjustment.');
    }
    this.atomic(() => {
      this.entry(L, {
        type: 'REVERSAL',
        paymentId: p.id,
        reversalOf: orig.id,
        cash: -orig.cash,
        credit: -orig.credit,
        allocations: orig.allocations.map(x => ({ target: x.target, amount: -x.amount })),
        reason
      });
      this.s.payments.find(x => x.id === payId).status = 'Reversed';
      this.afterPosting(L);
    });
    this.log('PAYMENT', p.id, `Reversed: ${reason}. Linked reversal entry written; balances recalculated.`, 'WARN');
  }

  assignUnmatched(evId, leaseId, reason) {
    this.need('payment.reconcile');
    const ev = this.get('events', evId, 'Event');
    if (ev.status !== 'Unmatched' || ev.kind !== 'C2B') this.fail('Only unmatched paybill notices can be assigned.');
    if (!reason) this.fail('A reason is required.');
    const L = this.lease(leaseId);
    ev.payload.BillRefNumber = L.id;
    ev.status = 'Received';
    this.runEvent(ev);
    this.log('RECON', ev.id, `Assigned to ${L.id}: ${reason}`);
  }

  receiptNo() {
    this.s.seq.RCP = (this.s.seq.RCP || 0) + 1;
    return 'TJ' + (3200000 + this.s.seq.RCP * 7919).toString(36).toUpperCase().padStart(7, 'X');
  }

  simPay(payId, o = {}) {
    const p = this.pay(payId);
    const cb = {
      authentic: o.authentic !== false,
      CheckoutRequestID: p.checkoutRequestId,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      Amount: o.amount ?? p.amount,
      MpesaReceiptNumber: o.receipt || this.receiptNo(),
      PhoneNumber: o.phone || p.phone,
      Currency: 'KES'
    };
    this.as('M-PESA (simulated)', () => this.receiveCallback(cb));
    return cb;
  }

  simResult(payId, code) {
    const p = this.pay(payId);
    const cb = {
      authentic: true,
      CheckoutRequestID: p.checkoutRequestId,
      ResultCode: code,
      ResultDesc: code === 1032 ? 'Request cancelled by user' : code === 1037 ? 'DS timeout: customer did not respond' : 'The balance is insufficient',
      Currency: 'KES'
    };
    this.as('M-PESA (simulated)', () => this.receiveCallback(cb));
    return cb;
  }

  simC2B(o) {
    const cb = {
      authentic: o.authentic !== false,
      TransID: o.transId || this.receiptNo(),
      BillRefNumber: o.ref,
      Amount: o.amount,
      MSISDN: o.phone || '254700000000'
    };
    this.as('M-PESA (simulated)', () => this.receiveC2B(cb));
    return cb;
  }

  /* ---------- disputes, adjustments, collections ---------- */
  openDispute(leaseId, reason, instId) {
    this.need('dispute.manage');
    const L = this.lease(leaseId);
    if (!reason) this.fail('Describe what is being disputed.');
    const d = {
      id: this.id('DSP'),
      leaseId,
      instId: instId || null,
      reason,
      status: 'Open',
      openedAt: this.s.date,
      openedBy: this.role
    };
    this.s.disputes.push(d);
    this.log('DISPUTE', d.id, `Opened on ${L.id}: ${reason}`);
    return d;
  }

  resolveDispute(id, outcome) {
    this.need('dispute.manage');
    const d = this.get('disputes', id, 'Dispute');
    if (!outcome) this.fail('Record the outcome.');
    d.status = 'Resolved';
    d.outcome = outcome;
    d.resolvedAt = this.s.date;
    d.resolvedBy = this.role;
    this.log('DISPUTE', d.id, 'Resolved: ' + outcome);
  }

  requestAdjustment({ leaseId, type, target, amount, reason }) {
    this.need('adjust.request');
    const L = this.lease(leaseId);
    if (!reason) this.fail('Every adjustment needs a reason.');
    if (!(amount > 0)) this.fail('Enter an amount above zero.');
    let before;
    if (type === 'waiver') {
      const i = L.installments.find(x => x.id === target);
      if (!i) this.fail('Choose the installment to adjust.');
      before = this.instOutstanding(L, i);
      if (amount > before) this.fail('Waiver is larger than the installment balance.');
    } else if (type === 'refund') {
      before = this.creditBalance(L);
      if (amount > before) this.fail('Refund is larger than the credit held.');
    } else {
      this.fail('Unknown adjustment type.');
    }
    const a = {
      id: this.id('ADJ'),
      leaseId,
      type,
      target: target || null,
      amount,
      reason,
      before,
      after: before - amount,
      status: 'Pending approval',
      requestedBy: this.role,
      requestedAt: this.s.date
    };
    this.s.adjustments.push(a);
    this.log('ADJUST', a.id, `${type} of ${money(amount)} requested: ${reason}`);
    return a;
  }

  decideAdjustment(id, approve, note) {
    this.need('adjust.approve');
    const a = this.get('adjustments', id, 'Adjustment');
    if (a.status !== 'Pending approval') this.fail('Already decided.');
    if (a.requestedBy === this.role) this.fail('The requester cannot approve their own adjustment.');
    a.decidedBy = this.role;
    a.decidedAt = this.s.date;
    a.note = note || '';
    if (!approve) {
      a.status = 'Declined';
      this.log('ADJUST', a.id, 'Declined');
      return a;
    }
    const L = this.lease(a.leaseId);
    this.entry(
      L,
      a.type === 'waiver'
        ? { type: 'ADJUSTMENT', allocations: [{ target: a.target, amount: a.amount }], reason: a.reason, adjustmentId: a.id }
        : { type: 'REFUND', credit: -a.amount, reason: a.reason, adjustmentId: a.id }
    );
    a.status = 'Approved';
    this.log('ADJUST', a.id, `Approved ${a.type} ${money(a.amount)}: balance ${money(a.before)} to ${money(a.after)} (requested by ${a.requestedBy}, approved by ${this.role})`);
    this.afterPosting(L);
    return a;
  }

  recordContact(taskId, { channel, outcome, promiseDate, note }) {
    this.need('collections.record');
    const t = this.get('tasks', taskId, 'Task');
    if (t.status === 'Resolved') this.fail('This task is resolved.');
    if (outcome === 'Promised to pay' && !promiseDate) this.fail('Enter the promised payment date.');
    t.contacts.push({
      date: this.s.date,
      by: this.role,
      officer: t.assignedTo,
      channel,
      outcome,
      promiseDate: promiseDate || null,
      note: note || ''
    });
    if (outcome === 'Promised to pay') {
      t.status = 'Promised';
      t.promiseDate = promiseDate;
    }
    this.log('COLLECTIONS', t.id, `${channel}: ${outcome}`);
  }

  /* ---------- completion & ownership ---------- */
  completionChecks(L) {
    const pend = this.s.payments.filter(p => p.leaseId === L.id && ['Pending', 'Quarantined'].includes(p.status));
    return [
      { label: 'Contractual balance is zero', ok: !!L.activationDate && this.outstanding(L) <= 0, detail: this.outstanding(L) > 0 ? `${money(this.outstanding(L))} still owed` : '' },
      { label: 'No pending or quarantined payments', ok: pend.length === 0, detail: pend.length ? `${pend.length} payment(s) unresolved` : '' },
      { label: 'No open disputes', ok: this.openDisputes(L).length === 0, detail: '' },
      { label: 'No customer credit left unapplied', ok: this.creditBalance(L) <= 0, detail: this.creditBalance(L) > 0 ? `${money(this.creditBalance(L))} credit held` : '' },
      { label: 'Phone is issued and ownership not yet transferred', ok: !L.ownership && !!L.deviceId && this.device(L.deviceId).status === 'Issued', detail: L.ownership ? 'Already transferred' : '' }
    ];
  }

  runCompletionChecks(leaseId) {
    this.need('ownership.transfer');
    const L = this.lease(leaseId);
    const c = this.completionChecks(L);
    L.ownershipPending = c.every(x => x.ok);
    return c;
  }

  completeOwnership(leaseId) {
    this.need('ownership.transfer');
    const L = this.lease(leaseId);
    if (L.ownership) this.fail('Ownership has already been transferred for this lease.');
    const c = this.completionChecks(L);
    const bad = c.filter(x => !x.ok);
    if (bad.length) {
      this.log('OWNERSHIP', L.id, 'Transfer blocked: ' + bad.map(x => x.label).join('; '), 'WARN');
      this.fail('Ownership transfer blocked: ' + bad.map(x => x.label + (x.detail ? ` (${x.detail})` : '')).join('; ') + '.');
    }
    this.performTransfer(L);
    return L;
  }

  performTransfer(L) {
    this.atomic(() => {
      const d = this.device(L.deviceId);
      d.status = 'Customer-Owned';
      this.devEvent(d, `Ownership transferred to the customer (lease ${L.id})`);
      L.ownership = {
        date: this.s.date,
        by: this.role,
        certificate: `CERT-${this.s.date.slice(0, 4)}-${String((this.s.seq.CERT = (this.s.seq.CERT || 0) + 1)).padStart(4, '0')}`,
        imei: d.imei
      };
      L.closed = true;
      L.ownershipPending = false;
    });
    this.log('OWNERSHIP', L.id, `Ownership transferred. Certificate ${L.ownership.certificate}`);
  }

  /* ---------- permissions ---------- */
  setPermission(action, role, allowed) {
    this.need('perms.manage');
    if (!DEFAULT_PERMS[action]) this.fail('Unknown action.');
    if (action === 'audit.view' && role !== 'Super Admin' && allowed) {
      this.fail('Only Super Admin can be granted access to audit records.');
    }
    if (['settings', 'perms.manage', 'audit.view'].includes(action) && role === 'Super Admin' && !allowed) {
      this.fail('Super Admin must keep this permission to retain system control and audit access.');
    }
    const list = this.s.perms[action];
    const has = list.includes(role);
    if (allowed && !has) list.push(role);
    if (!allowed && has) list.splice(list.indexOf(role), 1);
    if (allowed !== has) this.log('PERMISSIONS', action, `${allowed ? 'Granted to' : 'Removed from'} ${role}`, 'WARN');
  }

  resetPermissions() {
    this.need('perms.manage');
    this.s.perms = JSON.parse(JSON.stringify(DEFAULT_PERMS));
    this.log('PERMISSIONS', 'all', 'Matrix reset to the approved defaults', 'WARN');
  }

  runKycService(appId) {
    this.need('kyc.verify');
    const a = this.app(appId), c = this.cust(a.customerId);
    const ok = /^\d{7,8}$/.test(c.idNo) && normPhone(c.phone) && D.diff(this.s.date, c.dob) / 365.25 >= this.s.settings.minAge;
    return this.as('KYC Service', () =>
      this.verifyKyc(appId, ok ? 'Verified' : 'Failed', 'Automated check: ID format, phone and age matched by the verification service')
    );
  }

  /* ---------- daily scheduled jobs ---------- */
  advanceDays(n) {
    for (let k = 0; k < n; k++) {
      this.s.date = D.addDays(this.s.date, 1);
      this.as('System', () => this.runDay());
    }
  }

  advanceTo(date) {
    while (this.s.date < date) this.advanceDays(1);
  }

  ensureTask(L, i, stage) {
    if (this.s.tasks.some(t => t.instId === i.id && t.stage === stage)) return;
    const t = {
      id: this.id('TSK'),
      leaseId: L.id,
      instId: i.id,
      stage,
      status: 'Open',
      assignedTo: stage === 'Escalation' ? 'Collections supervisor' : this.s.settings.officers[this.s.tasks.length % this.s.settings.officers.length],
      createdAt: this.s.date,
      contacts: []
    };
    this.s.tasks.push(t);
    this.log('COLLECTIONS', t.id, `${stage} task created for ${L.id} installment ${i.no}`);
  }

  runDay() {
    const t = this.s.date, S = this.s.settings;
    for (const ev of this.s.events.filter(e => e.status === 'Retry queued')) this.runEvent(ev);
    for (const L of this.s.leases) {
      if (!L.activationDate || L.closed || L.terminated) continue;
      this.applyCredit(L);
      for (const i of L.installments) {
        const o = this.instOutstanding(L, i),
          dis = this.openDisputes(L).some(d => !d.instId || d.instId === i.id);
        for (const off of L.terms.reminderOffsets) {
          if (D.addDays(i.due, off) !== t) continue;
          const key = `${i.id}:${off}`;
          if (this.s.notifs.some(n => n.key === key)) continue;
          const reason = o <= 0 ? 'Installment already settled' : dis ? 'Installment is under dispute' : '';
          this.s.notifs.push({
            id: this.id('NTF'),
            date: t,
            leaseId: L.id,
            instId: i.id,
            key,
            channel: 'SMS',
            template: off < 0 ? 'Upcoming payment' : off === 0 ? 'Payment due today' : off <= L.terms.graceDays ? 'Overdue, within grace period' : 'Overdue',
            amount: o,
            status: reason ? 'Suppressed' : 'Sent',
            reason
          });
        }
        if (o > 0 && !dis) {
          const od = D.addDays(i.due, L.terms.graceDays + 1);
          if (t >= od) {
            this.ensureTask(L, i, 'Overdue follow-up');
            if (t >= D.addDays(od, S.escalationDays)) {
              this.ensureTask(L, i, 'Escalation');
            }
          }
        }
      }
      this.afterPosting(L);
    }
    for (const a of this.s.apps) {
      if (['Agreement Pending', 'Deposit Pending'].includes(a.status) && a.expiresAt && t > a.expiresAt) {
        this.releaseDevice(a, 'reservation expired');
        this.setApp(a, 'Expired', 'Agreement not completed and deposit not paid before the reservation expired');
      }
    }
  }

  /* ---------- reporting & statistics ---------- */
  collectionsTotal(from, to) {
    return this.s.ledger.filter(e => e.date >= from && e.date <= to).reduce((s, e) => s + e.cash, 0);
  }

  missingDocs(a) {
    return Object.keys(DOC_KINDS).filter(k => !a.docs[k]).map(k => DOC_KINDS[k]);
  }

  pendingDocs() {
    return this.s.apps
      .filter(a => ['Draft', 'More Information Required'].includes(a.status))
      .map(a => ({ app: a, missing: this.missingDocs(a) }))
      .filter(x => x.missing.length || x.app.status === 'More Information Required');
  }

  salesByAgent() {
    const names = [...this.s.settings.agents, 'Customer self-service'], m = {};
    names.forEach(n => (m[n] = { agent: n, started: 0, submitted: 0, approved: 0, rejected: 0, activated: 0, pendingDocs: 0 }));
    for (const a of this.s.apps) {
      const r = m[a.agent || 'Customer self-service'] || (m[a.agent] = { agent: a.agent, started: 0, submitted: 0, approved: 0, rejected: 0, activated: 0, pendingDocs: 0 });
      r.started++;
      if (a.submittedAt) r.submitted++;
      if ((a.decisions || []).some(d => d.outcome === 'Approved')) r.approved++;
      if (a.status === 'Rejected') r.rejected++;
      if (a.status === 'Activated') r.activated++;
      if (['Draft', 'More Information Required'].includes(a.status) && this.missingDocs(a).length) r.pendingDocs++;
    }
    return Object.values(m).map(r => ({ ...r, conversion: r.submitted ? Math.round((r.activated / r.submitted) * 100) : null }));
  }

  reviewStats() {
    const T = this.s.date,
      first = ['Approved', 'Rejected', 'More Information Required', 'On Hold'],
      days = [],
      reasons = {},
      ex = [];
    let appr = 0, rej = 0;
    for (const a of this.s.apps) {
      const ds = a.decisions || [];
      const f = ds.find(d => first.includes(d.outcome));
      if (f && a.submittedAt) days.push(D.diff(f.date, a.submittedAt));
      ds.forEach(d => {
        if (d.outcome === 'Approved') appr++;
        if (d.outcome === 'Rejected') {
          rej++;
          const k = d.label || 'Other reason';
          reasons[k] = (reasons[k] || 0) + 1;
        }
      });
      const open = ['Submitted', 'Under Review'].includes(a.status), asm = a.assessment;
      ds.filter(d => d.deviated).forEach(d => ex.push({ app: a, why: `Approved against the score advice. ${d.reason}`, kind: 'Approved' }));
      if (open && asm && asm.hardStops.length) ex.push({ app: a, why: 'Policy hard stop: ' + asm.hardStops.join('; '), kind: 'Failed' });
      if (open && a.escalation) ex.push({ app: a, why: `Escalated to ${a.escalation.to}: ${a.escalation.reason}`, kind: 'Escalated' });
      if (a.status === 'On Hold') ex.push({ app: a, why: 'On hold: ' + ((ds.slice(-1)[0] || {}).reason || ''), kind: 'On Hold' });
      if (open && a.queue && T > a.queue.due) ex.push({ app: a, why: `Past the review deadline of ${a.queue.due}`, kind: 'Overdue' });
    }
    return {
      avgTurnaround: days.length ? days.reduce((x, y) => x + y, 0) / days.length : null,
      measured: days.length,
      approvals: appr,
      rejections: rej,
      approvalRate: appr + rej ? Math.round((appr / (appr + rej)) * 100) : null,
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      exceptions: ex
    };
  }

  stockByModel() {
    return this.s.products.map(p => {
      const c = s => this.s.devices.filter(d => d.productId === p.id && d.status === s).length;
      return {
        product: p,
        inStock: c('In Stock'),
        reserved: c('Reserved'),
        issued: c('Issued'),
        owned: c('Customer-Owned'),
        quarantined: c('Quarantined'),
        low: c('In Stock') <= this.s.settings.lowStock
      };
    });
  }

  dailyCollections(n = 7) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = D.addDays(this.s.date, -i),
        es = this.s.ledger.filter(e => e.date === d && e.cash);
      const cash = es.filter(e => e.cash > 0).reduce((s, e) => s + e.cash, 0),
        rev = es.filter(e => e.cash < 0).reduce((s, e) => s - e.cash, 0);
      out.push({ date: d, cash, reversed: rev, net: cash - rev, count: es.filter(e => e.cash > 0).length });
    }
    return out;
  }

  requestsVsReceived(prefix) {
    const ps = this.s.payments.filter(p => p.channel === 'STK Push' && p.requestedAt.startsWith(prefix)),
      ok = ps.filter(p => p.status === 'Success');
    const due = this.s.leases
      .flatMap(L => L.installments)
      .filter(i => i.due.startsWith(prefix) && i.due <= this.s.date)
      .reduce((s, i) => s + i.amount, 0);
    return {
      requested: ps.length,
      requestedAmt: ps.reduce((s, p) => s + p.amount, 0),
      confirmed: ok.length,
      confirmedAmt: ok.reduce((s, p) => s + p.amount, 0),
      pending: ps.filter(p => p.status === 'Pending').length,
      reversed: ps.filter(p => p.status === 'Reversed').length,
      failed: ps.filter(p => ['Failed', 'Cancelled', 'Expired', 'Initiation Failed'].includes(p.status)).length,
      quarantined: ps.filter(p => p.status === 'Quarantined').length,
      due
    };
  }

  reversals() {
    return this.s.ledger.filter(e => e.type === 'REVERSAL').slice().reverse();
  }

  promises() {
    return this.s.tasks
      .filter(t => t.promiseDate)
      .map(t => {
        const L = this.lease(t.leaseId),
          i = L.installments.find(x => x.id === t.instId),
          paid = this.instOutstanding(L, i) <= 0;
        return { task: t, L, i, state: paid ? 'Kept' : t.promiseDate < this.s.date ? 'Broken' : 'Upcoming' };
      });
  }

  workload() {
    const w = {}, T = this.s.date;
    for (const o of [...this.s.settings.officers, 'Collections supervisor']) {
      w[o] = { officer: o, open: 0, promised: 0, uncontacted: 0, contactsWeek: 0 };
    }
    for (const t of this.s.tasks) {
      const r = w[t.assignedTo] || (w[t.assignedTo] = { officer: t.assignedTo, open: 0, promised: 0, uncontacted: 0, contactsWeek: 0 });
      if (t.status !== 'Resolved') {
        r.open++;
        if (t.status === 'Promised') r.promised++;
        if (!t.contacts.length) r.uncontacted++;
      }
      r.contactsWeek += t.contacts.filter(c => D.diff(T, c.date) <= 7).length;
    }
    return Object.values(w);
  }

  stats() {
    const t = this.s.date,
      act = this.s.leases.filter(l => l.activationDate && !l.closed && !l.terminated);
    const r = {
      activeLeases: act.length,
      outstanding: 0,
      overdueAmt: 0,
      overdueN: 0,
      graceN: 0,
      aging: { '1 to 7 days': 0, '8 to 30 days': 0, '31 to 60 days': 0, 'Over 60 days': 0 }
    };
    for (const L of act) {
      r.outstanding += this.outstanding(L);
      for (const i of L.installments) {
        const st = this.instState(L, i);
        if (st.status === 'Overdue') {
          r.overdueAmt += st.outstanding;
          r.overdueN++;
          const d = st.daysPast;
          r.aging[d <= 7 ? '1 to 7 days' : d <= 30 ? '8 to 30 days' : d <= 60 ? '31 to 60 days' : 'Over 60 days'] += st.outstanding;
        } else if (st.status === 'Grace Period') {
          r.graceN++;
        }
      }
    }
    r.collectedMonth = this.collectionsTotal(t.slice(0, 7) + '-01', t.slice(0, 7) + '-31');
    r.openTasks = this.s.tasks.filter(x => x.status !== 'Resolved').length;
    r.exceptions = this.s.payments.filter(p => p.status === 'Quarantined').length + this.s.events.filter(e => ['Unmatched', 'Retry queued'].includes(e.status)).length;
    r.pendingDeposits = this.s.apps.filter(a => a.status === 'Deposit Pending').length;
    r.ready = this.s.apps.filter(a => a.status === 'Ready for Handover').length;
    r.inStock = this.s.devices.filter(d => d.status === 'In Stock').length;
    const m = {};
    const add = (k, f, v) => {
      (m[k] = m[k] || { expected: 0, collected: 0, collectedInst: 0 })[f] += v;
    };
    for (const L of this.s.leases) for (const i of L.installments) add(i.due.slice(0, 7), 'expected', i.amount);
    for (const e of this.s.ledger) {
      if (e.cash) {
        add(e.date.slice(0, 7), 'collected', e.cash);
        add(e.date.slice(0, 7), 'collectedInst', e.allocations.filter(x => x.target !== 'deposit').reduce((a, x) => a + x.amount, 0));
      }
    }
    r.monthly = Object.keys(m).sort().map(k => ({ month: k, ...m[k] }));
    return r;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Engine };
}
if (typeof window !== 'undefined') {
  window.SpectrumEngine = { Engine };
  window.SpectrumEngine = window.SpectrumEngine;
}

})();
