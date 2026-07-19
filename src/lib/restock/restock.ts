import { parseNumber, slugify, splitTitle, toHeaderMap } from './shared';

export type ColumnKey =
	| 'asin'
	| 'fnsku'
	| 'title'
	| 'description'
	| 'ordered'
	| 'stock'
	| 'restock'
	| 'recommendedRestock';

export const COLUMN_LABELS: Record<ColumnKey, string> = {
	asin: 'ASIN',
	fnsku: 'FNSKU',
	title: 'Name',
	description: 'Description',
	ordered: 'Sales',
	stock: 'FBA Stock',
	restock: 'Restock',
	recommendedRestock: 'Recommended Restock'
};

export const WRAP_COLUMNS = new Set<ColumnKey>(['title', 'description']);

export interface RestockRow {
	parentAsin: string;
	asin: string;
	fnsku: string;
	title: string;
	description: string;
	ordered: number;
	stock: number;
	restock: number;
	recommendedRestock: number;
}

export interface RestockGroup {
	parentAsin: string;
	rows: RestockRow[];
}

interface InventoryEntry {
	fnsku: string;
	stock: number;
}

export function buildInventoryMap(rows: string[][]): Map<string, InventoryEntry> {
	const headerMap = toHeaderMap(rows[0]);
	const asinIdx = headerMap['asin'];
	const fnskuIdx = headerMap['fulfillment-channel-sku'];
	const conditionTypeIdx = headerMap['condition-type'];
	const warehouseConditionIdx = headerMap['Warehouse-Condition-code'];
	const qtyIdx = headerMap['Quantity Available'];

	const map = new Map<string, InventoryEntry>();
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		if (!r || r.length <= asinIdx) continue;
		if (r[conditionTypeIdx] !== 'NewItem') continue;
		const asin = r[asinIdx];
		if (!asin) continue;
		const entry = map.get(asin) || { fnsku: r[fnskuIdx], stock: 0 };
		if (r[warehouseConditionIdx] === 'SELLABLE') {
			entry.stock += parseNumber(r[qtyIdx]);
		}
		if (!entry.fnsku) entry.fnsku = r[fnskuIdx];
		map.set(asin, entry);
	}
	return map;
}

export function mergeData(
	businessRows: string[][],
	inventoryMap: Map<string, InventoryEntry>,
	coverageDays: number,
	reportPeriodDays: number
): RestockRow[] {
	const headerMap = toHeaderMap(businessRows[0]);
	const parentAsinIdx = headerMap['(Parent) ASIN'];
	const asinIdx = headerMap['(Child) ASIN'];
	const titleIdx = headerMap['Title'];
	const orderedIdx = headerMap['Units ordered'];

	const results: RestockRow[] = [];
	for (let i = 1; i < businessRows.length; i++) {
		const r = businessRows[i];
		if (!r || r.length <= asinIdx) continue;
		const asin = r[asinIdx];
		if (!asin) continue;
		const parentAsin = parentAsinIdx !== undefined ? r[parentAsinIdx] || asin : asin;
		const { name: title, description } = splitTitle(r[titleIdx]);
		const ordered = parseNumber(r[orderedIdx]);
		const inv = inventoryMap.get(asin);
		const fnsku = inv && inv.fnsku ? inv.fnsku : '(Not FBA Listed)';
		const stock = inv ? inv.stock : 0;
		const restock = ordered - stock;
		const dailyVelocity = ordered / reportPeriodDays;
		const recommendedRestock = Math.ceil(dailyVelocity * coverageDays) - stock;
		results.push({
			parentAsin,
			asin,
			fnsku,
			title,
			description,
			ordered,
			stock,
			restock,
			recommendedRestock
		});
	}
	return results;
}

export function groupByParent(rows: RestockRow[]): RestockGroup[] {
	const order: string[] = [];
	const map = new Map<string, RestockRow[]>();
	rows.forEach((row) => {
		if (!map.has(row.parentAsin)) {
			map.set(row.parentAsin, []);
			order.push(row.parentAsin);
		}
		map.get(row.parentAsin)!.push(row);
	});
	return order.map((parentAsin) => ({ parentAsin, rows: map.get(parentAsin)! }));
}

export function makeFilename(group: RestockGroup): string {
	const sampleName = (group.rows[0] && group.rows[0].title) || group.parentAsin;
	const words = sampleName.trim().split(/\s+/).slice(0, 7).join(' ');
	const slug = slugify(words) || slugify(group.parentAsin) || 'product';
	return `${slug}-restock-report.csv`;
}

export function findDuplicateAsins(rows: RestockRow[]): string[] {
	const counts = new Map<string, number>();
	rows.forEach((r) => counts.set(r.asin, (counts.get(r.asin) || 0) + 1));
	return Array.from(counts.entries())
		.filter(([, count]) => count > 1)
		.map(([asin]) => asin);
}

export function rowsToCsv(rows: RestockRow[], columns: ColumnKey[]): string {
	const csvEscapeLocal = (value: unknown) => {
		const s = String(value);
		if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
		return s;
	};
	const header = columns.map((key) => COLUMN_LABELS[key]);
	const lines = [header.join(',')];
	rows.forEach((row) => {
		lines.push(columns.map((key) => csvEscapeLocal(row[key])).join(','));
	});
	return lines.join('\r\n');
}
