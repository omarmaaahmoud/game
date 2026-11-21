<?php

namespace App\Http\Controllers;

use App\Models\GameSession;
use App\Models\Player;
use App\Models\Answer;
use App\Events\StudentAnswered;
use App\Events\LeaderboardUpdated;
use App\Events\ResultsRevealed;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;

class GameController extends Controller
{
    // Get current question with choices (no correct answer revealed)
    public function currentQuestion(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $question = $session->currentQuestion();

        if (!$question) {
            return response()->json(['error' => 'No current question'], 404);
        }

        return response()->json([
            'question' => [
                'id' => $question->id,
                'question_text' => $question->question_text,
                'question_text_ar' => $question->question_text_ar,
                'time_limit' => $question->time_limit,
                'order' => $question->order,
                'choices' => $question->choices->map(fn ($c) => [
                    'id' => $c->id,
                    'choice_text' => $c->choice_text,
                    'choice_text_ar' => $c->choice_text_ar,
                    'order' => $c->order,
                ]),
            ],
            'question_number' => $session->current_question_index + 1,
            'total_questions' => $session->questions()->count(),
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Student submits answer
    public function answer(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        if ($session->status !== 'active' || $session->question_state !== 'answering') {
            return response()->json([
                'error' => 'Game is not active',
                'code' => 'GAME_NOT_ACTIVE',
            ], 422);
        }

        $validated = $request->validate([
            'player_id' => 'required|integer|exists:players,id',
            'choice_id' => 'required|integer|exists:choices,id',
            'time_taken' => 'nullable|numeric|min:0', // accepted for backward compatibility, ignored
        ]);

        $nowMs = (int) round(microtime(true) * 1000);
        $startedAt = $session->question_started_at;

        if ($startedAt === null) {
            return response()->json([
                'error' => 'Question is not active for answering',
                'code' => 'NOT_STARTED',
            ], 422);
        }

        $question = $session->currentQuestion();
        if (!$question) {
            return response()->json([
                'error' => 'No active question',
                'code' => 'NO_QUESTION',
            ], 422);
        }

        // Reject answers received before the official server-side question start
        if ($nowMs < $startedAt) {
            return response()->json([
                'error' => 'Question has not started yet',
                'code' => 'TOO_EARLY',
            ], 422);
        }

        // Check if deadline + grace has passed
        $graceMs = (int) config('quiz.answer_grace_ms', 1000);
        $timeLimitMs = ((int) $question->time_limit) * 1000;
        $deadlineMs = $startedAt + $timeLimitMs + $graceMs;

        if ($nowMs > $deadlineMs) {
            return response()->json([
                'error' => 'Time is up for this question',
                'code' => 'TIME_EXPIRED',
            ], 422);
        }

        $playerToken = $request->header('X-Player-Token') ?: $request->input('player_token');
        if (!$playerToken) {
            return response()->json([
                'error' => 'Player authorization required',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $player = Player::where('id', $validated['player_id'])->first();
        if (!$player || (int) $player->game_session_id !== (int) $session->id) {
            return response()->json([
                'error' => 'Unauthorized player action',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $providedPlayerHash = hash('sha256', (string) $playerToken);
        if (!$player->token_hash || !hash_equals($player->token_hash, $providedPlayerHash)) {
            return response()->json([
                'error' => 'Unauthorized player action',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        // Check if choice belongs to this question
        $choice = $question->choices()->find($validated['choice_id']);
        if (!$choice) {
            return response()->json([
                'error' => 'Invalid choice for this question',
                'code' => 'INVALID_CHOICE',
            ], 422);
        }

        // Compute time_taken purely on server clamped to [0, time_limit]
        // Since $nowMs >= $startedAt, $elapsedSeconds is non-negative
        $elapsedSeconds = ($nowMs - $startedAt) / 1000;
        $timeTaken = min($elapsedSeconds, (float) $question->time_limit);

        $isCorrect = $choice->is_correct;
        $points = 0;

        if ($isCorrect) {
            // Kahoot formula: between 500 and 1000 points max based on response speed
            $timeLimit = max(1, (int) ($question->time_limit ?: 20));
            $speedRatio = max(0, min(1, ($timeLimit - $timeTaken) / $timeLimit));
            $points = (int) round(500 + ($speedRatio * 500)); // Max 1000 points
        }

        // Execute DB operations inside an atomic transaction to prevent race conditions & double-scoring
        try {
            $transactionResult = DB::transaction(function () use ($player, $question, $choice, $isCorrect, $timeTaken, $points) {
                // Check if already answered within lock
                $existing = Answer::where('player_id', $player->id)
                    ->where('question_id', $question->id)
                    ->first();

                if ($existing) {
                    return ['duplicate' => true];
                }

                if ($isCorrect) {
                    $newStreak = $player->streak + 1;
                    $player->update([
                        'score' => $player->score + $points,
                        'streak' => $newStreak,
                    ]);
                } else {
                    $player->update(['streak' => 0]);
                }

                $answer = Answer::create([
                    'player_id' => $player->id,
                    'question_id' => $question->id,
                    'choice_id' => $choice->id,
                    'is_correct' => $isCorrect,
                    'time_taken' => $timeTaken,
                    'points_earned' => $points,
                    'answered_at' => now(),
                ]);

                return ['answer' => $answer];
            });

            if (!empty($transactionResult['duplicate'])) {
                return response()->json(['error' => 'Already answered this question'], 422);
            }
        } catch (QueryException $e) {
            // Unique constraint violation handled cleanly
            return response()->json(['error' => 'Already answered this question'], 422);
        }

        // Realtime event broadcasts AFTER database transaction successfully committed!
        $answeredCount = Answer::where('question_id', $question->id)->count();
        $totalPlayers = $session->players()->count();

        broadcast(new StudentAnswered(
            $session->pin,
            $player->id,
            $player->name,
            $answeredCount,
            $totalPlayers
        ));

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

        broadcast(new LeaderboardUpdated($session->pin, $leaderboard));

        // When QUIZ_REVEAL_ON_ANSWER is false (default), do not reveal answer or score early
        $revealOnAnswer = (bool) config('quiz.reveal_on_answer', false);
        if (!$revealOnAnswer) {
            return response()->json([
                'accepted' => true,
                'server_now_ms' => (int) round(microtime(true) * 1000),
            ]);
        }

        return response()->json([
            'is_correct' => $isCorrect,
            'points_earned' => $points,
            'total_score' => $player->fresh()->score,
            'streak' => $player->fresh()->streak,
            'correct_choice_id' => $choice->question->choices()->where('is_correct', true)->first()?->id,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Student gets their own result for the current question ONLY after reveal
    public function myResult(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        $playerToken = $request->header('X-Player-Token') ?: $request->input('player_token');
        if (!$playerToken) {
            return response()->json([
                'error' => 'Player authorization required',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $tokenHash = hash('sha256', (string) $playerToken);
        $player = Player::where('game_session_id', $session->id)
            ->where('token_hash', $tokenHash)
            ->first();

        if (!$player) {
            return response()->json([
                'error' => 'Unauthorized player action',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $question = $session->currentQuestion();
        if (!$question) {
            return response()->json([
                'error' => 'No active question',
                'code' => 'NO_QUESTION',
            ], 422);
        }

        // Before reveal, return 409 Conflict
        if ($session->question_state !== 'revealed') {
            return response()->json([
                'error' => 'Question result is not revealed yet',
                'code' => 'NOT_REVEALED',
            ], 409);
        }

        $correctChoice = $question->choices()->where('is_correct', true)->first();
        $answer = Answer::where('player_id', $player->id)
            ->where('question_id', $question->id)
            ->first();

        if (!$answer) {
            return response()->json([
                'answered' => false,
                'is_correct' => false,
                'points_earned' => 0,
                'total_score' => (int) $player->score,
                'streak' => (int) $player->streak,
                'choice_id' => null,
                'correct_choice_id' => $correctChoice?->id,
                'server_now_ms' => (int) round(microtime(true) * 1000),
            ]);
        }

        return response()->json([
            'answered' => true,
            'is_correct' => (bool) $answer->is_correct,
            'points_earned' => (int) $answer->points_earned,
            'total_score' => (int) $player->score,
            'streak' => (int) $player->streak,
            'choice_id' => $answer->choice_id,
            'correct_choice_id' => $correctChoice?->id,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Get leaderboard
    public function leaderboard(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        $players = $session->players()
            ->orderByDesc('score')
            ->get(['id', 'name', 'avatar', 'score', 'streak']);

        return response()->json([
            'leaderboard' => $players->values()->map(function ($player, $index) {
                return [
                    'rank' => $index + 1,
                    'id' => $player->id,
                    'name' => $player->name,
                    'avatar' => $player->avatar,
                    'score' => $player->score,
                    'streak' => $player->streak,
                ];
            }),
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Get final results
    public function results(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->with(['questions.choices', 'players.answers'])->firstOrFail();

        $players = $session->players->sortByDesc('score')->values()->map(function ($player, $index) {
            $totalAnswers = $player->answers->count();
            $correctAnswers = $player->answers->where('is_correct', true)->count();

            return [
                'rank' => $index + 1,
                'id' => $player->id,
                'name' => $player->name,
                'avatar' => $player->avatar,
                'score' => $player->score,
                'total_answers' => $totalAnswers,
                'correct_answers' => $correctAnswers,
                'accuracy' => $totalAnswers > 0 ? round(($correctAnswers / $totalAnswers) * 100) : 0,
            ];
        });

        broadcast(new ResultsRevealed(
            $session->pin,
            $session->title,
            $session->questions->count(),
            $session->players->count(),
            $players->all()
        ));

        return response()->json([
            'title' => $session->title,
            'total_questions' => $session->questions->count(),
            'total_players' => $session->players->count(),
            'results' => $players,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }
}
