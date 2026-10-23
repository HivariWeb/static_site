<?php
declare(strict_types=1);

const SITE_ROOT = __DIR__ . '/..';
const CONSENT_VERSION = '2026-10-23';
const CONSENT_TEXT = 'Даю согласие на обработку персональных данных для ответа на мою заявку.';

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function security_headers(): void
{
    $path = SITE_ROOT . '/config/security.php';
    if (is_file($path)) {
        foreach (require $path as $name => $value) {
            header($name . ': ' . $value);
        }
    }
}

function app_config(): array
{
    static $config;
    if (is_array($config)) {
        return $config;
    }
    $path = getenv('DIANA_CONFIG_PATH') ?: dirname(__DIR__, 2) . '/diana-site-private/config.php';
    if (!is_file($path)) {
        throw new RuntimeException('Private configuration is missing');
    }
    $configLocation = strtolower(str_replace('\\', '/', realpath($path) ?: ''));
    $publicLocation = strtolower(str_replace('\\', '/', realpath(SITE_ROOT) ?: ''));
    if ($configLocation === '' || $publicLocation === ''
        || str_starts_with($configLocation, $publicLocation . '/')) {
        throw new RuntimeException('Configuration must be outside the public website');
    }
    $candidate = require $path;
    if (!is_array($candidate) || !isset($candidate['secret'], $candidate['storage_path'])
        || !is_string($candidate['secret']) || strlen($candidate['secret']) < 32
        || str_contains($candidate['secret'], 'CHANGE_ME')) {
        throw new RuntimeException('Private configuration is incomplete');
    }
    foreach (['notification_email', 'from_email'] as $field) {
        if (!filter_var($candidate[$field] ?? '', FILTER_VALIDATE_EMAIL)
            || preg_match('/[\r\n]/', $candidate[$field])) {
            throw new RuntimeException('Invalid mail configuration');
        }
    }
    if (strtolower(substr(strrchr($candidate['from_email'], '@') ?: '', 1)) !== 'dianaberezovskaya.online') {
        throw new RuntimeException('Sender must use the website domain');
    }
    if (!is_array($candidate['allowed_origins'] ?? null) || !$candidate['allowed_origins']) {
        throw new RuntimeException('Allowed origins must be configured');
    }
    $storage = $candidate['storage_path'];
    if (!is_string($storage) || !preg_match('~^(?:[A-Za-z]:/|/)~', str_replace('\\', '/', $storage))) {
        throw new RuntimeException('Storage must use an absolute path');
    }
    if (!is_dir($storage) && !mkdir($storage, 0700, true) && !is_dir($storage)) {
        throw new RuntimeException('Private storage is unavailable');
    }
    $resolved = realpath($storage);
    $webRoot = realpath(SITE_ROOT);
    if ($resolved === false || $webRoot === false) {
        throw new RuntimeException('Cannot resolve storage');
    }
    $normalized = strtolower(str_replace('\\', '/', $resolved));
    $normalizedRoot = strtolower(str_replace('\\', '/', $webRoot));
    if ($normalized === $normalizedRoot || str_starts_with($normalized, $normalizedRoot . '/')) {
        throw new RuntimeException('Storage must be outside the public website');
    }
    foreach (['leads', 'rates', 'sessions'] as $directory) {
        $target = $resolved . '/' . $directory;
        if (!is_dir($target) && !mkdir($target, 0700) && !is_dir($target)) {
            throw new RuntimeException('Private storage is unavailable');
        }
        if (strtolower(str_replace('\\', '/', realpath($target) ?: '')) !== $normalized . '/' . $directory) {
            throw new RuntimeException('Storage subdirectories must stay inside private storage');
        }
    }
    $candidate['storage_path'] = $resolved;
    $candidate['retention_days'] = max(1, min(90, (int)($candidate['retention_days'] ?? 90)));
    $candidate['rate_limit'] = max(1, min(20, (int)($candidate['rate_limit'] ?? 5)));
    $candidate['rate_window_seconds'] = max(60, (int)($candidate['rate_window_seconds'] ?? 900));
    $config = $candidate;
    return $config;
}

