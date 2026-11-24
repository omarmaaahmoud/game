<?php

namespace App\Http\Middleware;

use App\Http\Controllers\TeacherAuthController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Global teacher authentication middleware.
 *
 * Validates X-Teacher-Auth (or Authorization: Bearer) against persisted
 * server-side tokens issued by TeacherAuthController::auth(), enforcing
 * expiry, revocation, and TEACHER_ACCESS_KEY configuration.
 */
class EnsureTeacherGlobalAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $accessKey = config('quiz.teacher_access_key');

        // Fail closed: if no access key is configured, deny all requests
        if ($accessKey === null || $accessKey === '') {
            return response()->json([
                'error' => 'Teacher access key not configured on server',
                'code' => 'SERVICE_UNAVAILABLE',
            ], 503);
        }

        // Extract from header only (never query string or request body)
        $provided = $request->header('X-Teacher-Auth') ?: $request->bearerToken();

        if (empty($provided)) {
            return response()->json([
                'error' => 'Teacher authorization required',
                'code' => 'UNAUTHORIZED_TEACHER',
            ], 403);
        }

        if (!TeacherAuthController::verifyPortalToken((string) $provided)) {
            return response()->json([
                'error' => 'Invalid, expired, or revoked teacher portal token',
                'code' => 'UNAUTHORIZED_TEACHER',
            ], 403);
        }

        return $next($request);
    }
}
