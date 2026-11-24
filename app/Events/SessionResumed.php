<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SessionResumed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public ?int $questionStartedAt;
    public int $stateVersion;

    public function __construct(string $pin, ?int $questionStartedAt = null, int $stateVersion = 0)
    {
        $this->pin = $pin;
        $this->questionStartedAt = $questionStartedAt;
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
        return 'SessionResumed';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'status' => 'active',
            'question_started_at' => $this->questionStartedAt,
            'state_version' => $this->stateVersion,
            'server_now_ms' => (int) round(microtime(true) * 1000),
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}
