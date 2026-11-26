/**
 * excelImport.js  — re-exports from excelQuiz.js with the names that app.jsx expects.
 *
 * app.jsx calls:
 *   buildTemplateWorkbook(XLSX)   → mapped to buildQuestionsTemplateWorkbook()
 *   parseExcelWorkbook(XLSX, buf) → mapped to parseQuestionsFromSpreadsheet(buf)
 */

import {
  buildQuestionsTemplateWorkbook,
  parseQuestionsFromSpreadsheet,
} from './excelQuiz';

/**
 * Builds the XLSX workbook for the downloadable questions template.
 * The `_XLSX` parameter is accepted but ignored — excelQuiz.js uses its own XLSX import.
 */
export function buildTemplateWorkbook(_XLSX) {
  return buildQuestionsTemplateWorkbook();
}

/**
 * Parses an uploaded Excel / CSV ArrayBuffer into validated quiz questions.
 * The `_XLSX` parameter is accepted but ignored — excelQuiz.js uses its own XLSX import.
 */
export function parseExcelWorkbook(_XLSX, buffer) {
  return parseQuestionsFromSpreadsheet(buffer);
}
