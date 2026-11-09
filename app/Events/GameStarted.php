<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class GameStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public ?array $question;
    public int $totalQuestions;
    public int $currentQuestionIndex;

    public function __construct(string $pin, ?array $question = null, int $totalQuestions = 0, int $currentQuestionIndex = 0)
    {
        $this->pin = $pin;
        $this->question = $question;
        $this->totalQuestions = $totalQuestions;
        $this->currentQuestionIndex = $currentQuestionIndex;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'GameStarted';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'status' => 'active',
            'current_question_index' => $this->currentQuestionIndex,
            'question_state' => 'answering',
            'question' => $this->question,
            'total_questions' => $this->totalQuestions,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

