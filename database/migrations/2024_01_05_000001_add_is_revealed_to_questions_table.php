<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds `is_revealed` boolean flag to `questions` table.
 *
 * Historical backfill policy (fail-closed / authoritative-only):
 * - Authoritatively proved revealed: the question at `questions.order = game_sessions.current_question_index`
 *   in any existing session whose `question_state = 'revealed'` and `status IN ('active', 'paused', 'completed')`.
 *   (`end()` and terminal `next()` always transition `question_state` to `'revealed'`.)
 * - Unavoidable ambiguity: for prior questions (`order < current_question_index`), the pre-upgrade schema
 *   did not record whether `reveal()` was invoked before `next()` advanced `current_question_index`.
 *   Per fail-closed security rules, those prior questions remain `is_revealed = false` rather than
 *   guessing and potentially leaking answers for skipped/unrevealed questions.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('questions')) {
            return;
        }

        if (!Schema::hasColumn('questions', 'is_revealed')) {
            Schema::table('questions', function (Blueprint $table) {
                $table->boolean('is_revealed')->default(false)->after('time_limit');
            });
        }

        if (Schema::hasTable('game_sessions')) {
            $revealedSessions = DB::table('game_sessions')
                ->where('question_state', 'revealed')
                ->whereIn('status', ['active', 'paused', 'completed'])
                ->get(['id', 'current_question_index']);

            foreach ($revealedSessions as $sess) {
                DB::table('questions')
                    ->where('game_session_id', $sess->id)
                    ->where('order', (int) $sess->current_question_index)
                    ->update(['is_revealed' => true]);
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('questions') && Schema::hasColumn('questions', 'is_revealed')) {
            Schema::table('questions', function (Blueprint $table) {
                $table->dropColumn('is_revealed');
            });
        }
    }
};
