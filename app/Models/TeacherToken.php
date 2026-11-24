<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TeacherToken extends Model
{
    protected $fillable = [
        'token_hash',
        'key_fingerprint',
        'expires_at',
        'revoked_at',
    ];

    protected $hidden = [
        'token_hash',
        'key_fingerprint',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];
}
