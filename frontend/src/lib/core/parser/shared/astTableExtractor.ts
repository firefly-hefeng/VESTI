import type { AstTableNode } from "../../../types/ast";

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readRowCells(row: Element): string[] {
  const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
  return cells
    .map((cell) => normalizeCellText(cell.textContent ?? ""))
    .filter((cell) => cell.length > 0);
}

function readHeaderCells(tableEl: Element): string[] {
  const headerRows = Array.from(tableEl.querySelectorAll("thead > tr"));
  if (headerRows.length > 0) {
    const headers = readRowCells(headerRows[0]);
    if (headers.length > 0) return headers;
  }

  const firstRow = tableEl.querySelector("tr");
  if (!firstRow) return [];

  const explicitHeaders = Array.from(firstRow.querySelectorAll(":scope > th"))
    .map((cell) => normalizeCellText(cell.textContent ?? ""))
    .filter((cell) => cell.length > 0);

  if (explicitHeaders.length > 0) {
    return explicitHeaders;
  }

  return [];
}

function readBodyRows(tableEl: Element, hasHeaderRow: boolean): string[][] {
  const tbodyRows = Array.from(tableEl.querySelectorAll("tbody > tr"));
  const rows = tbodyRows.length > 0 ? tbodyRows : Array.from(tableEl.querySelectorAll("tr"));

  return rows
    .filter((row, index) => !(hasHeaderRow && index === 0 && tbodyRows.length === 0))
    .map((row) => readRowCells(row))
    .filter((cells) => cells.length > 0);
}

export function extractTableNode(tableEl: Element): AstTableNode | null {
  const headers = readHeaderCells(tableEl);
  const rows = readBodyRows(tableEl, headers.length > 0);

  if (headers.length === 0 && rows.length === 0) {
    return null;
  }

  if (headers.length === 0 && rows.length > 0) {
    const firstRow = rows[0];
    return {
      type: "table",
      headers: firstRow.map((_, index) => `Column ${index + 1}`),
      rows,
    };
  }

  return {
    type: "table",
    headers,
    rows,
  };
}
