<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use App\Models\GameSession;

class EnsureTeacherAuthorized
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $pin = $request->route('pin');

        // Fallback for tests invoking middleware directly without routing
        if ($pin === null && $request->route() === null) {
            $pin = $request->segment(2) === 'sessions' ? $request->segment(3) : $request->segment(2);
        }

        if (empty($pin)) {
            return response()->json([
                'error' => 'PIN is required',
                'code' => 'INVALID_PIN',
            ], 400);
        }

        $session = GameSession::where('pin', (string) $pin)->first();

        if (!$session) {
            return response()->json([
                'error' => 'Session not found',
                'code' => 'NOT_FOUND',
            ], 404);
        }

        // Legacy open session check
        if ($session->teacher_token_hash === null) {
            if (config('quiz.allow_legacy_open_sessions', false)) {
                $request->attributes->set('session', $session);
                return $next($request);
            }

            return response()->json([
                'error' => 'Teacher authorization required',
                'code' => 'UNAUTHORIZED_TEACHER',
            ], 403);
        }

        // Extract token from X-Teacher-Token or Authorization Bearer ONLY (S1.7)
        $token = $request->header('X-Teacher-Token') ?: $request->bearerToken();

        if (!$token) {
            return response()->json([
                'error' => 'Teacher authorization required',
                'code' => 'UNAUTHORIZED_TEACHER',
            ], 403);
        }

        $providedHash = hash('sha256', (string) $token);

        if (!hash_equals($session->teacher_token_hash, $providedHash)) {
            return response()->json([
                'error' => 'Unauthorized teacher action',
                'code' => 'UNAUTHORIZED_TEACHER',
            ], 403);
        }

        $request->attributes->set('session', $session);

        return $next($request);
    }
}
