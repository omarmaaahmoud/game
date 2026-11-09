<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PlayerJoined implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public array $player;
    public int $playerCount;

    public function __construct(string $pin, array $player, int $playerCount)
    {
        $this->pin = $pin;
        $this->player = $player;
        $this->playerCount = $playerCount;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'PlayerJoined';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'player' => $this->player,
            'player_count' => $this->playerCount,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

