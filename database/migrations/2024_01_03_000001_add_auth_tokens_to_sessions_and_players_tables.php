<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('game_sessions', function (Blueprint $table) {
            $table->string('teacher_token_hash', 64)->nullable()->after('pin');
        });

        Schema::table('players', function (Blueprint $table) {
            $table->string('token_hash', 64)->nullable()->after('avatar');
        });
    }

    public function down(): void
    {
        Schema::table('game_sessions', function (Blueprint $table) {
            $table->dropColumn('teacher_token_hash');
        });

        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn('token_hash');
        });
    }
};
