import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIncomingEvent, buildStudentRestorationState } from '../resources/js/realtimeState.js';

test('evaluateIncomingEvent drops stale poll and delayed older events', () => {
  const res = evaluateIncomingEvent({
    source: 'poll',
    incomingVersion: 4,
    incomingQuestionId: 101,
    incomingQuestionIndex: 0,
    incomingStatus: 'active',
    incomingQuestionState: 'answering',
    current: {
      lastProcessedVersion: 5,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(res.action, 'drop_stale');
});

test('evaluateIncomingEvent rejects AnswerRevealed from previous question (cross-question reveal prevention)', () => {
  // Case A: delayed reveal from Q0 arrives when client already moved to Q1 with same/older version
  const olderRes = evaluateIncomingEvent({
    source: 'AnswerRevealed',
    incomingVersion: 2,
    incomingQuestionId: 101,
    current: {
      lastProcessedVersion: 3,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(olderRes.action, 'drop_stale');

  // Case B: reveal arrives at next version but its question_id belongs to another question
  const mismatchRes = evaluateIncomingEvent({
    source: 'AnswerRevealed',
    incomingVersion: 4,
    incomingQuestionId: 101,
    current: {
      lastProcessedVersion: 3,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(mismatchRes.action, 'recover_authoritative');
});

test('evaluateIncomingEvent drops delayed SessionPaused after SessionResumed', () => {
  // Paused at v4, Resumed at v5 -> delayed SessionPaused v4 must be dropped
  const res = evaluateIncomingEvent({
    source: 'SessionPaused',
    incomingVersion: 4,
    current: {
      lastProcessedVersion: 5,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(res.action, 'drop_stale');
});

test('evaluateIncomingEvent triggers authoritative recovery on WS version gap', () => {
  const res = evaluateIncomingEvent({
    source: 'QuestionChanged',
    incomingVersion: 7,
    incomingQuestionId: 104,
    incomingQuestionIndex: 3,
    current: {
      lastProcessedVersion: 4,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(res.action, 'recover_authoritative');
  assert.equal(res.reason, 'version_gap');
});

test('evaluateIncomingEvent allows authoritative poll snapshot to jump version gaps', () => {
  const res = evaluateIncomingEvent({
    source: 'poll',
    incomingVersion: 7,
    incomingQuestionId: 104,
    incomingQuestionIndex: 3,
    incomingStatus: 'active',
    incomingQuestionState: 'answering',
    current: {
      lastProcessedVersion: 4,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(res.action, 'apply');
});

test('evaluateIncomingEvent handles equal-version duplicate vs conflict vs missed reveal', () => {
  // Duplicate
  const dup = evaluateIncomingEvent({
    source: 'poll',
    incomingVersion: 3,
    incomingQuestionId: 102,
    incomingQuestionIndex: 1,
    incomingStatus: 'active',
    incomingQuestionState: 'answering',
    current: {
      lastProcessedVersion: 3,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(dup.action, 'drop_duplicate');

  // Missed reveal on same version
  const missedReveal = evaluateIncomingEvent({
    source: 'poll',
    incomingVersion: 3,
    incomingQuestionId: 102,
    incomingQuestionIndex: 1,
    incomingStatus: 'active',
    incomingQuestionState: 'revealed',
    current: {
      lastProcessedVersion: 3,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(missedReveal.action, 'apply_reveal_only');

  // Equal version with different question_id -> conflict -> recover
  const conflict = evaluateIncomingEvent({
    source: 'poll',
    incomingVersion: 3,
    incomingQuestionId: 103,
    incomingQuestionIndex: 1,
    incomingStatus: 'active',
    incomingQuestionState: 'answering',
    current: {
      lastProcessedVersion: 3,
      questionId: 102,
      questionIndex: 1,
      status: 'active',
      isRevealed: false,
    },
  });
  assert.equal(conflict.action, 'recover_authoritative');
});

test('buildStudentRestorationState maps all lifecycle states correctly', () => {
  // Waiting -> student-lobby
  const waiting = buildStudentRestorationState({
    player: { id: 1, name: 'Ali', score: 0, streak: 0 },
    session: { status: 'waiting', current_question_index: 0, total_questions: 3, state_version: 0 },
    answered: false,
    answer: null,
  });
  assert.equal(waiting.targetMode, 'student-lobby');
  assert.equal(waiting.selected, null);

  // Active answered before reveal -> pending accepted, no correctness leaked
  const activeAnswered = buildStudentRestorationState({
    player: { id: 1, name: 'Ali', score: 0, streak: 0 },
    session: {
      status: 'active',
      current_question_index: 0,
      total_questions: 3,
      question_state: 'answering',
      question_started_at: 1700000000000,
      state_version: 1,
      current_question: { id: 10, correct_choice_id: null },
    },
    answered: true,
    answer: { question_id: 10, choice_id: 55 },
  });
  assert.equal(activeAnswered.targetMode, 'student-play');
  assert.equal(activeAnswered.selected, 55);
  assert.deepEqual(activeAnswered.pendingResult, { accepted: true });
  assert.equal(activeAnswered.isRevealed, false);

  // Paused -> preserves pausedRemainingMs
  const paused = buildStudentRestorationState({
    player: { id: 1, name: 'Ali', score: 0, streak: 0 },
    session: {
      status: 'paused',
      current_question_index: 0,
      total_questions: 3,
      question_state: 'answering',
      question_paused_remaining_ms: 11500,
      state_version: 2,
      current_question: { id: 10, correct_choice_id: null },
    },
    answered: false,
    answer: null,
  });
  assert.equal(paused.targetMode, 'student-play');
  assert.equal(paused.gameStatus, 'paused');
  assert.equal(paused.pausedRemainingMs, 11500);

  // Revealed -> full result & correct_choice_id
  const revealed = buildStudentRestorationState({
    player: { id: 1, name: 'Ali', score: 920, streak: 1 },
    session: {
      status: 'active',
      current_question_index: 0,
      total_questions: 3,
      question_state: 'revealed',
      state_version: 3,
      current_question: { id: 10, correct_choice_id: 55 },
    },
    answered: true,
    answer: { question_id: 10, choice_id: 55, is_correct: true, points_earned: 920 },
  });
  assert.equal(revealed.isRevealed, true);
  assert.equal(revealed.correctChoiceId, 55);
  assert.equal(revealed.pendingResult.is_correct, true);
  assert.equal(revealed.pendingResult.points_earned, 920);

  // Completed -> leaderboard
  const completed = buildStudentRestorationState({
    player: { id: 1, name: 'Ali', score: 920, streak: 1 },
    session: { status: 'completed', current_question_index: 2, total_questions: 3, state_version: 8 },
    answered: false,
    answer: null,
  });
  assert.equal(completed.targetMode, 'leaderboard');
});

test('evaluateIncomingEvent enforces version ordering and duplicate/gap rules for GameFinished & SessionReset', () => {
  // Stale GameFinished from older round dropped
  assert.equal(
    evaluateIncomingEvent({
      source: 'GameFinished',
      incomingVersion: 4,
      incomingStatus: 'completed',
      current: { lastProcessedVersion: 6, status: 'active', questionId: 12, questionIndex: 1, isRevealed: false },
    }).action,
    'drop_stale'
  );

  // Valid next-version GameFinished applies cleanly
  assert.equal(
    evaluateIncomingEvent({
      source: 'GameFinished',
      incomingVersion: 7,
      incomingStatus: 'completed',
      current: { lastProcessedVersion: 6, status: 'active', questionId: 12, questionIndex: 1, isRevealed: true },
    }).action,
    'apply'
  );

  // Duplicate GameFinished on same completed version is idempotent
  assert.equal(
    evaluateIncomingEvent({
      source: 'GameFinished',
      incomingVersion: 7,
      incomingStatus: 'completed',
      current: { lastProcessedVersion: 7, status: 'completed', questionId: 12, questionIndex: 1, isRevealed: true },
    }).action,
    'drop_duplicate'
  );

  // Conflicting equal-version GameFinished recovers authoritatively
  assert.equal(
    evaluateIncomingEvent({
      source: 'GameFinished',
      incomingVersion: 7,
      incomingStatus: 'completed',
      current: { lastProcessedVersion: 7, status: 'active', questionId: 12, questionIndex: 1, isRevealed: false },
    }).action,
    'recover_authoritative'
  );

  // Version gap on GameFinished or SessionReset triggers authoritative recovery
  assert.equal(
    evaluateIncomingEvent({
      source: 'GameFinished',
      incomingVersion: 10,
      incomingStatus: 'completed',
      current: { lastProcessedVersion: 6, status: 'active', questionId: 12, questionIndex: 1, isRevealed: false },
    }).action,
    'recover_authoritative'
  );

  // Stale SessionReset from earlier version dropped
  assert.equal(
    evaluateIncomingEvent({
      source: 'SessionReset',
      incomingVersion: 5,
      incomingStatus: 'waiting',
      current: { lastProcessedVersion: 8, status: 'active', questionId: 14, questionIndex: 0, isRevealed: false },
    }).action,
    'drop_stale'
  );

  // Next-version SessionReset applies cleanly
  assert.equal(
    evaluateIncomingEvent({
      source: 'SessionReset',
      incomingVersion: 9,
      incomingStatus: 'waiting',
      current: { lastProcessedVersion: 8, status: 'completed', questionId: 14, questionIndex: 2, isRevealed: true },
    }).action,
    'apply'
  );

  // Duplicate SessionReset when already waiting is idempotent
  assert.equal(
    evaluateIncomingEvent({
      source: 'SessionReset',
      incomingVersion: 9,
      incomingStatus: 'waiting',
      current: { lastProcessedVersion: 9, status: 'waiting', questionId: null, questionIndex: 0, isRevealed: false },
    }).action,
    'drop_duplicate'
  );
});
