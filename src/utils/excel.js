/**
 * Thin styling layer over ExcelJS so every downloadable report looks the same.
 *
 * Nothing here knows about expenses or meals — it only knows how a SaarthiOS
 * sheet should look: a title block, section headings, and tables with a dark
 * header, hairline rows and an optional total.
 */
import ExcelJS from 'exceljs';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const INK = 'FF23302B';
const MUTED = 'FF6F7D77';
const ACCENT = 'FF4E7C6B';
const HEADER_BG = 'FF23302B';
const HEADER_INK = 'FFFFFFFF';
const BAND_BG = 'FFEDF2EF';
const LINE = 'FFDCE3DF';

export const DATE_FORMAT = 'dd mmm yyyy';
export const NUMBER_FORMAT = '#,##0';
export const DECIMAL_FORMAT = '#,##0.0';
export const PERCENT_FORMAT = '0.0%';

/** `"₹"#,##0.00` — quoting keeps Excel from reading the symbol as a token. */
export const moneyFormat = (symbol) => `"${symbol}"#,##0.00`;

const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/**
 * Excel stores dates as UTC serials, so a local evening timestamp would print
 * as the next day. Pinning to UTC midnight of the local calendar day keeps the
 * printed date identical to the one the app shows.
 */
export const excelDate = (value) => {
  const d = new Date(value);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

export function createWorkbook(title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SaarthiOS';
  workbook.lastModifiedBy = 'SaarthiOS';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = title;
  return workbook;
}

export function addSheet(workbook, name, widths) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'portrait' }
  });
  sheet.columns = widths.map((width) => ({ width }));
  return sheet;
}

/** Title / period / provenance block. Returns the first free row below it. */
export function writeTitle(sheet, { title, subtitle, meta, span }) {
  const lines = [
    { text: title, font: { bold: true, size: 16, color: { argb: INK } }, height: 26 },
    { text: subtitle, font: { bold: true, size: 11, color: { argb: ACCENT } }, height: 18 },
    { text: meta, font: { size: 9, color: { argb: MUTED } }, height: 16 }
  ];

  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    if (span > 1) sheet.mergeCells(rowNumber, 1, rowNumber, span);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = line.text;
    cell.font = line.font;
    cell.alignment = { vertical: 'middle' };
    sheet.getRow(rowNumber).height = line.height;
  });

  return lines.length + 2;
}

/** A small caps heading above a table. Returns the first free row below it. */
export function writeHeading(sheet, row, text, span = 1) {
  if (span > 1) sheet.mergeCells(row, 1, row, span);
  const cell = sheet.getCell(row, 1);
  cell.value = String(text).toUpperCase();
  cell.font = { bold: true, size: 9, color: { argb: MUTED } };
  cell.alignment = { vertical: 'middle' };
  sheet.getRow(row).height = 18;
  return row + 1;
}

/** Label/value pairs for the overview block. Returns the next free row. */
export function writeFacts(sheet, row, facts, { span = 4 } = {}) {
  let current = row;
  for (const fact of facts) {
    const sheetRow = sheet.getRow(current);
    const label = sheetRow.getCell(1);
    label.value = fact.label;
    label.font = { size: 10, color: { argb: MUTED } };
    label.alignment = { vertical: 'middle' };

    const value = sheetRow.getCell(2);
    value.value = fact.value;
    value.font = { bold: true, size: 11, color: { argb: INK } };
    value.alignment = { horizontal: 'left', vertical: 'middle' };
    if (fact.numFmt) value.numFmt = fact.numFmt;

    if (fact.hint) {
      if (span > 3) sheet.mergeCells(current, 3, current, span);
      const hint = sheetRow.getCell(3);
      hint.value = fact.hint;
      hint.font = { size: 9, color: { argb: MUTED } };
      hint.alignment = { vertical: 'middle' };
    }

    sheetRow.height = 18;
    current += 1;
  }
  return current + 1;
}

/**
 * A table with a dark header row.
 *
 * `rows` holds arrays of cell values in column order. Wrap one in
 * `{ cells, variant: 'band' }` to turn it into a shaded group heading, which is
 * how the per-category sheets separate one group from the next.
 *
 * Returns the first free row below the table.
 */
export function writeTable(sheet, { row, columns, rows, total, freeze = true, filter = false }) {
  const headerRowNumber = row;
  const headerRow = sheet.getRow(headerRowNumber);

  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_INK } };
    cell.fill = solid(HEADER_BG);
    cell.alignment = { horizontal: column.align ?? 'left', vertical: 'middle' };
  });
  headerRow.height = 20;

  let current = headerRowNumber + 1;

  for (const entry of rows) {
    const isBand = !Array.isArray(entry);
    const values = isBand ? entry.cells : entry;
    const sheetRow = sheet.getRow(current);

    columns.forEach((column, index) => {
      const cell = sheetRow.getCell(index + 1);
      const value = values[index];
      cell.value = value === undefined ? null : value;
      if (column.numFmt && typeof value === 'number') cell.numFmt = column.numFmt;
      cell.alignment = { horizontal: column.align ?? 'left', vertical: 'middle', wrapText: false };
      cell.font = { size: 10, bold: isBand, color: { argb: INK } };
      if (isBand) cell.fill = solid(BAND_BG);
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });

    sheetRow.height = isBand ? 20 : 17;
    current += 1;
  }

  if (total) {
    const sheetRow = sheet.getRow(current);
    columns.forEach((column, index) => {
      const cell = sheetRow.getCell(index + 1);
      const value = total[index];
      cell.value = value === undefined ? null : value;
      if (column.numFmt && typeof value === 'number') cell.numFmt = column.numFmt;
      cell.alignment = { horizontal: column.align ?? 'left', vertical: 'middle' };
      cell.font = { bold: true, size: 10, color: { argb: INK } };
      cell.border = { top: { style: 'thin', color: { argb: INK } } };
    });
    sheetRow.height = 20;
    current += 1;
  }

  if (freeze) {
    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber, showGridLines: false }];
  }
  if (filter && rows.length) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: columns.length }
    };
  }

  return current + 1;
}

/** Shown instead of a table when the period has nothing in it. */
export function writeEmpty(sheet, row, message, span = 4) {
  if (span > 1) sheet.mergeCells(row, 1, row, span);
  const cell = sheet.getCell(row, 1);
  cell.value = message;
  cell.font = { size: 10, italic: true, color: { argb: MUTED } };
  sheet.getRow(row).height = 18;
  return row + 2;
}

/**
 * Hands a finished workbook to the browser as a download.
 * The name is reduced to plain ASCII: anything else either breaks the header
 * or, worse, lets a stray newline write headers of its own.
 */
export function sendWorkbook(res, filename, buffer) {
  const safeName = String(filename).replace(/[^\w.-]+/g, '-');
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', buffer.byteLength);
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(buffer));
}
