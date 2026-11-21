<?php

$allowedOrigins = env('CORS_ALLOWED_ORIGINS');
if ($allowedOrigins) {
    $origins = array_values(array_filter(array_map('trim', explode(',', $allowedOrigins))));
} else {
    $origins = [
        'https://game-2-production-55c99ce0.up.railway.app',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:8000',
        'http://localhost:8000',
    ];
}

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $origins,
    'allowed_origins_patterns' => [
        '#^https://.*\.vercel\.app$#',
    ],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];


