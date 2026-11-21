<?php

return [
    'sync_lead_ms' => (int) env('QUIZ_SYNC_LEAD_MS', 2000),
    'answer_grace_ms' => (int) env('QUIZ_ANSWER_GRACE_MS', 1000),
    'allow_legacy_open_sessions' => (bool) env('QUIZ_ALLOW_LEGACY_OPEN_SESSIONS', false),
    'reveal_on_answer' => (bool) env('QUIZ_REVEAL_ON_ANSWER', false),
    'max_players_per_session' => (int) env('QUIZ_MAX_PLAYERS_PER_SESSION', 100),
    'max_questions' => (int) env('QUIZ_MAX_QUESTIONS', 50),
];
