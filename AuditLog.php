<?php
namespace SpectrumCredit\Models;


require_once __DIR__ . '/Model.php';

class AuditLog extends Model {
    protected static string $table = 'audit_logs';

    public static function log(string $entityType, string $entityId, string $action, string $role, string $user, ?array $details = null): int {
        return self::create([
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'action' => $action,
            'actor_role' => $role,
            'actor_name' => $user,
            'details_json' => $details ? json_encode($details) : null,
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1'
        ]);
    }
}
