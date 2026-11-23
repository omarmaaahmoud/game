<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(at: '*');
        $middleware->alias([
            'teacher.auth' => \App\Http\Middleware\EnsureTeacherAuthorized::class,
        ]);
        $middleware->append(\App\Http\Middleware\SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (\Throwable $e, \Illuminate\Http\Request $request) {
            if ($request->is('api/*')) {
                if ($e instanceof \Illuminate\Validation\ValidationException) {
                    return response()->json([
                        'error' => 'Validation failed',
                        'errors' => $e->errors(),
                    ], 422);
                }

                if ($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) {
                    return response()->json([
                        'error' => $e->getMessage() ?: 'Request failed',
                        'code' => 'HTTP_ERROR',
                    ], $e->getStatusCode());
                }

                if (!config('app.debug')) {
                    return response()->json([
                        'error' => 'Internal server error',
                        'code' => 'SERVER_ERROR',
                    ], 500);
                }
            }
        });
    })
    ->booted(function () {
        if (config('database.default') === 'sqlite') {
            try {
                \Illuminate\Support\Facades\DB::statement('PRAGMA journal_mode = WAL;');
                \Illuminate\Support\Facades\DB::statement('PRAGMA synchronous = NORMAL;');
                \Illuminate\Support\Facades\DB::statement('PRAGMA busy_timeout = 5000;');
                \Illuminate\Support\Facades\DB::statement('PRAGMA cache_size = -20000;');
            } catch (\Throwable $e) {}
        }

        // Configure Rate Limiters
        \Illuminate\Support\Facades\RateLimiter::for('api.create', function (\Illuminate\Http\Request $request) {
            return \Illuminate\Cache\RateLimiting\Limit::perMinute(20)->by($request->ip());
        });

        \Illuminate\Support\Facades\RateLimiter::for('api.pin', function (\Illuminate\Http\Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            return \Illuminate\Cache\RateLimiting\Limit::perMinute(120)->by($pin . '|' . $request->ip());
        });

        \Illuminate\Support\Facades\RateLimiter::for('api.join', function (\Illuminate\Http\Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            return \Illuminate\Cache\RateLimiting\Limit::perMinute(60)->by($pin . '|' . $request->ip());
        });

        \Illuminate\Support\Facades\RateLimiter::for('api.answer', function (\Illuminate\Http\Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            $playerKey = $request->header('X-Player-Token')
                ?? $request->input('player_token')
                ?? $request->input('player_id')
                ?? $request->ip();

            return \Illuminate\Cache\RateLimiting\Limit::perMinute(60)->by($pin . '|' . $playerKey);
        });
    })->create();

