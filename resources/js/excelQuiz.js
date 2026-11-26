import * as XLSX from 'xlsx';

export const EXCEL_TEMPLATE_HEADERS = [
  'السؤال (Question) *',
  'الترجمة العربية (Arabic - Optional)',
  'الوقت بالثواني (Time 5-120)',
  'الخيار 1 (Choice 1) *',
  'الخيار 2 (Choice 2) *',
  'الخيار 3 (Choice 3)',
  'الخيار 4 (Choice 4)',
  'الإجابة الصحيحة (Correct 1-4) *',
];

export const EXCEL_SAMPLE_ROWS = [
  [
    'How many planets are in our solar system?',
    'كم عدد الكواكب في مجموعتنا الشمسية؟',
    20,
    '7 planets',
    '8 planets',
    '9 planets',
    '10 planets',
    2,
  ],
  [
    'What is 8 multiplied by 7?',
    'ما حاصل ضرب ٨ × ٧؟',
    15,
    '54',
    '56',
    '48',
    '64',
    2,
  ],
  [
    'Which organ pumps blood through the human body?',
    'ما العضو الذي يضخ الدم في جسم الإنسان؟',
    20,
    'The Lungs',
    'The Brain',
    'The Heart',
    'The Stomach',
    3,
  ],
];

const HEADER_ALIASES = {
  question_text: [
    'question', 'questionen', 'questiontext', 'questionmain', 'questionmainen',
    'السؤال', 'السؤالquestion', 'السؤالبالانجليزيه', 'نصالسؤال', 'سؤال',
  ],
  question_text_ar: [
    'questionar', 'questiontextar', 'arabic', 'translation', 'arabicoptional',
    'الترجمهالعربيه', 'الترجمهالعربيهarabicoptional', 'الترجمه', 'السؤالبالعربيه', 'النصالعربي',
  ],
  time_limit: [
    'time', 'timelimit', 'timeseconds', 'seconds', 'time5120', 'duration',
    'الوقت', 'الوقتبثواني', 'الوقتبالثواني', 'الوقتبالثوانيtime5120', 'المده',
  ],
  choice1: [
    'choice1', 'option1', 'optiona', 'answer1', 'a',
    'الخيار1', 'الخيارالاول', 'اختيار1', 'الخيار1choice1', 'ا',
  ],
  choice2: [
    'choice2', 'option2', 'optionb', 'answer2', 'b',
    'الخيار2', 'الخيارالثاني', 'اختيار2', 'الخيار2choice2', 'ب',
  ],
  choice3: [
    'choice3', 'option3', 'optionc', 'answer3', 'c',
    'الخيار3', 'الخيارالثالث', 'اختيار3', 'الخيار3choice3', 'ج',
  ],
  choice4: [
    'choice4', 'option4', 'optiond', 'answer4', 'd',
    'الخيار4', 'الخيارالرابع', 'اختيار4', 'الخيار4choice4', 'د',
  ],
  correct: [
    'correct', 'correctanswer', 'correct14', 'answer', 'rightanswer', 'correctchoice',
    'الاجابهالصحيحه', 'رقمالاجابهالصحيحه', 'الاجابه', 'الصحيح', 'الاجابهالصحيحهcorrect14',
  ],
};

function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function normalizeHeaderKey(header) {
  return normalizeDigits(header)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-*()[\]{}:/\\.,]+/g, '');
}

function mapColumns(headerRow) {
  const mapping = {};
  headerRow.forEach((rawCell, idx) => {
    const key = normalizeHeaderKey(rawCell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (mapping[field] !== undefined) continue;
      if (aliases.includes(key)) {
        mapping[field] = idx;
      }
    }
  });
  return mapping;
}

function resolveCorrectIndex(rawCorrect, choiceTexts) {
  const cleaned = normalizeDigits(rawCorrect).trim();
  if (!cleaned) return -1;

  // Numeric 1..4
  if (/^[1-4]$/.test(cleaned)) {
    const idx = Number(cleaned) - 1;
    return choiceTexts[idx] ? idx : -1;
  }

  // Letter A..D or Arabic letters
  const letterMap = { a: 0, b: 1, c: 2, d: 3, 'أ': 0, 'ا': 0, 'ب': 1, 'ج': 2, 'د': 3 };
  const lower = cleaned.toLowerCase();
  if (lower in letterMap) {
    const idx = letterMap[lower];
    return choiceTexts[idx] ? idx : -1;
  }

  // Exact text match against one of the choices
  const textIdx = choiceTexts.findIndex(
    (t) => t && t.toLowerCase() === lower
  );
  return textIdx;
}

/**
 * Parses an Excel (.xlsx/.xls) or CSV buffer into validated quiz questions matching SessionController::store.
 */