function start_request_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $config = app_config();
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '7200');
    session_save_path($config['storage_path'] . '/sessions');
    session_name('diana_request');
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    if (!session_start()) {
        throw new RuntimeException('Request session is unavailable');
    }
    if (!isset($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    $_SESSION['tickets'] = array_filter($_SESSION['tickets'] ?? [], static fn($time) => is_int($time) && $time > time() - 7200);
}

function new_form_ticket(): string
{
    start_request_session();
    $ticket = bin2hex(random_bytes(24));
    $_SESSION['tickets'][$ticket] = time();
    if (count($_SESSION['tickets']) > 20) {
        $_SESSION['tickets'] = array_slice($_SESSION['tickets'], -20, null, true);
    }
    return $ticket;
}

function services(): array
{
    static $services;
    return $services ??= require SITE_ROOT . '/config/services.php';
}

function text_field(array $input, string $key, int $maxBytes = 500): string
{
    $value = $input[$key] ?? '';
    return is_string($value) && strlen($value) <= $maxBytes ? trim($value) : '';
}

function validate_request(array $input): array
{
    $values = [
        'name' => text_field($input, 'name', 320),
        'contact_method' => text_field($input, 'contact_method', 20),
        'contact' => text_field($input, 'contact', 254),
        'service' => text_field($input, 'service', 30),
    ];
    $errors = [];
    if (!preg_match("/^[\p{L}\p{M}\p{N} .'\x{2019}\-]{1,80}$/u", $values['name'])
        || !preg_match('/\p{L}/u', $values['name'])) {
        $errors['name'] = 'Укажите имя: до 80 символов, без ссылок и специальных знаков.';
    }
    if (!in_array($values['contact_method'], ['telegram', 'whatsapp', 'email'], true)) {
        $errors['contact_method'] = 'Выберите способ связи.';
    }
    $contact = $values['contact'];
    $phoneDigits = preg_replace('/\D/', '', $contact);
    $isPhone = preg_match('/^\+?[0-9][0-9 ()\-]{6,25}$/D', $contact)
        && strlen($phoneDigits) >= 8 && strlen($phoneDigits) <= 15;
    $isTelegram = preg_match('/^@[A-Za-z][A-Za-z0-9_]{2,31}$/D', $contact);
    $validContact = !preg_match('/[\r\n\x00-\x1f\x7f]/', $contact) && match ($values['contact_method']) {
        'telegram' => $isPhone || $isTelegram,
        'whatsapp' => (bool)$isPhone,
        'email' => filter_var($contact, FILTER_VALIDATE_EMAIL) !== false,
        default => false,
    };
    if (!$validContact) {
        $errors['contact'] = match ($values['contact_method']) {
            'telegram' => 'Укажите @username Telegram или номер телефона с кодом страны.',
            'whatsapp' => 'Укажите номер телефона с кодом страны.',
            default => 'Проверьте адрес электронной почты.',
        };
    }
    if (!array_key_exists($values['service'], services())) {
        $errors['service'] = 'Выберите формат или вариант «Помогите выбрать».';
    }
    if (($input['consent'] ?? '') !== '1') {
        $errors['consent'] = 'Для ответа на заявку необходимо ваше согласие на обработку этих данных.';
    }
    return [$values, $errors];
}

function attribution(array $input): array
{
    if (($input['analytics_consent'] ?? '') !== '1') {
        return [];
    }
    $raw = text_field($input, 'attribution', 3000);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return [];
    }
    $safe = [];
    foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'client_id'] as $field) {
        if (!isset($data[$field]) || !is_string($data[$field])) {
            continue;
        }
        $value = trim($data[$field]);
        if ($value === '' || strlen($value) > 400 || !preg_match('//u', $value) || preg_match('/[\x00-\x1f\x7f<>]/', $value)) {
            continue;
        }
        if (in_array($field, ['yclid', 'client_id'], true) && !preg_match('/^\d{1,40}$/D', $value)) {
            continue;
        }
        $safe[$field] = $value;
    }
    return $safe;
}

function read_json(string $path): array
{
    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException('Cannot read private record');
    }
    $value = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($value)) {
        throw new RuntimeException('Invalid private record');
    }
    return $value;
}

function write_json(string $path, array $value): void
{
    $data = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
    $file = fopen($temporary, 'x+b');
    if ($file === false) {
        throw new RuntimeException('Cannot create private record');
    }
    try {
        chmod($temporary, 0600);
        if (fwrite($file, $data) !== strlen($data) || !fflush($file)) {
            throw new RuntimeException('Cannot persist private record');
        }
        if (function_exists('fsync') && !fsync($file)) {
            throw new RuntimeException('Cannot flush private record');
        }
    } catch (Throwable $error) {
        fclose($file);
        @unlink($temporary);
        throw $error;
    }
    fclose($file);
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('Cannot finalize private record');
    }
}

function storage_lock(callable $action): mixed
{
    $config = app_config();
    $file = fopen($config['storage_path'] . '/state.lock', 'c+b');
    if ($file === false || !flock($file, LOCK_EX)) {
        if (is_resource($file)) fclose($file);
        throw new RuntimeException('Cannot lock private storage');
    }
    try { return $action($config); }
    finally { flock($file, LOCK_UN); fclose($file); }
}

final class RequestRateLimit extends RuntimeException {}
final class RequestConflict extends RuntimeException {}

