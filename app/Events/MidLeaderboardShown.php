<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MidLeaderboardShown implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public array $leaderboard;
    public ?int $questionId;
    public int $stateVersion;

    public function __construct(string $pin, array $leaderboard, ?int $questionId = null, int $stateVersion = 0)
    {
        $this->pin = $pin;
        $this->leaderboard = $leaderboard;
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
        return 'MidLeaderboardShown';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'question_state' => 'revealed',
            'show_mid_leaderboard' => true,
            'question_id' => $this->questionId,
            'state_version' => $this->stateVersion,
            'leaderboard' => $this->leaderboard,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}
