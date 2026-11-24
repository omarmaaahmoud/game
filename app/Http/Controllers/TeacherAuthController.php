<?php

namespace App\Http\Controllers;

use App\Models\TeacherToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeacherAuthController extends Controller
{
    /**
     * Compute a deterministic fingerprint of the configured teacher access key.
     * Rotating TEACHER_ACCESS_KEY invalidates all previously issued tokens.
     */
    private static function keyFingerprint(string $serverKey): string
    {
        return hash('sha256', 'tecorbi_teacher_key_fp:' . $serverKey);
    }

    /**
     * Authenticate a teacher using the TEACHER_ACCESS_KEY env variable.
     * Persists a SHA-256 hash of a random 256-bit portal token with expiry & revocation support.
     */
    public function auth(Request $request): JsonResponse
    {
        $request->validate([
            'access_key' => 'required|string',
        ]);

        $serverKey = config('quiz.teacher_access_key');

        if ($serverKey === null || $serverKey === '') {
            return response()->json([
                'error' => 'Teacher authentication is not configured on this server',
                'code' => 'AUTH_NOT_CONFIGURED',
            ], 503);
        }

        // Timing-safe comparison
        if (!hash_equals((string) $serverKey, (string) $request->input('access_key'))) {
            return response()->json([
                'error' => 'Invalid access key',
                'code' => 'INVALID_KEY',
            ], 403);
        }

        $ttlSeconds = max(60, (int) config('quiz.teacher_token_ttl', 28800));
        $portalToken = bin2hex(random_bytes(32));
        $expiresAt = now()->addSeconds($ttlSeconds);

        TeacherToken::create([
            'token_hash' => hash('sha256', $portalToken),
            'key_fingerprint' => self::keyFingerprint((string) $serverKey),
            'expires_at' => $expiresAt,
        ]);

        // Opportunistic cleanup of expired tokens
        TeacherToken::where('expires_at', '<', now()->subDay())->delete();

        return response()->json([
            'authenticated' => true,
            'teacher_portal_token' => $portalToken,
            'expires_in' => $ttlSeconds,
            'expires_at' => $expiresAt->toISOString(),
        ]);
    }

    /**
     * Verify the caller's portal token (used by frontend boot/portal checks).
     */
    public function verify(): JsonResponse
    {
        return response()->json([
            'authenticated' => true,
        ]);
    }

    /**
     * Revoke the current teacher portal token.
     */
    public function logout(Request $request): JsonResponse
    {
        $token = $request->header('X-Teacher-Auth') ?: $request->bearerToken();
        if (!empty($token)) {
            TeacherToken::where('token_hash', hash('sha256', (string) $token))
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
        }

        return response()->json([
            'revoked' => true,
        ]);
    }

    /**
     * Verify a teacher portal token against persisted DB state.
     * Enforces existence, non-revocation, non-expiry, and key-rotation fingerprint match.
     */
    public static function verifyPortalToken(?string $token): bool
    {
        if (empty($token)) {
            return false;
        }

        $serverKey = config('quiz.teacher_access_key');
        if ($serverKey === null || $serverKey === '') {
            return false;
        }

        $tokenHash = hash('sha256', (string) $token);
        $record = TeacherToken::where('token_hash', $tokenHash)->first();

        if (!$record) {
            return false;
        }

        if ($record->revoked_at !== null) {
            return false;
        }

        if ($record->expires_at === null || $record->expires_at->isPast()) {
            return false;
        }

        $expectedFp = self::keyFingerprint((string) $serverKey);
        if (!hash_equals((string) $record->key_fingerprint, $expectedFp)) {
            return false;
        }

        return true;
    }
}
