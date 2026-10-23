<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/layout.php';
security_headers();
header('Cache-Control: no-store, max-age=0');
header('X-Robots-Tag: noindex, nofollow');

$json = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');
function fail_request(int $status, string $message, array $errors = [], array $values = []): never
{
    global $json;
    http_response_code($status);
    if ($json) {
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['ok' => false, 'message' => $message, 'errors' => $errors], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } else {
        render_request_page($values, $errors, $message);
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    fail_request(405, 'Для отправки заявки используйте форму на сайте.');
}
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192 || !empty($_FILES)) {
    fail_request(413, 'Слишком большой запрос. Используйте короткую форму без вложений.');
}
$contentType = strtolower(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]);
if (!in_array($contentType, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
    fail_request(415, 'Используйте форму записи на сайте.');
}
try {
    $config = app_config();
    if (isset($_SERVER['HTTP_ORIGIN']) && !in_array($_SERVER['HTTP_ORIGIN'], $config['allowed_origins'], true)) {
        fail_request(403, 'Отправьте заявку с формы на этом сайте.');
    }
    start_request_session();
    $csrf = text_field($_POST, 'csrf', 64);
    $ticket = text_field($_POST, 'ticket', 48);
    if ($csrf === '' || !hash_equals($_SESSION['csrf'], $csrf)
        || $ticket === '' || !isset($_SESSION['tickets'][$ticket])) {
        fail_request(403, 'Время действия формы истекло. Откройте страницу записи заново и повторите отправку.');
    }
    if (($_POST['website'] ?? '') !== '') {
        fail_request(400, 'Не удалось отправить форму. Обновите страницу или напишите мне напрямую.');
    }
    [$values, $errors] = validate_request($_POST);
    if ($errors) fail_request(422, 'Проверьте отмеченные поля.', $errors, $values);
    $result = save_request($values, $_POST, $ticket);
    $_SESSION['receipt'] = ['lead_id' => $result['lead_id'], 'time' => time()];
    session_write_close();
    // Persisted leads survive a failed notification. No payment is created here.
    try { send_notification($result['lead_id']); }
    catch (Throwable) { error_log('Diana: saved request notification remains pending'); }
    if ($json) {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code($result['duplicate'] ? 200 : 201);
        echo json_encode(['ok' => true] + $result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }
    header('Location: /request.php?done=1', true, 303);
    exit;
} catch (RequestRateLimit) {
    header('Retry-After: 900');
    fail_request(429, 'С этого соединения уже поступило несколько заявок. Попробуйте позже или напишите мне напрямую.');
} catch (RequestConflict) {
    fail_request(409, 'Эта форма уже была отправлена. Для нового обращения откройте страницу записи заново.');
} catch (Throwable) {
    error_log('Diana: request service is temporarily unavailable');
    fail_request(503, 'Форма временно недоступна. Напишите мне в Telegram, WhatsApp или на электронную почту.');
}
