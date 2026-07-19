// Order Deduplicator: reads the raw orders TXT/CSV keeping every column,
// drops duplicate order-id rows, and prepends a "channel" column built from
// "<order-id> / <suffix>" (the order reference used downstream).

import { parseCSVRow } from './csv';

export interface RawTable {
	headers: string[];
	rows: string[][];
	orderIdIdx: number;
}

export function parseRawTable(text: string): RawTable {
	const lines = text.trim().split(/\r?\n/);
	if (lines.length < 1) throw new Error('File appears empty.');

	const firstLine = lines[0];
	const delimiter = firstLine.includes('\t') ? '\t' : ',';
	const headers = parseCSVRow(firstLine, delimiter).map((h) => h.trim());

	const orderIdIdx = headers.findIndex((h) => {
		const lower = h.toLowerCase();
		return lower === 'order-id' || lower === 'order_id';
	});
	if (orderIdIdx === -1) {
		throw new Error(`File missing an "order-id" column. Found: "${headers.join('", "')}".`);
	}

	const rows: string[][] = [];
	for (let i = 1; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		rows.push(parseCSVRow(lines[i], delimiter));
	}

	return { headers, rows, orderIdIdx };
}

export interface DedupeResult {
	headers: string[];
	rows: string[][];
	duplicateCount: number;
}

// Keeps the first occurrence of each order-id and prepends the channel column.
export function dedupeAndAddChannel(table: RawTable, suffix: string): DedupeResult {
	const seen = new Set<string>();
	const rows: string[][] = [];
	let duplicateCount = 0;

	for (const row of table.rows) {
		const orderId = (row[table.orderIdIdx] || '').trim();
		if (!orderId) continue;
		if (seen.has(orderId)) {
			duplicateCount++;
			continue;
		}
		seen.add(orderId);
		const channel = suffix.trim() ? `${orderId} / ${suffix.trim()}` : orderId;
		rows.push([channel, ...row]);
	}

	return { headers: ['channel', ...table.headers], rows, duplicateCount };
}

function csvField(v: string): string {
	return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildDedupedCsv(result: DedupeResult): string {
	const lines = [result.headers.map(csvField).join(',')];
	for (const row of result.rows) {
		lines.push(row.map(csvField).join(','));
	}
	return lines.join('\r\n');
}
