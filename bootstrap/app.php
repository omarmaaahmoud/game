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
            'teacher.global' => \App\Http\Middleware\EnsureTeacherGlobalAuth::class,
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
    })->create();

