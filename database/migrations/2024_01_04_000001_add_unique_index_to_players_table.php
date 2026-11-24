<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('players')) {
            // Deduplicate existing duplicate player names within each session
            $duplicates = DB::table('players')
                ->select('game_session_id', 'name', DB::raw('COUNT(*) as cnt'), DB::raw('MIN(id) as keep_id'))
                ->groupBy('game_session_id', 'name')
                ->having('cnt', '>', 1)
                ->get();

            foreach ($duplicates as $dup) {
                // Rename duplicates instead of deleting — preserves answers and player data (Section 6)
                $dupeRows = DB::table('players')
                    ->where('game_session_id', $dup->game_session_id)
                    ->where('name', $dup->name)
                    ->where('id', '!=', $dup->keep_id)
                    ->orderBy('id')
                    ->get();

                $suffix = 1;
                foreach ($dupeRows as $dupeRow) {
                    $newName = $dupeRow->name . '_dup_' . $suffix;
                    // Ensure the new name doesn't collide either
                    while (DB::table('players')
                        ->where('game_session_id', $dupeRow->game_session_id)
                        ->where('name', $newName)
                        ->exists()) {
                        $suffix++;
                        $newName = $dupeRow->name . '_dup_' . $suffix;
                    }
                    DB::table('players')
                        ->where('id', $dupeRow->id)
                        ->update(['name' => $newName]);
                    $suffix++;
                }
            }

            Schema::table('players', function (Blueprint $table) {
                $table->unique(['game_session_id', 'name']);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('players')) {
            Schema::table('players', function (Blueprint $table) {
                $table->dropUnique(['game_session_id', 'name']);
            });
        }
    }
};
