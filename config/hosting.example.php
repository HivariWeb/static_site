<?php
declare(strict_types=1);

// Copy to a PRIVATE directory outside the website document root.
// Default production path: /www/diana-site-private/config.php (FTP path).
return [
    'storage_path' => __DIR__ . '/storage',
    'secret' => 'CHANGE_ME_USE_64_RANDOM_HEXADECIMAL_CHARACTERS',
    'allowed_origins' => ['https://www.dianaberezovskaya.online'],
    'notification_email' => 'dianagulchenko@yandex.ru',
    'from_email' => 'no-reply@dianaberezovskaya.online',
    // Enable only after the hosting mail configuration and a delivery test.
    'mail_enabled' => false,
    'retention_days' => 90,
    'rate_limit' => 5,
    'rate_window_seconds' => 900,
];
