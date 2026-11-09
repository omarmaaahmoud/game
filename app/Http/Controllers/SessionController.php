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

        $session = GameSession::create([
            'pin' => GameSession::generatePin(),
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

        $player = $session->players()->create([
            'name' => $validated['name'],
            'avatar' => $validated['avatar'],
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
        ]);
    }

    // Teacher starts the game
    public function start(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update(['status' => 'active', 'current_question_index' => 0, 'question_state' => 'answering']);

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

        return response()->json(['status' => 'active', 'current_question_index' => 0, 'question_state' => 'answering']);
    }

    // Teacher advances to next question
    public function next(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $allQuestions = $session->questions()->with('choices')->orderBy('order')->get();
        $totalQuestions = $allQuestions->count();
        $nextIndex = $session->current_question_index + 1;

        if ($nextIndex >= $totalQuestions) {
            $session->update(['status' => 'completed', 'question_state' => 'revealed']);
            broadcast(new GameFinished($session->pin));
            return response()->json(['status' => 'completed', 'message' => 'All questions done']);
        }

        $session->update(['current_question_index' => $nextIndex, 'status' => 'active', 'question_state' => 'answering']);
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
        ]);
    }

    // Teacher reveals the correct answer
    public function reveal(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update(['question_state' => 'revealed']);

        $currentQuestion = $session->currentQuestion();
        $correctChoice = $currentQuestion?->choices()->where('is_correct', true)->first();
        $correctChoiceId = $correctChoice ? (int) $correctChoice->id : 0;

        broadcast(new AnswerRevealed($session->pin, $correctChoiceId, $currentQuestion?->id));

        return response()->json([
            'question_state' => 'revealed',
            'correct_choice_id' => $correctChoiceId,
        ]);
    }

    // Teacher pauses
    public function pause(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update(['status' => 'paused']);
        return response()->json(['status' => 'paused']);
    }

    // Teacher resumes
    public function resume(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update(['status' => 'active']);
        return response()->json(['status' => 'active']);
    }

    // Teacher ends game
    public function end(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)->firstOrFail();
        $session->update(['status' => 'completed', 'question_state' => 'revealed']);

        broadcast(new GameFinished($session->pin));

        return response()->json(['status' => 'completed']);
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
            ]);
        });

        // Broadcast after commit
        broadcast(new SessionReset($session->pin));

        return response()->json([
            'status' => 'waiting',
            'message' => 'Session reset successfully',
            'session' => $session,
        ]);
    }

    // Polling endpoint (Fast eager loading for snappy realtime response)
    public function poll(string $pin): JsonResponse
    {
        $session = GameSession::where('pin', $pin)
            ->with(['questions.choices', 'players'])
            ->firstOrFail();

        $allQuestions = $session->questions;
        $totalQuestions = $allQuestions->count();
        $currentQuestion = $allQuestions->get($session->current_question_index);

        return response()->json([
            'status' => $session->status,
            'current_question_index' => $session->current_question_index,
            'question_state' => $session->question_state ?? 'answering',
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
            }),
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
                ]),
            ] : null,
        ]);
    }
}
