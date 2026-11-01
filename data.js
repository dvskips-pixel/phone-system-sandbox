(function () {
'use strict';

const ROLES = [
  'Super Admin', 'Product Admin', 'Sales Agent', 'Customer',
  'Credit/Risk Officer', 'Approver', 'Senior Approver',
  'Inventory Officer', 'Finance Officer', 'Finance Approver',
  'Collections Officer', 'Auditor', 'Compliance Officer'
];

const DEFAULT_PERMS = {
  'customer.register': ['Sales Agent'],
  'app.create': ['Sales Agent', 'Customer'],
  'app.submit': ['Sales Agent', 'Customer'],
  'kyc.verify': ['Credit/Risk Officer', 'KYC Service'],
  'app.refer': ['Credit/Risk Officer', 'Approver', 'Senior Approver', 'Super Admin'],
  'app.decide': ['Approver', 'Senior Approver', 'Super Admin'],
  'app.cancel': ['Sales Agent', 'Customer', 'Approver', 'Senior Approver'],
  'risk.view': ['Credit/Risk Officer', 'Approver', 'Senior Approver', 'Auditor', 'Compliance Officer', 'Super Admin'],
  'pricing.manage': ['Super Admin', 'Product Admin'],
  'pricing.activate': ['Super Admin', 'Product Admin'],
  'settings': ['Super Admin'],
  'perms.manage': ['Super Admin'],
  'device.manage': ['Inventory Officer'],
  'handover': ['Inventory Officer'],
  'agreement.generate': ['Sales Agent', 'Approver', 'Senior Approver', 'Super Admin'],
  'agreement.accept': ['Customer', 'Sales Agent'],
  'agreement.authorize': ['Approver', 'Senior Approver', 'Super Admin'],
  'payment.initiate': ['Customer', 'Sales Agent', 'Collections Officer', 'Finance Officer'],
  'payment.reconcile': ['Finance Officer'],
  'adjust.request': ['Finance Officer'],
  'adjust.approve': ['Finance Approver', 'Super Admin'],
  'staff.changes.approve': ['Senior Approver'],
  'collections.record': ['Collections Officer'],
  'dispute.manage': ['Finance Officer', 'Collections Officer'],
  'ownership.transfer': ['Finance Officer', 'Super Admin'],
  'audit.view': ['Super Admin']
};

const PERM_ROWS = [
  ['customer.register', 'Register customer'],
  ['app.submit', 'Submit application'],
  ['app.create', 'Start and edit an application'],
  ['kyc.verify', 'Verify KYC and record credit assessment', 'Credit/Risk Officer or authorized verification service'],
  ['app.refer', 'Request information, hold or escalate an application'],
  ['app.decide', 'Approve or reject application', 'Approver within assigned limits'],
  ['risk.view', 'View risk and credit assessment data'],
  ['pricing.manage', 'Configure prices and lease durations'],
  ['pricing.activate', 'Activate pricing'],
  ['device.manage', 'Register and allocate devices'],
  ['handover', 'Record handover'],
  ['agreement.generate', 'Generate lease agreement', 'System; authorized staff may initiate'],
  ['agreement.accept', 'Accept agreement (customer side)'],
  ['agreement.authorize', 'Authorize agreement (company representative)'],
  ['payment.initiate', 'Initiate M-PESA STK Push', 'Customer-facing application or authorized staff action'],
  ['payment.reconcile', 'Reconcile exceptions'],
  ['collections.record', 'Record collection follow-up'],
  ['dispute.manage', 'Open and resolve disputes'],
  ['adjust.request', 'Request waiver, refund or adjustment'],
  ['adjust.approve', 'Approve waiver, refund or adjustment', 'Authorized Finance Approver'],
  ['staff.changes.approve', 'Approve staff changes', 'A different authorized checker must approve staff additions, assignments and deletions'],
  ['ownership.transfer', 'Transfer ownership by exception', 'Normally done by system after checks'],
  ['audit.view', 'View audit records', 'Super Admin only; audit access is restricted to system administrators'],
  ['app.cancel', 'Cancel an application'],
  ['settings', 'Edit policy settings'],
  ['perms.manage', 'Change permission matrix']
];

const SYSTEM_ONLY = [
  ['Confirm payment', 'Only verified payment integration and reconciliation process. No person can mark a payment as paid.'],
  ['Transfer ownership', 'Done by system once every completion check passes. Staff handle exceptions only.']
];

const DOC_KINDS = {
  nationalId: 'National ID or passport',
  proofIncome: 'Proof of income (M-PESA statement or payslip)'
};

const REASON_CODES = {
  reject: [
    ['IDENTITY', 'Identity could not be verified'],
    ['AFFORDABILITY', 'Repayment capacity is not sufficient'],
    ['HISTORY', 'Adverse payment history with the company'],
    ['FRAUD', 'Fraud indicators'],
    ['LIMIT', 'Exceeds risk limits'],
    ['ELIGIBILITY', 'Does not meet product eligibility rules'],
    ['DOCS', 'Documents invalid or incomplete'],
    ['OTHER', 'Other reason']
  ],
  info: [
    ['DOCS_MISSING', 'Documents missing or unclear'],
    ['INCOME', 'Income or cash-flow evidence needed'],
    ['OBLIGATIONS', 'Existing obligations to be confirmed'],
    ['IDENTITY_INFO', 'Identity details to be confirmed'],
    ['OTHER_INFO', 'Other information needed']
  ],
  hold: [
    ['CALLBACK', 'Awaiting verification call'],
    ['FRAUD_REVIEW', 'Fraud review in progress'],
    ['LIMIT_REVIEW', 'Awaiting senior limit review'],
    ['STOCK', 'Awaiting stock or product availability'],
    ['OTHER_HOLD', 'Other reason']
  ]
};

const CLAUSE_KEYS = ['payment', 'late', 'warranty', 'dispute', 'completion', 'cancellation', 'early', 'termination'];

const CLAUSE_TITLES = {
  payment: 'Payment methods and instructions',
  late: 'Late-payment terms',
  warranty: 'Warranty, loss and damage',
  dispute: 'Disputes',
  completion: 'Completion and ownership transfer',
  cancellation: 'Cancellation',
  early: 'Early settlement',
  termination: 'Termination'
};

const DEFAULT_CLAUSES = {
  payment: `The deposit and each installment are paid by M-PESA. Pay when prompted by an STK Push sent to {phone}, or pay to Paybill {paybill} using your lease number as the account number. The amount on every prompt comes from this agreement. A payment counts only after M-PESA confirms it.`,
  late: `Each installment has a grace period of {grace} calendar days after its due date. If it is still unpaid after the grace period it is marked overdue and our collections team will contact you. No late fee or penalty is charged under this agreement. The unpaid amount stays payable.`,
  warranty: `The phone carries the manufacturer's warranty for its model. Until ownership transfers, the phone remains the property of {company}. You must keep it in good condition and report loss, theft or damage within 48 hours. Loss or damage does not cancel your remaining installments unless we agree in writing.`,
  dispute: `If you believe a payment or charge is wrong, tell us in writing or by phone. We will record the dispute, review the payment history and reply within 14 days. Payment records are never deleted while a dispute is investigated. Unresolved disputes may be taken to the courts of Kenya.`,
  completion: `Ownership of the phone transfers to you once the deposit and every installment are paid and confirmed, and no payment or dispute is unresolved. We will issue a completion certificate that records the transfer date.`,
  cancellation: `You may cancel before the phone is handed over. Any deposit you have paid will be refunded in full after verification, because this agreement states no cancellation charge. After handover the lease ends only by early settlement or termination.`,
  early: `You may settle early at any time. The settlement amount is the unpaid balance of the installments, less any credit we hold for you. No penalty is added and no rebate is promised, because neither is in this agreement. A settlement quote is available on request.`,
  termination: `We may end the lease if an installment stays unpaid after the grace period and after written notice that gives you a reasonable time to pay. On termination the phone must be returned in reasonable condition, and amounts already paid are accounted for under applicable law.`
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROLES, DEFAULT_PERMS, PERM_ROWS, SYSTEM_ONLY, DOC_KINDS,
    REASON_CODES, CLAUSE_KEYS, CLAUSE_TITLES, DEFAULT_CLAUSES
  };
}
if (typeof window !== 'undefined') {
  window.SpectrumData = {
    ROLES, DEFAULT_PERMS, PERM_ROWS, SYSTEM_ONLY, DOC_KINDS,
    REASON_CODES, CLAUSE_KEYS, CLAUSE_TITLES, DEFAULT_CLAUSES
  };
  window.SpectrumData = window.SpectrumData;
}

})();
