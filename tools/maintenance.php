<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../includes/bootstrap.php';
try {
    $result = prune_requests();
    $sent = 0;
    $checked = 0;
    foreach (glob(app_config()['storage_path'] . '/leads/L-*.json') ?: [] as $path) {
        $lead = read_json($path);
        if (($lead['notification']['status'] ?? '') === 'sent') continue;
        if (++$checked > 20) break;
        if (send_notification($lead['id'])) $sent++;
    }
    echo json_encode($result + ['notification_attempts' => min($checked, 20), 'notifications_sent' => $sent], JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable) {
    fwrite(STDERR, "Website maintenance failed; check private configuration and storage.\n");
    exit(1);
}
