<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Player extends Model
{
    protected $fillable = ['game_session_id', 'name', 'avatar', 'score', 'streak', 'joined_at'];

    protected $casts = ['joined_at' => 'datetime'];

    public function gameSession(): BelongsTo
    {
        return $this->belongsTo(GameSession::class);
    }

    public function answers(): HasMany
    {
        return $this->hasMany(Answer::class);
    }
}

