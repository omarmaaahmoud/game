<?php

namespace App\Http\Controllers;

use App\Models\GameSession;
use App\Models\Question;
use App\Models\Choice;
use App\Events\PlayerJoined;
use App\Events\GameStarted;
use App\Events\QuestionChanged;
use App\Events\AnswerRevealed;
use App\Events\GameFinished;
use App\Events\SessionReset;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class SessionController extends Controller
{
    // Teacher creates a new session with questions
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'teacher_name' => 'required|string|max:100',
            'title' => 'required|string|max:200',
            'questions' => 'required|array|min:1',
            'questions.*.question_text' => 'required|string',
            'questions.*.question_text_ar' => 'nullable|string',
            'questions.*.time_limit' => 'nullable|integer|min:5|max:120',
            'questions.*.choices' => 'required|array|min:2|max:6',
            'questions.*.choices.*.choice_text' => 'required|string',
            'questions.*.choices.*.choice_text_ar' => 'nullable|string',
            'questions.*.choices.*.is_correct' => 'required|boolean',
        ]);

        $teacherToken = bin2hex(random_bytes(32));
        $teacherTokenHash = hash('sha256', $teacherToken);

        $session = GameSession::create([
            'pin' => GameSession::generatePin(),
            'teacher_token_hash' => $teacherTokenHash,
            'teacher_name' => $validated['teacher_name'],
            'title' => $validated['title'],
        ]);

        foreach ($validated['questions'] as $qi => $qData) {
            $question = $session->questions()->create([
                'question_text' => $qData['question_text'],
                'question_text_ar' => $qData['question_text_ar'] ?? null,
                'order' => $qi,
                'time_limit' => $qData['time_limit'] ?? 20,
            ]);

            foreach ($qData['choices'] as $ci => $cData) {
                $question->choices()->create([
                    'choice_text' => $cData['choice_text'],
                    'choice_text_ar' => $cData['choice_text_ar'] ?? null,
                    'is_correct' => $cData['is_correct'],
                    'order' => $ci,
                ]);
            }
        }

        return response()->json([
            'session' => $session->load('questions.choices'),
            'pin' => $session->pin,
            'teacher_token' => $teacherToken,
        ], 201);
    }

    // Get session info (for students joining)
    public function show(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        return response()->json([
            'id' => $session->id,
            'pin' => $session->pin,
            'title' => $session->title,
            'teacher_name' => $session->teacher_name,
            'status' => $session->status,
            'total_questions' => $session->questions()->count(),
            'player_count' => $session->players()->count(),
        ]);
    }

    // Student joins session
    public function join(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        if ($session->status === 'completed') {
            return response()->json(['error' => 'This session has ended'], 422);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:50',
            'avatar' => 'required|string|max:50',
        ]);

        $playerToken = bin2hex(random_bytes(32));
        $playerTokenHash = hash('sha256', $playerToken);

        $player = $session->players()->create([
            'name' => $validated['name'],
            'avatar' => $validated['avatar'],
            'token_hash' => $playerTokenHash,
            'joined_at' => now(),
        ]);

        $playerCount = $session->players()->count();

        // Broadcast player joined event to all clients on session
        broadcast(new PlayerJoined($session->pin, [
            'id' => $player->id,
            'name' => $player->name,
            'avatar' => $player->avatar,
            'score' => $player->score ?? 0,
            'streak' => $player->streak ?? 0,
        ], $playerCount));

        return response()->json([
            'player' => $player,
            'player_token' => $playerToken,
            'session' => [
                'title' => $session->title,
                'status' => $session->status,
                'total_questions' => $session->questions()->count(),
            ],
        ], 201);
    }

    // Get players in session
    public function players(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        return response()->json([
            'players' => $session->players()->get(['id', 'name', 'avatar', 'score', 'streak']),
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Teacher starts the game
    public function start(string $pin): JsonResponse
    {
        try {
            return DB::transaction(function () use ($pin) {
                $session = GameSession::where('pin', $pin)->firstOrFail();

                // Idempotent: if already active, return current state
                if ($session->status === 'active') {
                    return response()->json([
                        'status' => 'active',
                        'current_question_index' => (int) $session->current_question_index,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                $nowMs = (int) round(microtime(true) * 1000);
                $leadMs = config('quiz.sync_lead_ms', 2000);
                $startedAt = $nowMs + $leadMs;
                $currentVersion = (int) $session->state_version;

                $affected = GameSession::where('id', $session->id)
                    ->where('status', 'waiting')
                    ->where('state_version', $currentVersion)
                    ->update([
                        'status' => 'active',
                        'current_question_index' => 0,
                        'question_state' => 'answering',
                        'question_started_at' => $startedAt,
                        'question_paused_remaining_ms' => null,
                        'state_version' => $currentVersion + 1,
                    ]);

                if ($affected === 0) {
                    $session->refresh();
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => (int) $session->current_question_index,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                $firstQuestion = $session->questions()->with('choices')->orderBy('order')->first();
                $formattedQ = $firstQuestion ? [
                    'id' => $firstQuestion->id,
                    'question_text' => $firstQuestion->question_text,
                    'question_text_ar' => $firstQuestion->question_text_ar,
                    'time_limit' => $firstQuestion->time_limit,
                    'order' => $firstQuestion->order,
                    'choices' => $firstQuestion->choices->map(fn ($c) => [
                        'id' => $c->id,
                        'choice_text' => $c->choice_text,
                        'choice_text_ar' => $c->choice_text_ar,
                        'order' => $c->order,
                    ])->values()->all(),
                ] : null;

                $totalQuestions = $session->questions()->count();

                broadcast(new GameStarted($session->pin, $formattedQ, $totalQuestions, 0));

                return response()->json([
                    'status' => 'active',
                    'current_question_index' => 0,
                    'question_state' => 'answering',
                    'question_started_at' => $startedAt,
                    'state_version' => $currentVersion + 1,
                    'server_now_ms' => (int) round(microtime(true) * 1000),
                ]);
            }, 5);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'database is locked') || str_contains($e->getMessage(), 'busy')) {
                $session = GameSession::where('pin', $pin)->first();
                if ($session) {
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => (int) $session->current_question_index,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }
            }
            throw $e;
        }
    }

    // Teacher advances to next question
    public function next(Request $request, string $pin): JsonResponse
    {
        try {
            return DB::transaction(function () use ($request, $pin) {
                $session = GameSession::where('pin', $pin)->firstOrFail();
                $allQuestions = $session->questions()->with('choices')->orderBy('order')->get();
                $totalQuestions = $allQuestions->count();
                $nowMs = (int) round(microtime(true) * 1000);

                $currentIndex = (int) $session->current_question_index;
                $currentVersion = (int) $session->state_version;

                // Idempotency guard 1: caller expected_index mismatch
                $expectedIndex = $request->input('expected_index');
                if ($expectedIndex !== null && (int) $expectedIndex !== $currentIndex) {
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => $currentIndex,
                        'total_questions' => $totalQuestions,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => $currentVersion,
                        'server_now_ms' => $nowMs,
                    ]);
                }

                // Idempotency guard 2: rapid double click within 800ms
                if ($session->question_started_at !== null &&
                    $session->question_state === 'answering' &&
                    abs($nowMs - $session->question_started_at) < 800) {
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => $currentIndex,
                        'total_questions' => $totalQuestions,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => $currentVersion,
                        'server_now_ms' => $nowMs,
                    ]);
                }

                $nextIndex = $currentIndex + 1;

                if ($nextIndex >= $totalQuestions) {
                    $affected = GameSession::where('id', $session->id)
                        ->where('current_question_index', $currentIndex)
                        ->where('state_version', $currentVersion)
                        ->update([
                            'status' => 'completed',
                            'question_state' => 'revealed',
                            'question_started_at' => null,
                            'question_paused_remaining_ms' => null,
                            'state_version' => $currentVersion + 1,
                        ]);

                    if ($affected === 0) {
                        $session->refresh();
                        return response()->json([
                            'status' => $session->status,
                            'current_question_index' => (int) $session->current_question_index,
                            'message' => 'All questions done',
                            'state_version' => (int) $session->state_version,
                            'server_now_ms' => (int) round(microtime(true) * 1000),
                        ]);
                    }

                    broadcast(new GameFinished($session->pin));
                    return response()->json([
                        'status' => 'completed',
                        'message' => 'All questions done',
                        'state_version' => $currentVersion + 1,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                $leadMs = config('quiz.sync_lead_ms', 2000);
                $startedAt = $nowMs + $leadMs;

                // Atomic conditional update preventing concurrent question skips
                $affected = GameSession::where('id', $session->id)
                    ->where('current_question_index', $currentIndex)
                    ->where('state_version', $currentVersion)
                    ->update([
                        'current_question_index' => $nextIndex,
                        'status' => 'active',
                        'question_state' => 'answering',
                        'question_started_at' => $startedAt,
                        'question_paused_remaining_ms' => null,
                        'state_version' => $currentVersion + 1,
                    ]);

                if ($affected === 0) {
                    $session->refresh();
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => (int) $session->current_question_index,
                        'total_questions' => $totalQuestions,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                $nextQuestion = $allQuestions->get($nextIndex);
                $formattedQ = $nextQuestion ? [
                    'id' => $nextQuestion->id,
                    'question_text' => $nextQuestion->question_text,
                    'question_text_ar' => $nextQuestion->question_text_ar,
                    'time_limit' => $nextQuestion->time_limit,
                    'order' => $nextQuestion->order,
                    'choices' => $nextQuestion->choices->map(fn ($c) => [
                        'id' => $c->id,
                        'choice_text' => $c->choice_text,
                        'choice_text_ar' => $c->choice_text_ar,
                        'order' => $c->order,
                    ])->values()->all(),
                ] : [];

                broadcast(new QuestionChanged($session->pin, $formattedQ, $nextIndex, $totalQuestions));

                return response()->json([
                    'status' => 'active',
                    'current_question_index' => $nextIndex,
                    'total_questions' => $totalQuestions,
                    'question_state' => 'answering',
                    'question_started_at' => $startedAt,
                    'state_version' => $currentVersion + 1,
                    'server_now_ms' => (int) round(microtime(true) * 1000),
                ]);
            }, 5);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'database is locked') || str_contains($e->getMessage(), 'busy')) {
                $session = GameSession::where('pin', $pin)->first();
                if ($session) {
                    $totalQuestions = $session->questions()->count();
                    return response()->json([
                        'status' => $session->status,
                        'current_question_index' => (int) $session->current_question_index,
                        'total_questions' => $totalQuestions,
                        'question_state' => $session->question_state,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }
            }
            throw $e;
        }
    }

    // Teacher reveals the correct answer
    public function reveal(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update([
            'question_state' => 'revealed',
            'state_version' => $session->state_version + 1,
        ]);

        $currentQuestion = $session->currentQuestion();
        $correctChoice = $currentQuestion?->choices()->where('is_correct', true)->first();
        $correctChoiceId = $correctChoice ? (int) $correctChoice->id : 0;

        broadcast(new AnswerRevealed($session->pin, $correctChoiceId, $currentQuestion?->id));

        return response()->json([
            'question_state' => 'revealed',
            'correct_choice_id' => $correctChoiceId,
            'state_version' => $session->state_version,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Teacher pauses
    public function pause(string $pin): JsonResponse
    {
        try {
            return DB::transaction(function () use ($pin) {
                $session = GameSession::where('pin', $pin)->firstOrFail();

                // Idempotent: repeated pause requests must not recalculate or destroy saved remaining time
                if ($session->status === 'paused') {
                    return response()->json([
                        'status' => 'paused',
                        'question_paused_remaining_ms' => $session->question_paused_remaining_ms,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                // Only active sessions can be paused
                if ($session->status !== 'active') {
                    return response()->json([
                        'error' => 'Session is not active to pause',
                        'code' => 'INVALID_STATE',
                    ], 422);
                }

                $nowMs = (int) round(microtime(true) * 1000);
                $currentQuestion = $session->currentQuestion();
                $durationMs = ($currentQuestion?->time_limit ?: 20) * 1000;

                $remainingMs = $durationMs;
                if ($session->question_started_at !== null) {
                    if ($nowMs < $session->question_started_at) {
                        // Paused during the 2-second synchronization lead period!
                        // Full duration is preserved; flag lead period by adding remaining lead
                        $remainingLeadMs = max(1, $session->question_started_at - $nowMs);
                        $remainingMs = $durationMs + $remainingLeadMs;
                    } else {
                        $elapsedMs = max(0, $nowMs - $session->question_started_at);
                        $remainingMs = max(0, $durationMs - $elapsedMs);
                    }
                }

                $currentVersion = (int) $session->state_version;
                $affected = GameSession::where('id', $session->id)
                    ->where('status', 'active')
                    ->where('state_version', $currentVersion)
                    ->update([
                        'status' => 'paused',
                        'question_paused_remaining_ms' => $remainingMs,
                        'state_version' => $currentVersion + 1,
                    ]);

                if ($affected === 0) {
                    $session->refresh();
                    return response()->json([
                        'status' => $session->status,
                        'question_paused_remaining_ms' => $session->question_paused_remaining_ms,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                return response()->json([
                    'status' => 'paused',
                    'question_paused_remaining_ms' => $remainingMs,
                    'state_version' => $currentVersion + 1,
                    'server_now_ms' => (int) round(microtime(true) * 1000),
                ]);
            }, 5);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'database is locked') || str_contains($e->getMessage(), 'busy')) {
                $session = GameSession::where('pin', $pin)->first();
                if ($session) {
                    return response()->json([
                        'status' => $session->status,
                        'question_paused_remaining_ms' => $session->question_paused_remaining_ms,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }
            }
            throw $e;
        }
    }

    // Teacher resumes
    public function resume(string $pin): JsonResponse
    {
        try {
            return DB::transaction(function () use ($pin) {
                $session = GameSession::where('pin', $pin)->firstOrFail();

                // Idempotent: repeated resume requests must not restart or extend the timer
                if ($session->status === 'active') {
                    return response()->json([
                        'status' => 'active',
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                // Only paused sessions can be resumed
                if ($session->status !== 'paused') {
                    return response()->json([
                        'error' => 'Session is not paused to resume',
                        'code' => 'INVALID_STATE',
                    ], 422);
                }

                $nowMs = (int) round(microtime(true) * 1000);
                $currentQuestion = $session->currentQuestion();
                $durationMs = ($currentQuestion?->time_limit ?: 20) * 1000;
                $leadMs = config('quiz.sync_lead_ms', 2000);

                $newStartedAt = $session->question_started_at;
                if ($session->question_paused_remaining_ms !== null) {
                    if ($session->question_paused_remaining_ms > $durationMs) {
                        // Paused during synchronization lead period: resume with synchronization lead!
                        $newStartedAt = $nowMs + $leadMs;
                    } else {
                        // Paused during answering phase: resume preserving exact remaining duration
                        $newStartedAt = $nowMs - ($durationMs - $session->question_paused_remaining_ms);
                    }
                }

                $currentVersion = (int) $session->state_version;
                $affected = GameSession::where('id', $session->id)
                    ->where('status', 'paused')
                    ->where('state_version', $currentVersion)
                    ->update([
                        'status' => 'active',
                        'question_started_at' => $newStartedAt,
                        'question_paused_remaining_ms' => null,
                        'state_version' => $currentVersion + 1,
                    ]);

                if ($affected === 0) {
                    $session->refresh();
                    return response()->json([
                        'status' => $session->status,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }

                return response()->json([
                    'status' => 'active',
                    'question_started_at' => $newStartedAt,
                    'state_version' => $currentVersion + 1,
                    'server_now_ms' => (int) round(microtime(true) * 1000),
                ]);
            }, 5);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'database is locked') || str_contains($e->getMessage(), 'busy')) {
                $session = GameSession::where('pin', $pin)->first();
                if ($session) {
                    return response()->json([
                        'status' => $session->status,
                        'question_started_at' => $session->question_started_at,
                        'state_version' => (int) $session->state_version,
                        'server_now_ms' => (int) round(microtime(true) * 1000),
                    ]);
                }
            }
            throw $e;
        }
    }

    // Teacher ends game
    public function end(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update([
            'status' => 'completed',
            'question_state' => 'revealed',
            'question_started_at' => null,
            'question_paused_remaining_ms' => null,
            'state_version' => $session->state_version + 1,
        ]);

        broadcast(new GameFinished($session->pin));

        return response()->json([
            'status' => 'completed',
            'state_version' => $session->state_version,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Teacher resets session to play again
    public function reset(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        DB::transaction(function () use ($session) {
            $playerIds = $session->players()->pluck('id');
            \App\Models\Answer::whereIn('player_id', $playerIds)->delete();
            $session->players()->delete();
            $session->update([
                'status' => 'waiting',
                'current_question_index' => 0,
                'question_state' => 'answering',
                'question_started_at' => null,
                'question_paused_remaining_ms' => null,
                'state_version' => $session->state_version + 1,
            ]);
        });

        // Broadcast after commit
        broadcast(new SessionReset($session->pin));

        return response()->json([
            'status' => 'waiting',
            'message' => 'Session reset successfully',
            'session' => $session,
            'state_version' => $session->state_version,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Helper to serialize session state consistently
    private function serializeSessionState(GameSession $session): array
    {
        $allQuestions = $session->questions;
        $totalQuestions = $allQuestions->count();
        $currentQuestion = $allQuestions->get($session->current_question_index);

        $durationMs = $currentQuestion ? ((int) ($currentQuestion->time_limit ?: 20) * 1000) : 20000;
        $pausedRemaining = $session->question_paused_remaining_ms !== null
            ? min($durationMs, (int) $session->question_paused_remaining_ms)
            : null;

        return [
            'status' => $session->status,
            'current_question_index' => (int) $session->current_question_index,
            'question_state' => $session->question_state ?? 'answering',
            'question_started_at' => $session->question_started_at ? (int) $session->question_started_at : null,
            'state_version' => (int) ($session->state_version ?? 0),
            'question_paused_remaining_ms' => $pausedRemaining,
            'total_questions' => $totalQuestions,
            'player_count' => $session->players->count(),
            'timestamp' => now()->toISOString(),
            'leaderboard' => $session->players->sortByDesc('score')->values()->take(12)->map(function ($player, $index) {
                return [
                    'rank' => $index + 1,
                    'id' => $player->id,
                    'name' => $player->name,
                    'avatar' => $player->avatar,
                    'score' => $player->score,
                    'streak' => $player->streak,
                ];
            })->all(),
            'current_question' => $currentQuestion ? [
                'id' => $currentQuestion->id,
                'question_text' => $currentQuestion->question_text,
                'question_text_ar' => $currentQuestion->question_text_ar,
                'time_limit' => $currentQuestion->time_limit,
                'order' => $currentQuestion->order,
                'correct_choice_id' => ($session->question_state === 'revealed')
                    ? $currentQuestion->choices->where('is_correct', true)->first()?->id
                    : null,
                'choices' => $currentQuestion->choices->map(fn ($c) => [
                    'id' => $c->id,
                    'choice_text' => $c->choice_text,
                    'choice_text_ar' => $c->choice_text_ar,
                    'order' => $c->order,
                ])->values()->all(),
            ] : null,
        ];
    }

    // Polling endpoint (Fast eager loading for snappy realtime response)
    public function poll(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)
            ->with(['questions.choices', 'players'])
            ->firstOrFail();

        $data = $this->serializeSessionState($session);
        $data['server_now_ms'] = (int) round(microtime(true) * 1000);

        return response()->json($data);
    }

    // Dedicated state synchronization endpoint (shares exact serializer with poll)
    public function state(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)
            ->with(['questions.choices', 'players'])
            ->firstOrFail();

        $data = $this->serializeSessionState($session);
        $data['server_now_ms'] = (int) round(microtime(true) * 1000);

        return response()->json($data);
    }
}
