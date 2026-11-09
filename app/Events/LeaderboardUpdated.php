<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class LeaderboardUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public array $leaderboard;

    public function __construct(string $pin, array $leaderboard)
    {
        $this->pin = $pin;
        $this->leaderboard = $leaderboard;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'LeaderboardUpdated';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'leaderboard' => $this->leaderboard,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

