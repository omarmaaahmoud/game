<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Illuminate\Support\Facades\DB;

// Delete answers for players in session 1
DB::statement("DELETE FROM answers WHERE player_id IN (SELECT id FROM players WHERE game_session_id = 1)");
echo "Answers deleted.\n";

// Delete players
DB::statement("DELETE FROM players WHERE game_session_id = 1");
echo "Players deleted.\n";

// Reset session directly via raw SQL
DB::statement("UPDATE game_sessions SET status = 'waiting', current_question_index = 0, question_state = 'answering' WHERE pin = '123456'");
echo "Session 123456 reset to 'waiting' with question_state='answering'.\n";

// Verify
$row = DB::table('game_sessions')->where('pin', '123456')->first();
echo "Verify => status: {$row->status}, question_state: {$row->question_state}, index: {$row->current_question_index}\n";
