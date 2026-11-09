<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ResultsRevealed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $pin;
    public string $title;
    public int $totalQuestions;
    public int $totalPlayers;
    public array $results;

    public function __construct(string $pin, string $title, int $totalQuestions, int $totalPlayers, array $results)
    {
        $this->pin = $pin;
        $this->title = $title;
        $this->totalQuestions = $totalQuestions;
        $this->totalPlayers = $totalPlayers;
        $this->results = $results;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel("session.{$this->pin}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'ResultsRevealed';
    }

    public function broadcastWith(): array
    {
        return [
            'pin' => $this->pin,
            'title' => $this->title,
            'total_questions' => $this->totalQuestions,
            'total_players' => $this->totalPlayers,
            'results' => $this->results,
            '_ts' => (int) round(microtime(true) * 1000),
        ];
    }
}

