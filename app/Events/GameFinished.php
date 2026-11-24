<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class GameFinished implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public int $stateVersion;
    public ?int $questionId;

    public function __construct(string $pin, int $stateVersion = 0, ?int $questionId = null)
    {
        $this->pin = $pin;
        $this->stateVersion = $stateVersion;
        $this->questionId = $questionId;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'GameFinished';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'status' => 'completed',
            'state_version' => $this->stateVersion,
            'question_id' => $this->questionId,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}
