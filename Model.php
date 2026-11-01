<?php
namespace SpectrumCredit\Models;

require_once __DIR__ . '/../database/Database.php';

use SpectrumCredit\Database\Database;
use PDO;

abstract class Model {

    protected static string $table = '';

    public static function all(): array {
        return Database::query("SELECT * FROM " . static::$table . " ORDER BY id DESC");
    }

    public static function find(int $id): ?array {
        $rows = Database::query("SELECT * FROM " . static::$table . " WHERE id = ? LIMIT 1", [$id]);
        return $rows[0] ?? null;
    }

    public static function findBy(string $column, $value): ?array {
        $rows = Database::query("SELECT * FROM " . static::$table . " WHERE {$column} = ? LIMIT 1", [$value]);
        return $rows[0] ?? null;
    }

    public static function where(string $column, $value): array {
        return Database::query("SELECT * FROM " . static::$table . " WHERE {$column} = ? ORDER BY id DESC", [$value]);
    }

    public static function create(array $data): int {
        $columns = implode(', ', array_keys($data));
        $placeholders = implode(', ', array_fill(0, count($data), '?'));
        $sql = "INSERT INTO " . static::$table . " ({$columns}) VALUES ({$placeholders})";
        Database::execute($sql, array_values($data));
        return (int)Database::lastInsertId();
    }

    public static function update(int $id, array $data): int {
        $fields = [];
        $values = [];
        foreach ($data as $col => $val) {
            $fields[] = "{$col} = ?";
            $values[] = $val;
        }
        $values[] = $id;
        $sql = "UPDATE " . static::$table . " SET " . implode(', ', $fields) . ", updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        return Database::execute($sql, $values);
    }

    public static function delete(int $id): int {
        return Database::execute("DELETE FROM " . static::$table . " WHERE id = ?", [$id]);
    }
}
