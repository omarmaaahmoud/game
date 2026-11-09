<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\GameSession;
use App\Models\Question;
use App\Models\Choice;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Sample ready session
        $session = GameSession::firstOrCreate(
            ['pin' => '123456'],
            [
                'teacher_name' => 'الأستاذ أحمد',
                'title' => 'مغامرة الفضاء والعلوم 🚀',
                'status' => 'waiting',
                'current_question_index' => 0,
            ]
        );

        if ($session->questions()->count() === 0) {
            $q1 = $session->questions()->create([
                'question_text' => 'How many planets are in our solar system?',
                'question_text_ar' => 'كم عدد الكواكب في مجموعتنا الشمسية؟',
                'order' => 0,
                'time_limit' => 25,
            ]);

            $q1->choices()->createMany([
                ['choice_text' => '7 planets', 'choice_text_ar' => '٧ كواكب', 'is_correct' => false, 'order' => 0],
                ['choice_text' => '8 planets', 'choice_text_ar' => '٨ كواكب', 'is_correct' => true, 'order' => 1],
                ['choice_text' => '9 planets', 'choice_text_ar' => '٩ كواكب', 'is_correct' => false, 'order' => 2],
                ['choice_text' => '10 planets', 'choice_text_ar' => '١٠ كواكب', 'is_correct' => false, 'order' => 3],
            ]);

            $q2 = $session->questions()->create([
                'question_text' => 'What is the closest planet to the Sun?',
                'question_text_ar' => 'ما هو أقرب كوكب إلى الشمس؟',
                'order' => 1,
                'time_limit' => 20,
            ]);

            $q2->choices()->createMany([
                ['choice_text' => 'Venus', 'choice_text_ar' => 'الزهرة', 'is_correct' => false, 'order' => 0],
                ['choice_text' => 'Mercury', 'choice_text_ar' => 'عطارد', 'is_correct' => true, 'order' => 1],
                ['choice_text' => 'Mars', 'choice_text_ar' => 'المريخ', 'is_correct' => false, 'order' => 2],
                ['choice_text' => 'Earth', 'choice_text_ar' => 'الأرض', 'is_correct' => false, 'order' => 3],
            ]);

            $q3 = $session->questions()->create([
                'question_text' => 'Which planet is known as the Red Planet?',
                'question_text_ar' => 'أي كوكب يُعرف بالكوكب الأحمر؟',
                'order' => 2,
                'time_limit' => 20,
            ]);

            $q3->choices()->createMany([
                ['choice_text' => 'Jupiter', 'choice_text_ar' => 'المشتري', 'is_correct' => false, 'order' => 0],
                ['choice_text' => 'Saturn', 'choice_text_ar' => 'زحل', 'is_correct' => false, 'order' => 1],
                ['choice_text' => 'Mars', 'choice_text_ar' => 'المريخ', 'is_correct' => true, 'order' => 2],
                ['choice_text' => 'Neptune', 'choice_text_ar' => 'نبتون', 'is_correct' => false, 'order' => 3],
            ]);
        }
    }
}

