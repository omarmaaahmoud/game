<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class QuestionChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public array $question;
    public int $currentQuestionIndex;
    public int $totalQuestions;

    public function __construct(string $pin, array $question, int $currentQuestionIndex, int $totalQuestions)
    {
        $this->pin = $pin;
        $this->question = $question;
        $this->currentQuestionIndex = $currentQuestionIndex;
        $this->totalQuestions = $totalQuestions;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'QuestionChanged';
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

