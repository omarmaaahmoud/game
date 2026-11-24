<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SessionReset implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public int $stateVersion;

    public function __construct(string $pin, int $stateVersion)
    {
        $this->pin = $pin;
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
        return 'SessionReset';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'status' => 'waiting',
            'state_version' => $this->stateVersion,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}
