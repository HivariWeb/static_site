<?php
declare(strict_types=1);
// Local PHP server only. Start with: php -S 127.0.0.1:8080 -t . tools/dev-router.php
$root = realpath(__DIR__ . '/..');
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
require_once __DIR__ . '/../includes/bootstrap.php';
security_headers();
if (preg_match('~(?:^|/)\.(?!well-known(?:/|$))|^/(?:includes|config|tools|tests|docs|audit-[^/]+|backups)(?:/|$)|(?:_snippet\.(?:html|js|css)|\.docx)$~i', $path)) {
    http_response_code(403); echo 'Access denied'; return true;
}
if (preg_match('~[\\\\\x00]~', $path)) {
    http_response_code(400); return true;
}
if ($path === '/index.html') {
    $query = parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY);
    header('Location: /' . ($query !== null ? '?' . $query : ''), true, 301); return true;
}
$relative = $path === '/' ? '/index.html' : $path;
$file = realpath($root . $relative);
if ($file === false || !str_starts_with(str_replace('\\', '/', $file), str_replace('\\', '/', $root) . '/') || !is_file($file)) {
    http_response_code(404); header('Content-Type: text/html; charset=UTF-8'); readfile($root . '/404.html'); return true;
}
if ($relative === '/api/leads.php' || $relative === '/request.php' || $relative === '/send-email.php') {
    require $file; return true;
}
if (str_ends_with(strtolower($file), '.php')) {
    http_response_code(404); return true;
}
$types=['html'=>'text/html; charset=UTF-8','css'=>'text/css; charset=UTF-8','js'=>'text/javascript; charset=UTF-8',
        'json'=>'application/json; charset=UTF-8','xml'=>'application/xml; charset=UTF-8','txt'=>'text/plain; charset=UTF-8',
        'woff2'=>'font/woff2','webp'=>'image/webp','png'=>'image/png','jpg'=>'image/jpeg','svg'=>'image/svg+xml'];
header('Content-Type: ' . ($types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
header('Cache-Control: no-cache');
readfile($file); return true;
