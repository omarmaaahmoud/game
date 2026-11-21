<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('game_sessions', function (Blueprint $table) {
            $table->unsignedBigInteger('question_started_at')->nullable()->after('current_question_index');
            $table->unsignedInteger('state_version')->default(0)->after('question_started_at');
            $table->unsignedInteger('question_paused_remaining_ms')->nullable()->after('state_version');
        });
    }

    public function down(): void
    {
        Schema::table('game_sessions', function (Blueprint $table) {
            $table->dropColumn(['question_started_at', 'state_version', 'question_paused_remaining_ms']);
        });
    }
};
