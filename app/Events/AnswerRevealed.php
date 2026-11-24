<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AnswerRevealed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public int $correctChoiceId;
    public ?int $questionId;
    public int $stateVersion;

    public function __construct(string $pin, int $correctChoiceId, ?int $questionId = null, int $stateVersion = 0)
    {
        $this->pin = $pin;
        $this->correctChoiceId = $correctChoiceId;
        $this->questionId = $questionId;
        $this->stateVersion = $stateVersion;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'AnswerRevealed';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'question_state' => 'revealed',
            'correct_choice_id' => $this->correctChoiceId,
            'question_id' => $this->questionId,
            'state_version' => $this->stateVersion,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

