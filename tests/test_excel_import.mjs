/**
 * tests/test_excel_import.mjs
 * Node --test assertions for excelQuiz.js logic (runs in Node, no browser APIs needed)
 *
 * Run:
 *   node --test tests/test_excel_import.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// ── inline the pure-logic parts of excelQuiz.js so we don't need a bundler ──

const EXCEL_TEMPLATE_HEADERS = [
  'السؤال (Question) *',
  'الترجمة العربية (Arabic - Optional)',
  'الوقت بالثواني (Time 5-120)',
  'الخيار 1 (Choice 1) *',
  'الخيار 2 (Choice 2) *',
  'الخيار 3 (Choice 3)',
  'الخيار 4 (Choice 4)',
  'الإجابة الصحيحة (Correct 1-4) *',
];

const SAMPLE_ROWS = [
  ['How many planets are in our solar system?', 'كم عدد الكواكب في مجموعتنا الشمسية؟', 20, '7 planets', '8 planets', '9 planets', '10 planets', 2],
  ['What is 8 multiplied by 7?',               'ما حاصل ضرب ٨ × ٧؟',                 15, '54',        '56',        '48',        '64',         2],
  ['Which organ pumps blood through the human body?', 'ما العضو الذي يضخ الدم في جسم الإنسان؟', 20, 'The Lungs', 'The Brain', 'The Heart', 'The Stomach', 3],
];

function makeXlsxBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// ── Helper: load & call parseQuestionsFromSpreadsheet via dynamic import of built file ──
// Since excelQuiz.js uses `import * as XLSX from 'xlsx'` (ESM) we can import it directly.
const { parseQuestionsFromSpreadsheet, buildQuestionsTemplateWorkbook } =
  await import('../resources/js/excelQuiz.js');

// ── Tests ──

describe('parseQuestionsFromSpreadsheet', () => {
  it('parses 3 sample template rows correctly', () => {
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, ...SAMPLE_ROWS]);
    const { questions, errors } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
    assert.equal(questions.length, 3);
    assert.equal(questions[0].question_text, 'How many planets are in our solar system?');
  });

  it('resolves correct answer by number (2 → index 1)', () => {
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, SAMPLE_ROWS[0]]);
    const { questions } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions[0].choices[1].is_correct, true);
    assert.equal(questions[0].choices[0].is_correct, false);
  });

  it('resolves correct answer by letter B → index 1', () => {
    const row = ['What colour is the sky?', '', 20, 'Red', 'Blue', 'Green', 'Yellow', 'B'];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions[0].choices[1].is_correct, true);
  });

  it('resolves correct answer by exact text match', () => {
    const row = ['What colour is the sky?', '', 20, 'Red', 'Blue', 'Green', 'Yellow', 'Blue'];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions[0].choices[1].is_correct, true);
  });

  it('skips row with missing question text', () => {
    const row = ['', '', 20, 'Red', 'Blue', '', '', 1];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions, errors } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions.length, 0);
    assert.ok(errors.length > 0, 'expected an error for missing question text');
  });

  it('skips row with fewer than 2 choices', () => {
    const row = ['What is 1+1?', '', 20, '2', '', '', '', 1];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions, errors } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions.length, 0);
    assert.ok(errors.some(e => e.includes('خيارين')), `expected choice-count error, got: ${errors}`);
  });

  it('normalises Arabic digits in time column (٢٠ → 20)', () => {
    const row = ['What is 1+1?', '', '٢٠', '2', '3', '', '', 1];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(questions[0].time_limit, 20);
  });

  it('caps import at maxQuestions', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [
      `Question ${i + 1}`, '', 20, 'A', 'B', '', '', 1,
    ]);
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, ...rows]);
    const { questions, warnings } = parseQuestionsFromSpreadsheet(buf, 5);
    assert.equal(questions.length, 5);
    assert.ok(warnings.some(w => w.includes('5')), `expected cap warning, got: ${warnings}`);
  });

  it('allows Arabic-only question (promotes qAr to qMain)', () => {
    const row = ['', 'ما هو لون السماء؟', 20, 'أحمر', 'أزرق', '', '', 2];
    const buf = makeXlsxBuffer([EXCEL_TEMPLATE_HEADERS, row]);
    const { questions, errors } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(errors.length, 0, `unexpected errors: ${errors}`);
    assert.equal(questions[0].question_text, 'ما هو لون السماء؟');
    assert.equal(questions[0].question_text_ar, '');
  });

  it('skips fully empty rows without error', () => {
    const rows = [EXCEL_TEMPLATE_HEADERS, SAMPLE_ROWS[0], ['', '', '', '', '', '', '', ''], SAMPLE_ROWS[1]];
    const buf = makeXlsxBuffer(rows);
    const { questions, errors } = parseQuestionsFromSpreadsheet(buf);
    assert.equal(errors.length, 0);
    assert.equal(questions.length, 2);
  });
});

describe('buildQuestionsTemplateWorkbook', () => {
  it('returns a workbook with 2 sheets', () => {
    const wb = buildQuestionsTemplateWorkbook();
    assert.equal(wb.SheetNames.length, 2);
  });

  it('first sheet has correct header row', () => {
    const wb = buildQuestionsTemplateWorkbook();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    assert.deepEqual(rows[0], EXCEL_TEMPLATE_HEADERS);
  });

  it('first sheet contains 3 sample rows after header', () => {
    const wb = buildQuestionsTemplateWorkbook();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    // Header + 3 sample rows = 4 rows total
    assert.equal(rows.length, 4);
  });
});
