-- ===================================================================
-- Spectrum Credit Limited Phone Lease Desk - SQLite Database Schema
-- All monetary figures stored as INTEGER cents of KES (1 KES = 100 cents)
-- ===================================================================


PRAGMA foreign_keys = ON;

-- 1. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    national_id TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    dob TEXT NOT NULL,
    monthly_income INTEGER NOT NULL DEFAULT 0, -- in cents
    crb_status TEXT NOT NULL DEFAULT 'Clean',  -- Clean, Listed, Default
    crb_score INTEGER NOT NULL DEFAULT 700,
    mpesa_monthly_inflow INTEGER NOT NULL DEFAULT 0, -- in cents
    active_leases_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products / Catalogue Table
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    storage TEXT NOT NULL,
    cash_price INTEGER NOT NULL, -- in cents
    status TEXT NOT NULL DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Pricing Matrix Table
CREATE TABLE IF NOT EXISTS pricings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    term_months INTEGER NOT NULL,
    total_lease_price INTEGER NOT NULL, -- in cents
    deposit_type TEXT NOT NULL,          -- 'fixed' or 'percent'
    deposit_value INTEGER NOT NULL,      -- in cents or percent
    status TEXT NOT NULL DEFAULT 'Active', -- Active, Draft, Archived
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Devices (Physical Inventory) Table
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    imei TEXT NOT NULL UNIQUE,
    serial_no TEXT,
    condition TEXT NOT NULL DEFAULT 'New', -- New, Refurbished, Returned
    status TEXT NOT NULL DEFAULT 'In Stock', -- In Stock, Allocated, In Lease, Repossessed, Written Off
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Applications Table
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_no TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    pricing_id INTEGER NOT NULL REFERENCES pricings(id),
    created_by_role TEXT NOT NULL DEFAULT 'Agent',
    creator_name TEXT NOT NULL DEFAULT 'Agent Kibet',
    status TEXT NOT NULL DEFAULT 'Draft', -- Draft, Submitted, Under Review, Approved, Rejected, Cancelled, Agreement Issued, Completed
    score INTEGER NOT NULL DEFAULT 0,
    rejection_code TEXT,
    rejection_reason TEXT,
    approved_by_role TEXT,
    approved_by_user TEXT,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Application Documents
CREATE TABLE IF NOT EXISTS application_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL, -- national_id_front, national_id_back, selfie, mpesa_statement, payslip
    file_path TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verified_by TEXT,
    verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Digital Agreements Table
CREATE TABLE IF NOT EXISTS agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_no TEXT NOT NULL UNIQUE,
    application_id INTEGER NOT NULL REFERENCES applications(id),
    customer_signature TEXT,
    customer_signed_at DATETIME,
    authorized_by_role TEXT,
    authorized_by_user TEXT,
    authorized_at DATETIME,
    clauses_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft', -- Draft, Customer Signed, Authorized, Executed, Cancelled
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Leases Table
CREATE TABLE IF NOT EXISTS leases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_no TEXT NOT NULL UNIQUE,
    application_id INTEGER NOT NULL REFERENCES applications(id),
    agreement_id INTEGER NOT NULL REFERENCES agreements(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    device_id INTEGER NOT NULL REFERENCES devices(id),
    pricing_id INTEGER NOT NULL REFERENCES pricings(id),
    term_months INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,   -- in cents
    deposit_amount INTEGER NOT NULL, -- in cents
    deposit_paid INTEGER NOT NULL DEFAULT 0,
    principal_balance INTEGER NOT NULL, -- in cents
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active', -- Active, Grace, Delinquent, Repossessed, Completed, Settled
    handover_by TEXT,
    handover_at DATETIME,
    ownership_transferred INTEGER NOT NULL DEFAULT 0,
    ownership_transferred_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Installments Table
CREATE TABLE IF NOT EXISTS installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
    installment_no INTEGER NOT NULL,
    due_date DATE NOT NULL,
    expected_amount INTEGER NOT NULL, -- in cents
    paid_amount INTEGER NOT NULL DEFAULT 0, -- in cents
    status TEXT NOT NULL DEFAULT 'Pending', -- Pending, Partial, Paid, Overdue, Waived
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_id INTEGER REFERENCES leases(id),
    payment_reference TEXT NOT NULL UNIQUE, -- M-PESA Receipt (e.g. QHX776YY1)
    provider TEXT NOT NULL DEFAULT 'MPESA',
    phone TEXT NOT NULL,
    amount INTEGER NOT NULL, -- in cents
    purpose TEXT NOT NULL DEFAULT 'INSTALLMENT', -- DEPOSIT, INSTALLMENT, SETTLEMENT, PENALTY
    account_reference TEXT NOT NULL,
    raw_callback_json TEXT,
    status TEXT NOT NULL DEFAULT 'Confirmed', -- Pending, Confirmed, Failed, Reversed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. General Ledger Entries (Double-Entry Bookkeeping)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    entry_date DATE NOT NULL,
    debit_account TEXT NOT NULL,
    credit_account TEXT NOT NULL,
    amount INTEGER NOT NULL, -- in cents
    currency TEXT NOT NULL DEFAULT 'KES',
    reference_type TEXT NOT NULL, -- LEASE, PAYMENT, ADJUSTMENT, REPOSSESSION
    reference_id TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. Adjustments & Waivers Table
CREATE TABLE IF NOT EXISTS adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_id INTEGER NOT NULL REFERENCES leases(id),
    type TEXT NOT NULL, -- WAIVER, REFUND, PENALTY, WRITE_OFF
    amount INTEGER NOT NULL, -- in cents
    reason TEXT NOT NULL,
    requested_by_role TEXT NOT NULL,
    requested_by_user TEXT NOT NULL,
    approved_by_role TEXT,
    approved_by_user TEXT,
    status TEXT NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. Disputes Table
CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lease_id INTEGER NOT NULL REFERENCES leases(id),
    raised_by_role TEXT NOT NULL,
    customer_phone TEXT,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open', -- Open, Under Review, Resolved, Dismissed
    resolution_note TEXT,
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    details_json TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_customers_national_id ON customers(national_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_devices_imei ON devices(imei);
CREATE INDEX IF NOT EXISTS idx_applications_app_no ON applications(app_no);
CREATE INDEX IF NOT EXISTS idx_leases_lease_no ON leases(lease_no);
CREATE INDEX IF NOT EXISTS idx_installments_lease_due ON installments(lease_id, due_date);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(payment_reference);
CREATE INDEX IF NOT EXISTS idx_ledger_trans ON ledger_entries(transaction_id);
