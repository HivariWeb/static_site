<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/layout.php';
security_headers();
header('Cache-Control: no-store, max-age=0');
header('X-Robots-Tag: noindex, follow');
$service = text_field($_GET, 'service', 30);
if (!array_key_exists($service, services())) $service = 'help';
render_request_page(['service' => $service]);
