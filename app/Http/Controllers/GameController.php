<?php

namespace App\Http\Controllers;

use App\Models\GameSession;
use App\Models\Player;
use App\Models\Answer;
use App\Events\StudentAnswered;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;

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

        // 1. Check player token and player ownership FIRST (S1.4, header-only)
        $playerToken = $request->header('X-Player-Token');
        if (!$playerToken) {
            return response()->json([
                'error' => 'Player authorization required',
                'code' => 'UNAUTHORIZED_PLAYER',
            ], 403);
        }

        $validated = $request->validate([
            'player_id' => 'required|integer',
            'choice_id' => 'required|integer',
            'time_taken' => 'nullable|numeric|min:0', // accepted for backward compatibility, ignored
        ]);

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

        // 2. Check game status
        if ($session->status !== 'active' || $session->question_state !== 'answering') {
            return response()->json([
                'error' => 'Game is not active',
                'code' => 'GAME_NOT_ACTIVE',
            ], 422);
        }

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

        $nowMs = (int) round(microtime(true) * 1000);

        // Reject answers received before official server-side question start
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

        // Check if choice belongs to this question
        $choice = $question->choices()->find($validated['choice_id']);
        if (!$choice) {
            return response()->json([
                'error' => 'Invalid choice for this question',
                'code' => 'INVALID_CHOICE',
            ], 422);
        }

        // Compute time_taken purely on server clamped to [0, time_limit]
        $elapsedSeconds = ($nowMs - $startedAt) / 1000;
        $timeTaken = min($elapsedSeconds, (float) $question->time_limit);

        $isCorrect = (bool) $choice->is_correct;
        $points = 0;

        if ($isCorrect) {
            // Kahoot formula: between 500 and 1000 points max based on response speed
            $timeLimit = max(1, (int) ($question->time_limit ?: 20));
            $speedRatio = max(0, min(1, ($timeLimit - $timeTaken) / $timeLimit));
            $points = (int) round(500 + ($speedRatio * 500)); // Max 1000 points
        }

        // Atomic write-first player update + answer insert to prevent concurrent reset/state-change orphans & double scoring (S1.3)
        try {
            DB::transaction(function () use ($session, $player, $question, $choice, $isCorrect, $timeTaken, $points) {
                // First SQL in transaction: conditional write verifying player still exists and session is still active & answering
                $affectedPlayer = DB::table('players')
                    ->where('id', $player->id)
                    ->where('game_session_id', $session->id)
                    ->whereExists(function ($q) use ($session, $question) {
                        $q->select(DB::raw(1))
                            ->from('game_sessions')
                            ->where('id', $session->id)
                            ->where('status', 'active')
                            ->where('question_state', 'answering')
                            ->where('current_question_index', $question->order);
                    })
                    ->update([
                        'score' => $isCorrect ? DB::raw('score + ' . (int) $points) : DB::raw('score'),
                        'streak' => $isCorrect ? DB::raw('streak + 1') : 0,
                        'updated_at' => now(),
                    ]);

                if ($affectedPlayer === 0) {
                    throw new \RuntimeException('GAME_NOT_ACTIVE_CONCURRENT');
                }

                Answer::create([
                    'player_id' => $player->id,
                    'question_id' => $question->id,
                    'choice_id' => $choice->id,
                    'is_correct' => $isCorrect,
                    'time_taken' => $timeTaken,
                    'points_earned' => $points,
                    'answered_at' => now(),
                ]);

                DB::afterCommit(function () use ($session, $player, $question) {
                    $answeredCount = Answer::where('question_id', $question->id)->count();
                    $totalPlayers = $session->players()->count();

                    // Broadcast StudentAnswered WITHOUT player_name for privacy (S1.5)
                    broadcast(new StudentAnswered(
                        $session->pin,
                        $player->id,
                        '',
                        $answeredCount,
                        $totalPlayers
                    ));
                });
            }, 5);
        } catch (UniqueConstraintViolationException $e) {
            return response()->json([
                'error' => 'Already answered this question',
                'code' => 'ALREADY_ANSWERED',
            ], 409);
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'UNIQUE') || str_contains($e->getMessage(), 'unique')) {
                return response()->json([
                    'error' => 'Already answered this question',
                    'code' => 'ALREADY_ANSWERED',
                ], 409);
            }
            if (str_contains($e->getMessage(), 'database is locked') || str_contains($e->getMessage(), 'busy')) {
                return response()->json([
                    'error' => 'Database is temporarily busy, please retry',
                    'code' => 'DATABASE_BUSY',
                ], 503, ['Retry-After' => 1]);
            }
            throw $e;
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'GAME_NOT_ACTIVE_CONCURRENT') {
                return response()->json([
                    'error' => 'Game is not active',
                    'code' => 'GAME_NOT_ACTIVE',
                ], 422);
            }
            throw $e;
        }

        // When QUIZ_REVEAL_ON_ANSWER is false (default), do not reveal answer or score early
        $revealOnAnswer = (bool) config('quiz.reveal_on_answer', false);
        if (!$revealOnAnswer) {
            return response()->json([
                'accepted' => true,
                'server_now_ms' => (int) round(microtime(true) * 1000),
            ]);
        }

        $freshPlayer = $player->fresh();
        return response()->json([
            'is_correct' => $isCorrect,
            'points_earned' => $points,
            'total_score' => $freshPlayer->score,
            'streak' => $freshPlayer->streak,
            'correct_choice_id' => $choice->question->choices()->where('is_correct', true)->first()?->id,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Student gets their own result for the current question ONLY after reveal (S1.6 with question_id)
    public function myResult(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        $playerToken = $request->header('X-Player-Token');
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

        $currentQuestion = $session->currentQuestion();
        // Fail closed if there is no valid current question
        if (!$currentQuestion) {
            return response()->json([
                'error' => 'No active question',
                'code' => 'NO_QUESTION',
            ], 422);
        }

        $questionId = $request->query('question_id');

        if ($questionId) {
            $targetQuestion = $session->questions()->find($questionId);
            if (!$targetQuestion) {
                return response()->json([
                    'error' => 'Question not found in session',
                    'code' => 'NO_QUESTION',
                ], 422);
            }
            if ((int) $targetQuestion->order > (int) $currentQuestion->order) {
                return response()->json([
                    'error' => 'Question is in future',
                    'code' => 'NOT_REVEALED',
                ], 409);
            }
            if ((int) $targetQuestion->id === (int) $currentQuestion->id) {
                if ($session->question_state !== 'revealed') {
                    return response()->json([
                        'error' => 'Question result is not revealed yet',
                        'code' => 'NOT_REVEALED',
                    ], 409);
                }
            } elseif (!(bool) $targetQuestion->is_revealed) {
                // Historical question was skipped without ever being revealed
                return response()->json([
                    'error' => 'Question result was not revealed',
                    'code' => 'NOT_REVEALED',
                ], 409);
            }
            $question = $targetQuestion;
        } else {
            $question = $currentQuestion;
            if ($session->question_state !== 'revealed') {
                return response()->json([
                    'error' => 'Question result is not revealed yet',
                    'code' => 'NOT_REVEALED',
                ], 409);
            }
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

    // Get current leaderboard with my_rank and my_score (S1.5)
    public function leaderboard(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        $players = $session->players()
            ->orderByDesc('score')
            ->orderBy('id', 'asc')
            ->take(12)
            ->get(['id', 'name', 'avatar', 'score', 'streak']);

        $myRank = null;
        $myScore = null;
        $playerToken = $request->header('X-Player-Token');
        if ($playerToken) {
            $tokenHash = hash('sha256', (string) $playerToken);
            $currentPlayer = Player::where('game_session_id', $session->id)
                ->where('token_hash', $tokenHash)
                ->first();
            if ($currentPlayer) {
                $myScore = (int) $currentPlayer->score;
                $myRank = $session->players()->where('score', '>', $currentPlayer->score)->count() + 1;
            }
        }

        return response()->json([
            'pin' => $session->pin,
            'leaderboard' => $players->values()->map(function ($player, $index) {
                return [
                    'rank' => $index + 1,
                    'id' => $player->id,
                    'name' => $player->name,
                    'avatar' => $player->avatar,
                    'score' => $player->score,
                    'streak' => $player->streak,
                ];
            })->all(),
            'my_rank' => $myRank,
            'my_score' => $myScore,
            'total_players' => $session->players()->count(),
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Teacher inspects question answer distribution stats (S1.1)
    public function questionStats(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        if ($session->question_state !== 'revealed') {
            return response()->json([
                'error' => 'Question is not revealed yet',
                'code' => 'NOT_REVEALED',
            ], 409);
        }

        $question = $session->currentQuestion();
        if (!$question) {
            return response()->json([
                'error' => 'No active question',
                'code' => 'NO_QUESTION',
            ], 404);
        }

        $counts = Answer::where('question_id', $question->id)
            ->select('choice_id', DB::raw('count(*) as count'))
            ->groupBy('choice_id')
            ->pluck('count', 'choice_id')
            ->all();

        $stats = $question->choices->map(function ($choice) use ($counts) {
            return [
                'choice_id' => $choice->id,
                'choice_text' => $choice->choice_text,
                'choice_text_ar' => $choice->choice_text_ar,
                'is_correct' => (bool) $choice->is_correct,
                'count' => $counts[$choice->id] ?? 0,
            ];
        });

        return response()->json([
            'question_id' => $question->id,
            'correct_choice_id' => $question->choices->where('is_correct', true)->first()?->id,
            'total_answers' => array_sum($counts),
            'stats' => $stats,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }

    // Get final results (S1.1 - 409 if not completed, NO broadcasts on GET)
    public function results(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        if ($session->status !== 'completed') {
            return response()->json([
                'error' => 'Game is not completed',
                'code' => 'NOT_COMPLETED',
            ], 409);
        }

        $players = $session->players()
            ->with('answers')
            ->orderByDesc('score')
            ->orderBy('id', 'asc')
            ->get()
            ->values()
            ->map(function ($player, $index) {
                $totalAnswers = $player->answers->count();
                $correctAnswers = $player->answers->where('is_correct', true)->count();
                $avgTime = $totalAnswers > 0 ? round($player->answers->avg('time_taken'), 2) : 0;
                $accuracy = $totalAnswers > 0 ? round(($correctAnswers / $totalAnswers) * 100) : 0;

                return [
                    'rank' => $index + 1,
                    'id' => (int) $player->id,
                    'name' => $player->name,
                    'avatar' => $player->avatar,
                    'score' => (int) $player->score,
                    'streak' => (int) $player->streak,
                    'total_answers' => $totalAnswers,
                    'correct_answers' => $correctAnswers,
                    'avg_time' => $avgTime,
                    'accuracy' => $accuracy,
                ];
            });

        return response()->json([
            'pin' => $session->pin,
            'state_version' => (int) ($session->state_version ?? 0),
            'title' => $session->title,
            'total_questions' => $session->questions()->count(),
            'total_players' => $players->count(),
            'results' => $players,
            'server_now_ms' => (int) round(microtime(true) * 1000),
        ]);
    }
}
