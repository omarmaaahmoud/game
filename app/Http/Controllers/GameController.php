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
        ]);
    }

    // Student submits answer
    public function answer(Request $request, string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();

        if ($session->status !== 'active') {
            return response()->json(['error' => 'Game is not active'], 422);
        }

        $validated = $request->validate([
            'player_id' => 'required|integer|exists:players,id',
            'choice_id' => 'required|integer|exists:choices,id',
            'time_taken' => 'required|numeric|min:0',
        ]);

        $question = $session->currentQuestion();
        if (!$question) {
            return response()->json(['error' => 'No active question'], 422);
        }

        $player = Player::findOrFail($validated['player_id']);

        // Check if choice belongs to this question
        $choice = $question->choices()->find($validated['choice_id']);
        if (!$choice) {
            return response()->json(['error' => 'Invalid choice for this question'], 422);
        }

        $isCorrect = $choice->is_correct;
        $timeTaken = min($validated['time_taken'], $question->time_limit);
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

        return response()->json([
            'is_correct' => $isCorrect,
            'points_earned' => $points,
            'total_score' => $player->fresh()->score,
            'streak' => $player->fresh()->streak,
            'correct_choice_id' => $choice->question->choices()->where('is_correct', true)->first()?->id,
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
        ]);
    }
}
