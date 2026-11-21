<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
}
