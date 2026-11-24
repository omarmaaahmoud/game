<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        if (config('database.default') === 'sqlite') {
            try {
                DB::statement('PRAGMA journal_mode = WAL;');
                DB::statement('PRAGMA synchronous = NORMAL;');
                DB::statement('PRAGMA busy_timeout = 5000;');
                DB::statement('PRAGMA cache_size = -20000;');
            } catch (\Throwable $e) {}
        }

        // Configure Rate Limiters
        RateLimiter::for('api.create', function (Request $request) {
            return Limit::perMinute(20)->by($request->ip());
        });

        RateLimiter::for('api.auth', function (Request $request) {
            return Limit::perMinute(10)->by($request->ip());
        });

        RateLimiter::for('api.pin', function (Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            return Limit::perMinute(120)->by($pin . '|' . $request->ip());
        });

        RateLimiter::for('api.join', function (Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            return Limit::perMinute(120)->by($pin . '|' . $request->ip());
        });

        RateLimiter::for('api.answer', function (Request $request) {
            $pin = (string) ($request->route('pin') ?: $request->segment(3) ?: 'global');
            // Rate limit answers by pin + player token so classroom students sharing NAT IP are not throttled
            // S1.4: header-only token extraction — never read token from query/body
            $playerKey = $request->header('X-Player-Token') ?? $request->ip();

            return Limit::perMinute(30)->by($pin . '|' . $playerKey);
        });
    }
}

