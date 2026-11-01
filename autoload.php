<?php
/**
 * Spectrum Credit Limited - Autoloader
 * Automatically maps SpectrumCredit\... classes to php/ directory.
 */

spl_autoload_register(function (string $class): void {
    $prefixes = ['SpectrumCredit\\', 'Awamu\\'];
    $relativeClass = null;

    foreach ($prefixes as $prefix) {
        $len = strlen($prefix);
        if (strncmp($prefix, $class, $len) === 0) {
            $relativeClass = substr($class, $len);
            break;
        }
    }

    if ($relativeClass === null) {
        return;
    }

    $parts = explode('\\', $relativeClass);
    if (count($parts) === 2) {
        $dir = strtolower($parts[0]);
        $file = __DIR__ . '/' . $dir . '/' . $parts[1] . '.php';
        if (file_exists($file)) {
            require_once $file;
            return;
        }
    }

    $file = __DIR__ . '/' . str_replace('\\', '/', $relativeClass) . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
});
