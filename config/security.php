<?php
declare(strict_types=1);
return [
    'X-Content-Type-Options' => 'nosniff',
    'X-Frame-Options' => 'DENY',
    'Referrer-Policy' => 'strict-origin-when-cross-origin',
    'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy' => 'default-src \'self\'; base-uri \'self\'; object-src \'none\'; frame-ancestors \'none\'; form-action \'self\'; script-src \'self\' https://mc.yandex.ru https://mc.yandex.com \'sha256-EWwlkcUo0LmuqqDcEBaC0lE3yrMg/85agohgltd87NY=\'; style-src \'self\'; font-src \'self\'; img-src \'self\' data: https://*.yandex.ru https://*.yandex.com; connect-src \'self\' https://*.yandex.ru https://*.yandex.com; frame-src \'none\'',
];