export function parseQuestionsFromSpreadsheet(buffer, maxQuestions = 50) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { questions: [], errors: ['الملف لا يحتوي على أي أوراق عمل (Sheets)'], warnings: [] };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows || rows.length < 2) {
    return {
      questions: [],
      errors: ['الملف فارغ أو يحتوي على صف العناوين فقط. يرجى إضافة الأسئلة بدءاً من الصف الثاني.'],
      warnings: [],
    };
  }

  const headerRow = rows[0];
  let colMap = mapColumns(headerRow);

  // Fallback to positional template order if at least question + 2 choices were not recognized by name
  const hasNamedColumns =
    colMap.question_text !== undefined &&
    colMap.choice1 !== undefined &&
    colMap.choice2 !== undefined;

  if (!hasNamedColumns && headerRow.length >= 4) {
    colMap = {
      question_text: 0,
      question_text_ar: headerRow.length >= 8 ? 1 : undefined,
      time_limit: headerRow.length >= 8 ? 2 : undefined,
      choice1: headerRow.length >= 8 ? 3 : 1,
      choice2: headerRow.length >= 8 ? 4 : 2,
      choice3: headerRow.length >= 8 ? 5 : (headerRow.length >= 5 ? 3 : undefined),
      choice4: headerRow.length >= 8 ? 6 : (headerRow.length >= 6 ? 4 : undefined),
      correct: headerRow.length >= 8 ? 7 : headerRow.length - 1,
    };
  }

  const questions = [];
  const errors = [];
  const warnings = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const excelRowNum = r + 1;
    const isRowEmpty = row.every((cell) => String(cell ?? '').trim() === '');
    if (isRowEmpty) continue;

    let qMain = String(row[colMap.question_text] ?? '').trim();
    let qAr = colMap.question_text_ar !== undefined ? String(row[colMap.question_text_ar] ?? '').trim() : '';

    // Allow Arabic-only questions by promoting Arabic text to main question_text
    if (!qMain && qAr) {
      qMain = qAr;
      qAr = '';
    }

    if (!qMain) {
      errors.push(`الصف ${excelRowNum}: نص السؤال مفقود.`);
      continue;
    }

    if (qMain.length > 500) {
      warnings.push(`الصف ${excelRowNum}: تم تقصير نص السؤال إلى 500 حرف.`);
      qMain = qMain.slice(0, 500);
    }
    if (qAr.length > 500) {
      qAr = qAr.slice(0, 500);
    }

    const rawChoices = [
      colMap.choice1 !== undefined ? String(row[colMap.choice1] ?? '').trim() : '',
      colMap.choice2 !== undefined ? String(row[colMap.choice2] ?? '').trim() : '',
      colMap.choice3 !== undefined ? String(row[colMap.choice3] ?? '').trim() : '',
      colMap.choice4 !== undefined ? String(row[colMap.choice4] ?? '').trim() : '',
    ].map((c) => (c.length > 200 ? c.slice(0, 200) : c));

    const filledCount = rawChoices.filter(Boolean).length;
    if (filledCount < 2) {
      errors.push(`الصف ${excelRowNum}: يجب إدخال خيارين على الأقل للسؤال.`);
      continue;
    }

    const rawCorrect = colMap.correct !== undefined ? row[colMap.correct] : '';
    const correctIdx = resolveCorrectIndex(rawCorrect, rawChoices);
    if (correctIdx < 0) {
      errors.push(`الصف ${excelRowNum}: عمود "الإجابة الصحيحة" يجب أن يحدد رقماً (1-4) أو حرفاً (A-D) يطابق خياراً غير فارغ.`);
      continue;
    }

    let timeLimit = 20;
    if (colMap.time_limit !== undefined) {
      const parsedTime = Number(normalizeDigits(row[colMap.time_limit]).trim());
      if (Number.isFinite(parsedTime) && parsedTime > 0) {
        timeLimit = Math.min(120, Math.max(5, Math.round(parsedTime)));
      }
    }

    if (questions.length >= maxQuestions) {
      warnings.push(`تم استيراد الحد الأقصى (${maxQuestions} سؤالاً) وتجاهل الصفوف الزائدة.`);
      break;
    }

    questions.push({
      question_text: qMain,
      question_text_ar: qAr,
      time_limit: timeLimit,
      choices: rawChoices.map((text, idx) => ({
        choice_text: text,
        choice_text_ar: '',
        is_correct: idx === correctIdx,
      })),
    });
  }

  return { questions, errors, warnings };
}

/**
 * Builds an Excel (.xlsx) Blob for the Tecorbi quiz template with sample questions and instructions.
 */
export function buildQuestionsTemplateWorkbook() {
  const wb = XLSX.utils.book_new();

  const sheetData = [EXCEL_TEMPLATE_HEADERS, ...EXCEL_SAMPLE_ROWS];
  const wsQuestions = XLSX.utils.aoa_to_sheet(sheetData);
  wsQuestions['!cols'] = [
    { wch: 44 },
    { wch: 38 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'الأسئلة - Questions');

  const instructions = [
    ['دليل تعبئة شيت الأسئلة - Tecorbi Kids Arena'],
    [''],
    ['العمود', 'الوصف', 'مطلوب؟'],
    ['السؤال (Question) *', 'نص السؤال الأساسي (إنجليزي أو عربي، حتى 500 حرف)', 'نعم'],
    ['الترجمة العربية (Arabic - Optional)', 'ترجمة أو نص إضافي بالعربية يظهر أسفل السؤال (اختياري)', 'لا'],
    ['الوقت بالثواني (Time 5-120)', 'مدة الإجابة بالثواني (من 5 إلى 120، الافتراضي 20)', 'لا'],
    ['الخيار 1..4 (Choice 1..4)', 'اكتب من خيارين إلى 4 خيارات (بحد أقصى 200 حرف لكل خيار)', 'خياران على الأقل'],
    ['الإجابة الصحيحة (Correct 1-4) *', 'اكتب رقم الإجابة الصحيحة (1 أو 2 أو 3 أو 4) أو نصها أو A-D', 'نعم'],
    [''],
    ['ملاحظات مهمة:', 'احذف صفوف الأمثلة أو عدّلها قبل الرفع. الحد الأقصى للمسابقة 50 سؤالاً.', ''],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(instructions);
  wsGuide['!cols'] = [{ wch: 34 }, { wch: 58 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'التعليمات - Guide');

  return wb;
}

export function triggerTemplateDownload() {
  const wb = buildQuestionsTemplateWorkbook();
  XLSX.writeFile(wb, 'tecorbi-questions-template.xlsx');
}
