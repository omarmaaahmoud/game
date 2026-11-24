/**
 * Authoritative state-version & question-identity evaluation engine for StudentPlay.
 *
 * State-Version Contract Matrix (Section 1.5 & Phase 2.3):
 * - version <= 0 (legacy/unversioned): never overrides an already-versioned state;
 *   only accepted if current.lastProcessedVersion === 0.
 * - incomingVersion < current.lastProcessedVersion:
 *   STALE -> always drop ('drop_stale'). Never modifies gameStatus, timer, selected, or reveal.
 * - incomingVersion === current.lastProcessedVersion:
 *   - If questionId/questionIndex conflicts OR status/question_state conflicts incompatibly
 *     with current UI state -> trigger authoritative recovery ('recover_authoritative').
 *   - If eventType === 'poll' / 'state' and same question moves from answering -> revealed
 *     during recovery, or matches current state -> idempotent ('drop_duplicate' or 'apply_reveal_only').
 * - incomingVersion > current.lastProcessedVersion + 1 (when current.lastProcessedVersion > 0):
 *   - For authoritative snapshots (source === 'poll' | 'recovery'):
 *     apply directly ('apply') since /state is already the full authoritative snapshot.
 *   - For incremental WebSocket events (QuestionChanged, AnswerRevealed, SessionPaused, SessionResumed, GameFinished, SessionReset):
 *     VERSION GAP -> do not blindly apply partial event; fetch /state ('recover_authoritative').
 * - incomingVersion === current.lastProcessedVersion + 1 (or current.lastProcessedVersion === 0):
 *   - For AnswerRevealed: verify incomingQuestionId matches current.questionId (if both known);
 *     if mismatched, reject/recover rather than revealing the wrong question.
 *   - Otherwise -> apply ('apply').
 */

export function evaluateIncomingEvent({
  source, // 'poll' | 'recovery' | 'QuestionChanged' | 'AnswerRevealed' | 'SessionPaused' | 'SessionResumed' | 'GameFinished' | 'SessionReset'
  incomingVersion = 0,
  incomingQuestionId = null,
  incomingQuestionIndex = null,
  incomingStatus = null,
  incomingQuestionState = null,
  current = {
    lastProcessedVersion: 0,
    questionId: null,
    questionIndex: null,
    status: 'active',
    isRevealed: false,
  },
}) {
  const numVersion = Number(incomingVersion || 0);
  const currentVersion = Number(current.lastProcessedVersion || 0);
  const isAuthoritativeSnapshot = source === 'poll' || source === 'recovery';

  // Legacy/unversioned events cannot override a versioned session
  if (numVersion <= 0) {
    if (currentVersion > 0) {
      return { action: 'drop_stale', reason: 'unversioned_after_versioned' };
    }
    if (
      source === 'AnswerRevealed' &&
      incomingQuestionId != null &&
      current.questionId != null &&
      Number(incomingQuestionId) !== Number(current.questionId)
    ) {
      return { action: 'drop_mismatched_question', reason: 'question_id_mismatch' };
    }
    return { action: 'apply', reason: 'unversioned_initial' };
  }

  // 1. Strictly older version -> always drop
  if (numVersion < currentVersion) {
    return { action: 'drop_stale', reason: 'older_version' };
  }

  // 2. Equal version -> check for conflict vs idempotent duplicate
  if (numVersion === currentVersion) {
    const qMismatch =
      incomingQuestionId != null &&
      current.questionId != null &&
      Number(incomingQuestionId) !== Number(current.questionId);
    const idxMismatch =
      incomingQuestionIndex != null &&
      current.questionIndex != null &&
      Number(incomingQuestionIndex) !== Number(current.questionIndex);

    if (qMismatch || idxMismatch) {
      return { action: 'recover_authoritative', reason: 'equal_version_question_conflict' };
    }

    if (source === 'SessionPaused' && current.status !== 'paused') {
      return { action: 'recover_authoritative', reason: 'equal_version_status_conflict' };
    }
    if (source === 'SessionResumed' && current.status !== 'active') {
      return { action: 'recover_authoritative', reason: 'equal_version_status_conflict' };
    }
    if (source === 'GameFinished' && current.status !== 'completed') {
      return { action: 'recover_authoritative', reason: 'equal_version_status_conflict' };
    }
    if (source === 'SessionReset' && current.status !== 'waiting') {
      return { action: 'recover_authoritative', reason: 'equal_version_status_conflict' };
    }
    if (
      isAuthoritativeSnapshot &&
      incomingStatus &&
      current.status &&
      incomingStatus !== current.status
    ) {
      return { action: 'recover_authoritative', reason: 'equal_version_poll_status_conflict' };
    }
    if (
      isAuthoritativeSnapshot &&
      incomingQuestionState === 'revealed' &&
      !current.isRevealed &&
      incomingQuestionId != null &&
      current.questionId != null &&
      Number(incomingQuestionId) === Number(current.questionId)
    ) {
      return { action: 'apply_reveal_only', reason: 'same_version_missed_reveal' };
    }

    return { action: 'drop_duplicate', reason: 'idempotent_equal_version' };
  }

  // 3. Version gap on incremental WebSocket events -> fetch authoritative /state
  if (!isAuthoritativeSnapshot && currentVersion > 0 && numVersion > currentVersion + 1) {
    return { action: 'recover_authoritative', reason: 'version_gap' };
  }

  // 4. Question identity guard for AnswerRevealed
  if (
    source === 'AnswerRevealed' &&
    incomingQuestionId != null &&
    current.questionId != null &&
    Number(incomingQuestionId) !== Number(current.questionId)
  ) {
    return { action: 'recover_authoritative', reason: 'reveal_question_mismatch' };
  }

  return { action: 'apply', reason: 'newer_version' };
}

