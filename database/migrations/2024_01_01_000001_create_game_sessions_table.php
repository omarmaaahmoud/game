<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('pin', 6)->unique();
            $table->string('teacher_name')->default('Teacher');
            $table->string('title')->default('Quiz Game');
            $table->enum('status', ['waiting', 'active', 'paused', 'completed'])->default('waiting');
            $table->enum('question_state', ['answering', 'revealed'])->default('answering');
            $table->unsignedInteger('current_question_index')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('game_sessions');
    }
};