function save_request(array $values, array $input, string $ticket): array
{
    $config = app_config();
    $fingerprint = hash('sha256', json_encode($values, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    $ticketTime = $_SESSION['tickets'][$ticket];
    $id = 'L-' . gmdate('Ymd', $ticketTime) . '-' . strtoupper(substr(hash_hmac('sha256', session_id() . ':' . $ticket, $config['secret']), 0, 24));
    $ipHash = hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown', $config['secret']);
    return storage_lock(static function (array $config) use ($id, $fingerprint, $values, $input, $ipHash): array {
        $path = $config['storage_path'] . '/leads/' . $id . '.json';
        if (is_file($path)) {
            $existing = read_json($path);
            if (!hash_equals($existing['fingerprint'], $fingerprint)) {
                throw new RequestConflict('This form has already been submitted');
            }
            return ['lead_id' => $id, 'duplicate' => true];
        }
        $ratePath = $config['storage_path'] . '/rates/' . $ipHash . '.json';
        $now = time();
        $rate = is_file($ratePath) ? read_json($ratePath) : [];
        $rate = array_values(array_filter($rate, static fn($time) => is_int($time) && $time > $now - $config['rate_window_seconds']));
        if (count($rate) >= $config['rate_limit']) {
            throw new RequestRateLimit('Too many new requests');
        }
        $service = services()[$values['service']];
        $record = [
            'id' => $id, 'created_at' => gmdate('c'), 'created_unix' => $now,
            'expires_at' => gmdate('c', $now + $config['retention_days'] * 86400),
            'name' => $values['name'], 'contact_method' => $values['contact_method'], 'contact' => $values['contact'],
            'service_id' => $values['service'], 'service_name' => $service['name'], 'price_rub' => $service['price_rub'],
            'consent' => ['accepted' => true, 'text' => CONSENT_TEXT, 'version' => CONSENT_VERSION,
                'document' => 'https://www.dianaberezovskaya.online/consent-request.html',
                'document_sha256' => hash_file('sha256', SITE_ROOT . '/consent-request.html'),
                'accepted_at' => gmdate('c')],
            'analytics_consent' => ($input['analytics_consent'] ?? '') === '1',
            'attribution' => attribution($input),
            'technical' => ['ip_hmac' => $ipHash], 'fingerprint' => $fingerprint,
            'notification' => ['status' => 'pending', 'attempts' => 0],
        ];
        write_json($path, $record);
        $rate[] = $now;
        try { write_json($ratePath, $rate); }
        catch (Throwable) { error_log('Diana: rate journal write failed after a persisted request'); }
        return ['lead_id' => $id, 'duplicate' => false];
    });
}

function send_notification(string $id): bool
{
    $config = app_config();
    if (empty($config['mail_enabled'])) return false;
    if (!preg_match('/^L-\d{8}-[A-F0-9]{24}$/D', $id)) return false;
    $path = $config['storage_path'] . '/leads/' . $id . '.json';
    $lock = fopen($path . '.lock', 'c+b');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) fclose($lock);
        return false;
    }
    try {
        $record = read_json($path);
        if (($record['notification']['status'] ?? '') === 'sent') return true;
        $subject = '=?UTF-8?B?' . base64_encode('Новая заявка с сайта — ' . $id) . '?=';
        $message = "Заявка: {$id}\nДата (UTC): {$record['created_at']}\nИмя: {$record['name']}\nСпособ связи: {$record['contact_method']}\nКонтакт: {$record['contact']}\nУслуга: {$record['service_name']}\n\nЗаявка сохранена в закрытом журнале сайта.\n";
        $headers = ['From' => 'Diana Website <' . $config['from_email'] . '>', 'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8'];
        if ($record['contact_method'] === 'email') $headers['Reply-To'] = $record['contact'];
        $sent = false;
        try { $sent = @mail($config['notification_email'], $subject, $message, $headers); }
        catch (Throwable) { error_log('Diana: mail transport failed'); }
        $record['notification'] = ['status' => $sent ? 'sent' : 'pending',
            'attempts' => ((int)($record['notification']['attempts'] ?? 0)) + 1,
            'last_attempt_at' => gmdate('c')];
        if ($sent) $record['notification']['sent_at'] = gmdate('c');
        write_json($path, $record);
        return $sent;
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }
}

function prune_requests(): array
{
    return storage_lock(static function (array $config): array {
        $deleted = 0;
        foreach (glob($config['storage_path'] . '/leads/L-*.json') ?: [] as $path) {
            $record = read_json($path);
            if (strtotime($record['expires_at']) > time()) continue;
            $lock = fopen($path . '.lock', 'c+b');
            if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
                if (is_resource($lock)) fclose($lock);
                continue;
            }
            try { if (unlink($path)) $deleted++; }
            finally { flock($lock, LOCK_UN); fclose($lock); }
            @unlink($path . '.lock');
        }
        foreach (glob($config['storage_path'] . '/rates/*.json') ?: [] as $path) {
            if (filemtime($path) < time() - $config['rate_window_seconds'] * 2) @unlink($path);
        }
        foreach (['leads', 'rates'] as $directory) {
            foreach (glob($config['storage_path'] . '/' . $directory . '/*.tmp') ?: [] as $path) {
                if (filemtime($path) < time() - 3600) @unlink($path);
            }
        }
        foreach (glob($config['storage_path'] . '/sessions/sess_*') ?: [] as $path) {
            if (filemtime($path) < time() - 7200) @unlink($path);
        }
        return ['deleted_requests' => $deleted];
    });
}