/**
 * Computes normalized student restoration state from GET /sessions/{pin}/me payload.
 */
export function buildStudentRestorationState(meData) {
  if (!meData || !meData.session || !meData.player) {
    return null;
  }

  const sess = meData.session;
  const status = sess.status;

  let targetMode = 'home';
  if (status === 'waiting') {
    targetMode = 'student-lobby';
  } else if (status === 'active' || status === 'paused') {
    targetMode = 'student-play';
  } else if (status === 'completed') {
    targetMode = 'leaderboard';
  }

  const q = sess.current_question || null;
  const answer = meData.answer || null;
  const answerMatchesCurrent =
    Boolean(meData.answered) &&
    Boolean(answer) &&
    Boolean(q) &&
    (answer.question_id == null || Number(answer.question_id) === Number(q.id));

  const restoredSelected = answerMatchesCurrent ? answer.choice_id : null;
  const isRevealed = sess.question_state === 'revealed';

  let restoredPendingResult = null;
  if (answerMatchesCurrent) {
    if (isRevealed) {
      restoredPendingResult = {
        answered: true,
        is_correct: Boolean(answer.is_correct),
        points_earned: Number(answer.points_earned ?? 0),
        total_score: Number(meData.player.score ?? 0),
        streak: Number(meData.player.streak ?? 0),
        choice_id: answer.choice_id,
        correct_choice_id: q?.correct_choice_id ?? null,
      };
    } else {
      restoredPendingResult = { accepted: true };
    }
  }

  return {
    targetMode,
    session: sess,
    player: meData.player,
    question: q,
    qIndex: Number(sess.current_question_index ?? 0),
    totalQuestions: Number(sess.total_questions ?? 0),
    gameStatus: status,
    isRevealed,
    correctChoiceId: isRevealed ? (q?.correct_choice_id ?? null) : null,
    selected: restoredSelected,
    pendingResult: restoredPendingResult,
    questionStartedAt: sess.question_started_at ?? null,
    pausedRemainingMs: sess.question_paused_remaining_ms ?? null,
    stateVersion: Number(sess.state_version ?? 0),
  };
}
