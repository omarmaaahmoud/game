<?php

use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\TeacherAuthController;
use Illuminate\Support\Facades\Route;

// Teacher portal authentication (Section 7)
Route::post('/teacher/auth', [TeacherAuthController::class, 'auth'])->middleware('throttle:api.auth');
Route::middleware('teacher.global')->group(function () {
    Route::get('/teacher/verify', [TeacherAuthController::class, 'verify']);
    Route::post('/teacher/logout', [TeacherAuthController::class, 'logout']);
    Route::post('/sessions', [SessionController::class, 'store'])->middleware('throttle:api.create');
});

// Session lookup & student join
Route::get('/sessions/{pin}', [SessionController::class, 'show'])->middleware('throttle:api.pin');
Route::post('/sessions/{pin}/join', [SessionController::class, 'join'])->middleware('throttle:api.join');
Route::get('/sessions/{pin}/players', [SessionController::class, 'players']);
Route::get('/sessions/{pin}/me', [SessionController::class, 'me']);

// Teacher controls (protected by teacher token)
Route::middleware('teacher.auth')->group(function () {
    Route::post('/sessions/{pin}/start', [SessionController::class, 'start']);
    Route::post('/sessions/{pin}/next', [SessionController::class, 'next']);
    Route::post('/sessions/{pin}/reveal', [SessionController::class, 'reveal']);
    Route::post('/sessions/{pin}/mid-leaderboard', [SessionController::class, 'showMidLeaderboard']);
    Route::post('/sessions/{pin}/pause', [SessionController::class, 'pause']);
    Route::post('/sessions/{pin}/resume', [SessionController::class, 'resume']);
    Route::post('/sessions/{pin}/end', [SessionController::class, 'end']);
    Route::post('/sessions/{pin}/reset', [SessionController::class, 'reset']);
    Route::get('/sessions/{pin}/question-stats', [GameController::class, 'questionStats']);
});

// Game play
Route::get('/sessions/{pin}/current-question', [GameController::class, 'currentQuestion']);
Route::post('/sessions/{pin}/answer', [GameController::class, 'answer'])->middleware('throttle:api.answer');
Route::get('/sessions/{pin}/my-result', [GameController::class, 'myResult']);
Route::get('/sessions/{pin}/leaderboard', [GameController::class, 'leaderboard']);
Route::get('/sessions/{pin}/results', [GameController::class, 'results']);

// Polling & state synchronization
Route::get('/sessions/{pin}/poll', [SessionController::class, 'poll']);
Route::get('/sessions/{pin}/state', [SessionController::class, 'state']);

// Health check endpoint (O2)
Route::get('/health', function () {
    $dbOk = false;
    try {
        \Illuminate\Support\Facades\DB::connection()->getPdo();
        $dbOk = true;
    } catch (\Throwable $e) {
        $dbOk = false;
    }

    return response()->json([
        'status' => $dbOk ? 'ok' : 'degraded',
        'database' => $dbOk ? 'connected' : 'error',
        'server_now_ms' => (int) round(microtime(true) * 1000),
    ], $dbOk ? 200 : 503);
});
