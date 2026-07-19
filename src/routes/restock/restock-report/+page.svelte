<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { parseCsv, parseTsv, parseNumber, slugify } from '$lib/restock/shared';
	import {
		COLUMN_LABELS,
		WRAP_COLUMNS,
		buildInventoryMap,
		mergeData,
		groupByParent,
		makeFilename,
		findDuplicateAsins,
		rowsToCsv,
		type ColumnKey,
		type RestockGroup,
		type RestockRow
	} from '$lib/restock/restock';
	import UploadCard from '$lib/components/UploadCard.svelte';
	import JumpNav from '$lib/components/JumpNav.svelte';

	const STORAGE_KEY = 'fbaRestockistSettings';
	const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
		'asin',
		'fnsku',
		'title',
		'description',
		'ordered',
		'stock',
		'restock',
		'recommendedRestock'
	];

	let supplierDays = $state('');
	let transitDays = $state('');
	let receiveDays = $state('');
	let restockPeriodDays = $state('');
	let reportStartDate = $state('');
	let reportEndDate = $state('');

	let columnOrder: ColumnKey[] = $state([...DEFAULT_COLUMN_ORDER]);
	let columnEnabled: Record<ColumnKey, boolean> = $state({
		asin: true,
		fnsku: true,
		title: true,
		description: true,
		ordered: true,
		stock: true,
		restock: true,
		recommendedRestock: true
	});
	let draggedKey: ColumnKey | null = $state(null);
	let dragOverKey: ColumnKey | null = $state(null);
	let dragOverSide: 'left' | 'right' | null = $state(null);

	let hideZeroSales = $state(false);
	let hideBelowMinRecommended = $state(false);
	let minRecommendedValue = $state('0');

	let businessReportText: string | null = $state(null);
	let inventoryText: string | null = $state(null);
	let businessReportName = $state('No file selected');
	let inventoryName = $state('No file selected');

	let mergedGroups: RestockGroup[] | null = $state(null);
	let errorMsg = $state('');
	let coverageDaysAtMerge = $state(0);
	let reportPeriodDaysAtMerge = $state(0);

	const coverageDays = $derived(
		parseNumber(supplierDays) + parseNumber(transitDays) + parseNumber(receiveDays) + parseNumber(restockPeriodDays)
	);

	const timingHint = $derived.by(() => {
		if (coverageDays <= 0) return 'Fill in the fields above to see how many days of sales history to use.';
		const months = Math.ceil(coverageDays / 30);
		return `Total coverage needed: ${coverageDays} days. Pull a Business Report covering at least ${coverageDays} days (~${months} month${months > 1 ? 's' : ''}) and enter its exact period below.`;
	});

	const reportPeriodDays = $derived.by(() => {
		if (!reportStartDate || !reportEndDate) return 0;
		const start = new Date(reportStartDate + 'T00:00:00');
		const end = new Date(reportEndDate + 'T00:00:00');
		const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
		return days > 0 ? days : 0;
	});

	const reportPeriodComputed = $derived(
		reportPeriodDays > 0
			? `Report period: ${reportPeriodDays} day${reportPeriodDays > 1 ? 's' : ''}`
			: 'Report period: — (pick a valid start/end date)'
	);

	const selectedColumns = $derived(columnOrder.filter((key) => columnEnabled[key]));
	const mergeDisabled = $derived(!(businessReportText && inventoryText));

	const displayGroups = $derived.by((): RestockGroup[] => {
		if (!mergedGroups) return [];
		const minRecommended = parseNumber(minRecommendedValue);
		if (!hideZeroSales && !hideBelowMinRecommended) return mergedGroups;
		return mergedGroups
			.map((group) => ({
				parentAsin: group.parentAsin,
				rows: group.rows.filter(
					(r) => (!hideZeroSales || r.ordered > 0) && (!hideBelowMinRecommended || r.recommendedRestock >= minRecommended)
				)
			}))
			.filter((group) => group.rows.length > 0);
	});

	function countRows(groups: RestockGroup[]): number {
		return groups.reduce((sum, g) => sum + g.rows.length, 0);
	}

	const summaryMsg = $derived.by(() => {
		if (!mergedGroups) return '';
		return `${displayGroups.length} of ${mergedGroups.length} products shown (${countRows(displayGroups)} of ${countRows(mergedGroups)} rows). Coverage: ${coverageDaysAtMerge} days, report period: ${reportPeriodDaysAtMerge} days.`;
	});

	interface NavEntry {
		anchorId: string;
		label: string;
	}

	const navEntries = $derived.by((): NavEntry[] =>
		displayGroups.map((group) => ({
			anchorId: `group-${slugify(group.parentAsin)}`,
			label: group.rows[0]?.title || group.parentAsin
		}))
	);

	function saveSettings() {
		if (!browser) return;
		const state = {
			supplierDays,
			transitDays,
			receiveDays,
			restockPeriodDays,
			reportStartDate,
			reportEndDate,
			hideZeroSales,
			hideBelowMinRecommended,
			minRecommendedValue,
			columnOrder,
			columnEnabled
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			/* ignore storage errors */
		}
	}

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const state = JSON.parse(raw);
			if (state.supplierDays !== undefined) supplierDays = state.supplierDays;
			if (state.transitDays !== undefined) transitDays = state.transitDays;
			if (state.receiveDays !== undefined) receiveDays = state.receiveDays;
			if (state.restockPeriodDays !== undefined) restockPeriodDays = state.restockPeriodDays;
			if (state.reportStartDate !== undefined) reportStartDate = state.reportStartDate;
			if (state.reportEndDate !== undefined) reportEndDate = state.reportEndDate;
			if (state.hideZeroSales !== undefined) hideZeroSales = state.hideZeroSales;
			if (state.hideBelowMinRecommended !== undefined) hideBelowMinRecommended = state.hideBelowMinRecommended;
			if (state.minRecommendedValue !== undefined) minRecommendedValue = state.minRecommendedValue;
			if (Array.isArray(state.columnOrder)) columnOrder = state.columnOrder;
			if (state.columnEnabled) columnEnabled = { ...columnEnabled, ...state.columnEnabled };
		} catch {
			/* ignore parse errors */
		}
	});

	$effect(() => {
		void [
			supplierDays,
			transitDays,
			receiveDays,
			restockPeriodDays,
			reportStartDate,
			reportEndDate,
			hideZeroSales,
			hideBelowMinRecommended,
			minRecommendedValue,
			columnOrder,
			columnEnabled
		];
		saveSettings();
	});

	function onBusinessReportChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		businessReportName = file.name;
		file.text().then((text) => {
			businessReportText = text;
		});
	}

	function onInventoryChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		inventoryName = file.name;
		file.text().then((text) => {
			inventoryText = text;
		});
	}

	function handleMerge() {
		errorMsg = '';
		mergedGroups = null;

		try {
			if (reportPeriodDays <= 0) throw new Error('Pick a valid Business Report start and end date.');
			if (!businessReportText || !inventoryText) throw new Error('Upload both files first.');

			const businessRows = parseCsv(businessReportText);
			const inventoryRows = parseTsv(inventoryText);

			if (businessRows.length < 2) throw new Error('Business report appears empty or unreadable.');
			if (inventoryRows.length < 2) throw new Error('Inventory file appears empty or unreadable.');

			coverageDaysAtMerge = coverageDays;
			reportPeriodDaysAtMerge = reportPeriodDays;

			const inventoryMap = buildInventoryMap(inventoryRows);
			const rows = mergeData(businessRows, inventoryMap, coverageDays, reportPeriodDays);
			mergedGroups = groupByParent(rows);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to merge files.';
		}
	}

	function downloadGroupCsv(group: RestockGroup) {
		if (selectedColumns.length === 0) {
			errorMsg = 'Select at least one column to export.';
			return;
		}
		const csv = rowsToCsv(group.rows, selectedColumns);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = makeFilename(group);
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	function cellValue(row: RestockRow, key: ColumnKey): string | number {
		return row[key];
	}

	function onChipDragStart(key: ColumnKey) {
		draggedKey = key;
	}

	function onChipDragOver(e: DragEvent, key: ColumnKey) {
		e.preventDefault();
		if (!draggedKey || key === draggedKey) {
			dragOverKey = null;
			dragOverSide = null;
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const side: 'left' | 'right' = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
		dragOverKey = key;
		dragOverSide = side;
	}

	function onChipDrop() {
		if (!draggedKey || !dragOverKey || dragOverKey === draggedKey) {
			draggedKey = null;
			dragOverKey = null;
			dragOverSide = null;
			return;
		}
		const from = columnOrder.indexOf(draggedKey);
		const targetIdx = columnOrder.indexOf(dragOverKey);
		const next = columnOrder.slice();
		next.splice(from, 1);
		const insertAt =
			dragOverSide === 'left' ? targetIdx - (from < targetIdx ? 1 : 0) : targetIdx - (from < targetIdx ? 1 : 0) + 1;
		next.splice(Math.max(0, insertAt), 0, draggedKey);
		columnOrder = next;
		draggedKey = null;
		dragOverKey = null;
		dragOverSide = null;
	}

	function onChipDragEnd() {
		draggedKey = null;
		dragOverKey = null;
		dragOverSide = null;
	}
</script>

<svelte:head><title>Restock Report — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Restock Report</h2>
		<p>Merge Amazon Business Report + FBA Inventory into a restock CSV.</p>
	</div>

	<div class="timing-card">
		<h2>Timing settings (days)</h2>
		<div class="timing-grid">
			<div class="timing-field">
				<label for="supplierDays">Supplier lead time</label>
				<input type="number" id="supplierDays" min="0" step="1" placeholder="e.g. 20" bind:value={supplierDays} />
			</div>
			<div class="timing-field">
				<label for="transitDays">Transit to FBA</label>
				<input type="number" id="transitDays" min="0" step="1" placeholder="e.g. 10" bind:value={transitDays} />
			</div>
			<div class="timing-field">
				<label for="receiveDays">Amazon receiving time</label>
				<input type="number" id="receiveDays" min="0" step="1" placeholder="e.g. 7" bind:value={receiveDays} />
			</div>
			<div class="timing-field">
				<label for="restockPeriodDays">Restock period (buffer)</label>
				<input type="number" id="restockPeriodDays" min="0" step="1" placeholder="e.g. 14" bind:value={restockPeriodDays} />
			</div>
		</div>
		<p class="timing-hint">{timingHint}</p>
		<div class="timing-field-report-grid">
			<div class="timing-field">
				<label for="reportStartDate">Business Report start date</label>
				<input type="date" id="reportStartDate" bind:value={reportStartDate} />
			</div>
			<div class="timing-field">
				<label for="reportEndDate">Business Report end date</label>
				<input type="date" id="reportEndDate" bind:value={reportEndDate} />
			</div>
			<p class="report-period-computed">{reportPeriodComputed}</p>
		</div>
	</div>

	<div class="upload-grid">
		<UploadCard
			id="businessReportInput"
			label="Business Report (.csv)"
			accept=".csv"
			fileName={businessReportName}
			onchange={onBusinessReportChange}
		/>
		<UploadCard
			id="inventoryInput"
			label="FBA Inventory (.txt)"
			accept=".txt"
			fileName={inventoryName}
			onchange={onInventoryChange}
		/>
	</div>

	<div class="column-picker">
		<span class="column-picker-label">Columns (drag to reorder):</span>
		{#each columnOrder as key (key)}
			<div
				class="col-chip"
				class:dragging={draggedKey === key}
				class:drag-over-left={dragOverKey === key && dragOverSide === 'left'}
				class:drag-over-right={dragOverKey === key && dragOverSide === 'right'}
				draggable="true"
				role="listitem"
				ondragstart={() => onChipDragStart(key)}
				ondragover={(e) => onChipDragOver(e, key)}
				ondrop={onChipDrop}
				ondragend={onChipDragEnd}
			>
				<span class="col-drag-handle">⠿</span>
				<label>
					<input type="checkbox" class="col-toggle" bind:checked={columnEnabled[key]} />
					{COLUMN_LABELS[key]}
				</label>
			</div>
		{/each}
	</div>

	<div class="filter-row">
		<label><input type="checkbox" bind:checked={hideZeroSales} /> Hide rows with 0 sales</label>
		<label class="min-recommended-filter">
			<input type="checkbox" bind:checked={hideBelowMinRecommended} /> Min. recommended restock
			<input type="number" step="1" bind:value={minRecommendedValue} />
		</label>
	</div>

	<div class="action-row" style="justify-content: flex-start">
		<button class="process-btn" disabled={mergeDisabled} onclick={handleMerge}>
			<span class="btn-text">Merge</span>
		</button>
	</div>

	<p class="error">{errorMsg}</p>
	<p class="summary">{summaryMsg}</p>

	<div class="results-layout">
		<div class="results-main">
			{#each displayGroups as group (group.parentAsin)}
				{@const anchorId = `group-${slugify(group.parentAsin)}`}
				{@const sampleName = group.rows[0]?.title || ''}
				{@const duplicateAsins = findDuplicateAsins(group.rows)}
				<div class="parent-group" id={anchorId}>
					<div class="parent-group-header">
						<div class="parent-group-title">
							{sampleName}
							<span class="parent-asin">Parent ASIN: {group.parentAsin}</span>
						</div>
						<button class="download-btn small" onclick={() => downloadGroupCsv(group)}> Download CSV </button>
					</div>

					{#if duplicateAsins.length > 0}
						<div class="duplicate-warning">
							Warning: duplicate variant ASIN{duplicateAsins.length > 1 ? 's' : ''} in this table — {duplicateAsins.join(', ')}
						</div>
					{/if}

					<div class="table-wrap">
						<table>
							<thead>
								<tr>
									{#each selectedColumns as key (key)}
										<th class:col-wrap={WRAP_COLUMNS.has(key)}>{COLUMN_LABELS[key]}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each group.rows as row (row.asin)}
									<tr>
										{#each selectedColumns as key (key)}
											<td
												class:col-wrap={WRAP_COLUMNS.has(key)}
												class:restock-negative={(key === 'restock' && row.restock > 0) ||
													(key === 'recommendedRestock' && row.recommendedRestock > 0) ||
													(key === 'fnsku' && row.fnsku === '(Not FBA Listed)')}
												class:restock-positive={(key === 'restock' && row.restock <= 0) ||
													(key === 'recommendedRestock' && row.recommendedRestock <= 0)}
											>
												{cellValue(row, key)}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		</div>

		<JumpNav entries={navEntries} />
	</div>
</main>
