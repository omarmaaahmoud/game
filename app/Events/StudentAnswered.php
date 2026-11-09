<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class StudentAnswered implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public int $playerId;
    public string $playerName;
    public int $answeredCount;
    public int $totalPlayers;

    public function __construct(string $pin, int $playerId, string $playerName, int $answeredCount, int $totalPlayers)
    {
        $this->pin = $pin;
        $this->playerId = $playerId;
        $this->playerName = $playerName;
        $this->answeredCount = $answeredCount;
        $this->totalPlayers = $totalPlayers;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'StudentAnswered';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'player_id' => $this->playerId,
            'player_name' => $this->playerName,
            'answered_count' => $this->answeredCount,
            'total_players' => $this->totalPlayers,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

