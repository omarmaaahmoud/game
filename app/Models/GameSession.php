<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GameSession extends Model
{
    protected $fillable = [
        'pin',
        'teacher_name',
        'title',
        'status',
        'current_question_index',
        'question_state',
        'question_started_at',
        'state_version',
        'question_paused_remaining_ms',
    ];

    protected $casts = [
        'question_started_at' => 'integer',
        'state_version' => 'integer',
        'question_paused_remaining_ms' => 'integer',
        'current_question_index' => 'integer',
    ];

    public function questions(): HasMany
    {
        return $this->hasMany(Question::class)->orderBy('order');
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class)->orderByDesc('score');
    }

    public function currentQuestion(): ?Question
    {
        return $this->questions()->skip($this->current_question_index)->first();
    }

    public static function generatePin(): string
    {
        do {
            $pin = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } while (static::where('pin', $pin)->exists());

        return $pin;
    }
}
