<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

class GameSession extends Model
{
    protected $fillable = [
        'pin',
        'teacher_token_hash',
        'teacher_name',
        'title',
        'status',
        'current_question_index',
        'question_state',
        'show_mid_leaderboard',
        'question_started_at',
        'state_version',
        'question_paused_remaining_ms',
    ];

    protected $hidden = [
        'teacher_token_hash',
    ];

    protected $casts = [
        'question_started_at' => 'integer',
        'state_version' => 'integer',
        'question_paused_remaining_ms' => 'integer',
        'current_question_index' => 'integer',
        'show_mid_leaderboard' => 'boolean',
    ];

    public function questions(): HasMany
    {
        return $this->hasMany(Question::class)->orderBy('order');
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class)->orderByDesc('score')->orderBy('id', 'asc');
    }

    public function currentQuestion(): ?Question
    {
        return $this->questions()->skip($this->current_question_index)->first();
    }

    public static function generatePin(): string
    {
        $attempts = 0;
        do {
            $pin = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $attempts++;
            if ($attempts > 100) {
                throw new \RuntimeException('Unable to generate unique PIN');
            }
        } while (static::where('pin', $pin)->where('status', '!=', 'completed')->exists());

        return $pin;
    }

    /**
     * Atomically reveal the active answering question inside the caller's transaction.
     *
     * @return array{question_id: int|null, correct_choice_id: int, state_version: int, leaderboard: array}|null
     */
    public function revealCurrentQuestionInTransaction(?Question $currentQuestion = null, ?int $expectedVersion = null): ?array
    {
        $question = $currentQuestion ?? $this->currentQuestion();
        $version = $expectedVersion ?? (int) DB::table('game_sessions')
            ->where('id', $this->id)
            ->value('state_version');

        $query = DB::table('game_sessions')
            ->where('id', $this->id)
            ->where('status', 'active')
            ->where('question_state', 'answering')
            ->where('state_version', $version);

        if ($question) {
            $query->where('current_question_index', $question->order);
        }

        $affected = $query->update([
            'question_state' => 'revealed',
            'show_mid_leaderboard' => false,
            'state_version' => $version + 1,
            'updated_at' => now(),
        ]);

        if ($affected === 0) {
            return null;
        }

        if ($question) {
            DB::table('questions')->where('id', $question->id)->update(['is_revealed' => true]);
        }

        $correctChoiceId = $question
            ? (int) ($question->choices()->where('is_correct', true)->value('id') ?? 0)
            : 0;

        $leaderboard = $this->players()
            ->orderByDesc('score')
            ->orderBy('id', 'asc')
            ->take(12)
            ->get(['id', 'name', 'avatar', 'score', 'streak'])
            ->values()
            ->map(fn ($p, $index) => [
                'rank' => $index + 1,
                'id' => $p->id,
                'name' => $p->name,
                'avatar' => $p->avatar,
                'score' => $p->score,
                'streak' => $p->streak,
            ])
            ->all();

        return [
            'question_id' => $question?->id,
            'correct_choice_id' => $correctChoiceId,
            'state_version' => $version + 1,
            'leaderboard' => $leaderboard,
        ];
    }
}
