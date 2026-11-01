<?php
namespace SpectrumCredit\Models;

require_once __DIR__ . '/Model.php';

class LedgerEntry extends Model {
    protected static string $table = 'ledger_entries';

    public static function forReference(string $type, string $id): array {
        return \SpectrumCredit\Database\Database::query(
            "SELECT * FROM ledger_entries WHERE reference_type = ? AND reference_id = ? ORDER BY id ASC",
            [$type, $id]
        );
    }
}

