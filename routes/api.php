<?php

use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use Illuminate\Support\Facades\Route;

// Session management
Route::post('/sessions', [SessionController::class, 'store'])->middleware('throttle:api.create');
Route::get('/sessions/{pin}', [SessionController::class, 'show'])->middleware('throttle:api.pin');
Route::post('/sessions/{pin}/join', [SessionController::class, 'join'])->middleware('throttle:api.join');
Route::get('/sessions/{pin}/players', [SessionController::class, 'players']);

// Teacher controls (protected by teacher token)
Route::middleware('teacher.auth')->group(function () {
    Route::post('/sessions/{pin}/start', [SessionController::class, 'start']);
    Route::post('/sessions/{pin}/next', [SessionController::class, 'next']);
    Route::post('/sessions/{pin}/reveal', [SessionController::class, 'reveal']);
    Route::post('/sessions/{pin}/pause', [SessionController::class, 'pause']);
    Route::post('/sessions/{pin}/resume', [SessionController::class, 'resume']);
    Route::post('/sessions/{pin}/end', [SessionController::class, 'end']);
    Route::post('/sessions/{pin}/reset', [SessionController::class, 'reset']);
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
