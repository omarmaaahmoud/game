<?php

use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use Illuminate\Support\Facades\Route;

// Session management
Route::post('/sessions', [SessionController::class, 'store']);
Route::get('/sessions/{pin}', [SessionController::class, 'show']);
Route::post('/sessions/{pin}/join', [SessionController::class, 'join']);
Route::get('/sessions/{pin}/players', [SessionController::class, 'players']);

// Teacher controls
Route::post('/sessions/{pin}/start', [SessionController::class, 'start']);
Route::post('/sessions/{pin}/next', [SessionController::class, 'next']);
Route::post('/sessions/{pin}/reveal', [SessionController::class, 'reveal']);
Route::post('/sessions/{pin}/pause', [SessionController::class, 'pause']);
Route::post('/sessions/{pin}/resume', [SessionController::class, 'resume']);
Route::post('/sessions/{pin}/end', [SessionController::class, 'end']);
Route::post('/sessions/{pin}/reset', [SessionController::class, 'reset']);

// Game play
Route::get('/sessions/{pin}/current-question', [GameController::class, 'currentQuestion']);
Route::post('/sessions/{pin}/answer', [GameController::class, 'answer']);
Route::get('/sessions/{pin}/leaderboard', [GameController::class, 'leaderboard']);
Route::get('/sessions/{pin}/results', [GameController::class, 'results']);

// Polling
Route::get('/sessions/{pin}/poll', [SessionController::class, 'poll']);

