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
        $pin = (string) (
            $request->route('pin')
            ?? $request->input('pin')
            ?? ($request->segment(2) === 'sessions' ? $request->segment(3) : null)
            ?? ($request->segment(1) === 'sessions' ? $request->segment(2) : null)
        );

        $session = GameSession::where('pin', $pin)->first();

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

        // Extract token from X-Teacher-Token, Authorization Bearer, or request body
        $token = $request->header('X-Teacher-Token')
            ?: $request->bearerToken()
            ?: $request->input('teacher_token');

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
