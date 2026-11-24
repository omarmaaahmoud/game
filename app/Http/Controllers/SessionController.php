<?php

namespace App\Http\Controllers;

use App\Models\GameSession;
use App\Models\Question;
use App\Models\Choice;
use App\Events\PlayerJoined;
use App\Events\GameStarted;
use App\Events\QuestionChanged;
use App\Events\AnswerRevealed;
use App\Events\LeaderboardUpdated;
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
        $maxQuestions = config('quiz.max_questions', 50);

        $validated = $request->validate([
            'teacher_name' => 'required|string|max:100',
            'title' => 'required|string|max:200',
            'questions' => "required|array|min:1|max:{$maxQuestions}",
            'questions.*.question_text' => 'required|string|max:500',
            'questions.*.question_text_ar' => 'nullable|string|max:500',
            'questions.*.time_limit' => 'nullable|integer|min:5|max:120',
            'questions.*.choices' => 'required|array|min:2|max:6',
            'questions.*.choices.*.choice_text' => 'required|string|max:200',
            'questions.*.choices.*.choice_text_ar' => 'nullable|string|max:200',
            'questions.*.choices.*.is_correct' => 'required|boolean',
        ]);

        foreach ($validated['questions'] as $qi => $qData) {
            $hasCorrect = collect($qData['choices'])->contains(fn ($c) => !empty($c['is_correct']));
            if (!$hasCorrect) {
                return response()->json([
                    'error' => 'Question ' . ($qi + 1) . ' must have at least one correct choice',
                    'code' => 'INVALID_CHOICES',
                ], 422);
            }
        }

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
            return response()->json([
                'error' => 'This session has ended',
                'code' => 'SESSION_COMPLETED',
            ], 422);
        }

        $maxPlayers = config('quiz.max_players_per_session', 100);
        if ($session->players()->count() >= $maxPlayers) {
            return response()->json([
                'error' => 'Session is full',
                'code' => 'SESSION_FULL',
            ], 422);
        }

        $allowedAvatars = [
            'spongebob', 'patrick', 'squidward', 'tom', 'jerry',
            'smurf', 'papa-smurf', 'papasmurf', 'batman', 'gumball',
            'leonardo', 'boy-skateboard',
            'astronaut', 'ninja', 'robot', 'wizard', 'superhero',
            'artist', 'unicorn', 'dragon', 'cat', 'pirate', 'alien', 'fairy',
        ];

        $allowedAccessories = [
            'none', 'crown', 'cap', 'tophat', 'party-hat', 'glasses',
            'mask', 'star', 'heart', 'fire',
        ];

        $rawName = $request->input('name');
        if (!is_string($rawName) || trim($rawName) === '') {
            return response()->json([
                'error' => 'Player name is required and cannot be empty',
                'code' => 'NAME_INVALID',
            ], 422);
        }

        // Sanitize: strip script/style tags and contents, then strip remaining HTML tags
        $cleanName = preg_replace('#<(script|style)\b[^>]*>(.*?)</\1>#is', '', $rawName);
        $cleanName = trim(strip_tags($cleanName));

        if ($cleanName === '' || mb_strlen($cleanName) > 20) {
            return response()->json([
                'error' => 'Player name must be between 1 and 20 characters',
                'code' => 'NAME_INVALID',
            ], 422);
        }

        $validated = $request->validate([
            'avatar' => 'required|string|in:' . implode(',', $allowedAvatars),
            'accessory' => 'nullable|string|in:' . implode(',', $allowedAccessories),
        ]);

        if ($session->players()->where('name', $cleanName)->exists()) {
            return response()->json([
                'error' => 'Player name already taken in this session',
                'code' => 'NAME_TAKEN',
            ], 422);
        }

        $playerToken = bin2hex(random_bytes(32));
        $playerTokenHash = hash('sha256', $playerToken);

        $player = $session->players()->create([
            'name' => $cleanName,
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

                DB::afterCommit(function () use ($session, $formattedQ, $totalQuestions) {
                    broadcast(new GameStarted($session->pin, $formattedQ, $totalQuestions, 0));
                });

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

                    DB::afterCommit(function () use ($session) {
                        broadcast(new GameFinished($session->pin));
                    });

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

                DB::afterCommit(function () use ($session, $formattedQ, $nextIndex, $totalQuestions, $startedAt, $currentVersion) {
                    broadcast(new QuestionChanged($session->pin, $formattedQ, $nextIndex, $totalQuestions, $startedAt, $currentVersion + 1));
                });

                return response()->json([
                    'status' => 'active',
                    'current_question_index' => $nextIndex,
                    'total_questions' => $totalQuestions,
                    'question_state' => 'answering',
                    'question_started_at' => $startedAt,
                    'state_version' => $currentVersion + 1,
                    'current_question' => $formattedQ,
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
        return DB::transaction(function () use ($pin) {
            $session = GameSession::where('pin', $pin)->firstOrFail();

            // Idempotent: if already revealed, return current state
            if ($session->question_state === 'revealed') {
                $currentQuestion = $session->currentQuestion();
                $correctChoice = $currentQuestion?->choices()->where('is_correct', true)->first();
                $correctChoiceId = $correctChoice ? (int) $correctChoice->id : 0;
                return response()->json([
                    'question_state' => 'revealed',
                    'correct_choice_id' => $correctChoiceId,
                    'state_version' => (int) $session->state_version,
                    'server_now_ms' => (int) round(microtime(true) * 1000),
                ]);
            }

            $currentVersion = (int) $session->state_version;
            $session->update([
                'question_state' => 'revealed',
                'state_version' => $currentVersion + 1,
            ]);

            $currentQuestion = $session->currentQuestion();
            $correctChoice = $currentQuestion?->choices()->where('is_correct', true)->first();
            $correctChoiceId = $correctChoice ? (int) $correctChoice->id : 0;

            $leaderboard = $session->players()
                ->orderByDesc('score')
                ->take(12)
                ->get(['id', 'name', 'avatar', 'score', 'streak'])
                ->values()
                ->map(function ($p, $index) {
                    return [
                        'rank' => $index + 1,
                        'id' => $p->id,
                        'name' => $p->name,
                        'avatar' => $p->avatar,
                        'score' => $p->score,
                        'streak' => $p->streak,
                    ];
                })
                ->all();

            DB::afterCommit(function () use ($session, $correctChoiceId, $currentQuestion, $leaderboard) {
                broadcast(new AnswerRevealed($session->pin, $correctChoiceId, $currentQuestion?->id));
                broadcast(new LeaderboardUpdated($session->pin, $leaderboard));
            });

            return response()->json([
                'question_state' => 'revealed',
                'correct_choice_id' => $correctChoiceId,
                'state_version' => $currentVersion + 1,
                'server_now_ms' => (int) round(microtime(true) * 1000),
            ]);
        });
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
        return DB::transaction(function () use ($pin) {
            $session = GameSession::where('pin', $pin)->firstOrFail();
            $currentVersion = (int) $session->state_version;
            $session->update([
                'status' => 'completed',
                'question_state' => 'revealed',
                'question_started_at' => null,
                'question_paused_remaining_ms' => null,
                'state_version' => $currentVersion + 1,
            ]);

            DB::afterCommit(function () use ($session) {
                broadcast(new GameFinished($session->pin));
            });

            return response()->json([
                'status' => 'completed',
                'state_version' => $currentVersion + 1,
                'server_now_ms' => (int) round(microtime(true) * 1000),
            ]);
        });
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

            DB::afterCommit(function () use ($session) {
                broadcast(new SessionReset($session->pin));
            });
        });

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
        $allQuestions = $session->questions()->with(['choices' => fn($q) => $q->orderBy('order')])->orderBy('order')->get();
        $totalQuestions = $allQuestions->count();
        $currentQuestion = $allQuestions->get($session->current_question_index);

        $durationMs = $currentQuestion ? ((int) ($currentQuestion->time_limit ?: 20) * 1000) : 20000;
        $pausedRemaining = $session->question_paused_remaining_ms !== null
            ? min($durationMs, (int) $session->question_paused_remaining_ms)
            : null;

        return [
            'id' => $session->id,
            'pin' => $session->pin,
            'title' => $session->title,
            'status' => $session->status,
            'current_question_index' => (int) $session->current_question_index,
            'question_state' => $session->question_state ?? 'answering',
            'question_started_at' => $session->question_started_at ? (int) $session->question_started_at : null,
            'state_version' => (int) ($session->state_version ?? 0),
            'question_paused_remaining_ms' => $pausedRemaining,
            'total_questions' => $totalQuestions,
            'player_count' => $session->players()->count(),
            'timestamp' => now()->toISOString(),
            'leaderboard' => $session->players()->orderByDesc('score')->take(12)->get(['id', 'name', 'avatar', 'score', 'streak'])->values()->map(function ($player, $index) {
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

    // Get authenticated player state (reconnection / tab switch)
    public function me(Request $request, string $pin): JsonResponse
    {
        $token = $request->header('X-Player-Token')
            ?: $request->bearerToken()
            ?: $request->query('player_token');

        if (!$token) {
            return response()->json([
                'error' => 'Player token is required',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 401);
        }

        $session = GameSession::where('pin', $pin)->first();
        if (!$session) {
            return response()->json([
                'error' => 'Session not found',
                'code' => 'NOT_FOUND',
            ], 404);
        }

        $tokenHash = hash('sha256', $token);
        $player = $session->players()->where('token_hash', $tokenHash)->first();
        if (!$player) {
            return response()->json([
                'error' => 'Invalid player token',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $currentQuestion = $session->currentQuestion();
        $answer = null;
        $hasAnswered = false;
        if ($currentQuestion) {
            $answerRecord = \App\Models\Answer::where('player_id', $player->id)
                ->where('question_id', $currentQuestion->id)
                ->first();
            if ($answerRecord) {
                $hasAnswered = true;
                $answer = [
                    'choice_id' => $answerRecord->choice_id,
                ];
                if ($session->question_state === 'revealed') {
                    $answer['is_correct'] = (bool) $answerRecord->is_correct;
                    $answer['points_earned'] = (int) $answerRecord->points_earned;
                }
            }
        }

        $sessionData = $this->serializeSessionState($session);

        return response()->json([
            'player' => [
                'id' => $player->id,
                'name' => $player->name,
                'avatar' => $player->avatar,
                'score' => (int) $player->score,
                'streak' => (int) $player->streak,
            ],
            'session' => $sessionData,
            'answered' => $hasAnswered,
            'answer' => $answer,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
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
