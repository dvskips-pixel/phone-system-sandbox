<?php
namespace SpectrumCredit\Database;

use PDO;
use PDOException;

class Database {
    private static ?PDO $instance = null;
    private static string $dbPath = __DIR__ . '/spectrum.sqlite';
    private static string $schemaPath = __DIR__ . '/schema.sql';


    /**
     * Get or create PDO connection singleton
     */
    public static function getConnection(): PDO {
        if (self::$instance === null) {
            $isNew = !file_exists(self::$dbPath);
            try {
                self::$instance = new PDO('sqlite:' . self::$dbPath);
                self::$instance->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$instance->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                self::$instance->exec('PRAGMA foreign_keys = ON;');
                
                if ($isNew || filesize(self::$dbPath) === 0) {
                    self::runMigrations();
                }
            } catch (PDOException $e) {
                self::$instance = null;
                throw new \RuntimeException('Database connection failed: ' . $e->getMessage(), 0, $e);
            }
        }
        return self::$instance;
    }

    /**
     * Run DDL schema
     */
    public static function runMigrations(): void {
        $pdo = self::$instance;
        if (file_exists(self::$schemaPath)) {
            $sql = file_get_contents(self::$schemaPath);
            $pdo->exec($sql);
        }
    }

    /**
     * Reset the database and re-seed
     */
    public static function reset(): void {
        self::$instance = null;
        if (file_exists(self::$dbPath)) {
            unlink(self::$dbPath);
        }
        self::getConnection();
    }

    /**
     * Execute a parameterized query
     */
    public static function query(string $sql, array $params = []): array {
        $stmt = self::getConnection()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * Execute an insert / update / delete query
     */
    public static function execute(string $sql, array $params = []): int {
        $stmt = self::getConnection()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    /**
     * Get last inserted ID
     */
    public static function lastInsertId(): string {
        return self::getConnection()->lastInsertId();
    }

    /**
     * Execute callback inside a database transaction
     */
    public static function transaction(callable $callback) {
        $pdo = self::getConnection();
        $pdo->beginTransaction();
        try {
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }
}

if (!class_exists('SpectrumCredit\\Database\\Database', false)) {
    class_alias(Database::class, 'SpectrumCredit\\Database\\Database');
}
