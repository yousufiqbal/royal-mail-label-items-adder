<script lang="ts">
	import { parseTsv, parseNumber, slugify } from '$lib/restock/shared';
	import { buildRecords, groupByName, formatPrice, countOos, type FbmGroup } from '$lib/restock/fbmStock';
	import UploadCard from '$lib/components/UploadCard.svelte';
	import JumpNav from '$lib/components/JumpNav.svelte';

	let fbmInventoryText: string | null = $state(null);
	let fbmInventoryName = $state('No file selected');
	let errorMsg = $state('');
	let allGroups: FbmGroup[] | null = $state(null);

	let showOosOnly = $state(false);
	let filterStockRange = $state(false);
	let stockRangeMin = $state('');
	let stockRangeMax = $state('');
	let hideNoVariant = $state(false);

	const mergeDisabled = $derived(!fbmInventoryText);

	const displayGroups = $derived.by((): FbmGroup[] => {
		if (!allGroups) return [];
		const min = stockRangeMin === '' ? -Infinity : parseNumber(stockRangeMin);
		const max = stockRangeMax === '' ? Infinity : parseNumber(stockRangeMax);

		if (!showOosOnly && !filterStockRange && !hideNoVariant) {
			return allGroups.slice().sort((a, b) => b.rows.length - a.rows.length);
		}

		return allGroups
			.map((g) => ({
				key: g.key,
				name: g.name,
				rows: g.rows.filter(
					(r) => (!showOosOnly || r.isOos) && (!filterStockRange || (r.stock >= min && r.stock <= max)) && (!hideNoVariant || !!r.description)
				)
			}))
			.filter((g) => g.rows.length > 0)
			.sort((a, b) => b.rows.length - a.rows.length);
	});

	const totalRows = $derived.by(() => {
		const groups = allGroups;
		return groups ? groups.reduce((sum, g) => sum + g.rows.length, 0) : 0;
	});
	const totalOos = $derived.by(() => {
		const groups = allGroups;
		return groups ? groups.reduce((sum, g) => sum + countOos(g.rows), 0) : 0;
	});

	const summaryMsg = $derived.by(() => {
		if (!allGroups) return '';
		const shownRows = displayGroups.reduce((sum, g) => sum + g.rows.length, 0);
		return `${shownRows} of ${totalRows} listings shown across ${displayGroups.length} of ${allGroups.length} products. ${totalOos} out of stock total.`;
	});

	interface NavEntry {
		anchorId: string;
		label: string;
	}

	const navEntries = $derived.by((): NavEntry[] =>
		displayGroups.map((group) => ({ anchorId: `group-${slugify(group.key)}`, label: group.name }))
	);

	function onFbmInventoryChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fbmInventoryName = file.name;
		file.text().then((text) => {
			fbmInventoryText = text;
		});
	}

	function handleProcess() {
		errorMsg = '';
		allGroups = null;

		try {
			if (!fbmInventoryText) throw new Error('Upload a file first.');
			const rows = parseTsv(fbmInventoryText);
			const records = buildRecords(rows);
			if (records.length === 0) throw new Error('No merchant-fulfilled (FBM) listings found in this file.');
			allGroups = groupByName(records);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to process file.';
		}
	}
</script>

<svelte:head><title>FBM Stock Check — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>FBM Stock Check</h2>
		<p>Upload your FBM Inventory / Listings Report to find out-of-stock listings.</p>
	</div>

	<div class="upload-grid single">
		<UploadCard
			id="fbmInventoryInput"
			label="FBM Inventory / Listings Report (.txt)"
			accept=".txt"
			fileName={fbmInventoryName}
			onchange={onFbmInventoryChange}
		/>
	</div>

	<div class="filter-row">
		<label><input type="checkbox" bind:checked={showOosOnly} /> Show only out-of-stock rows</label>
		<label><input type="checkbox" bind:checked={hideNoVariant} /> Hide rows without variant</label>
		<label class="min-recommended-filter">
			<input type="checkbox" bind:checked={filterStockRange} /> Stock range
			<input type="number" step="1" placeholder="min" bind:value={stockRangeMin} />
			–
			<input type="number" step="1" placeholder="max" bind:value={stockRangeMax} />
		</label>
	</div>

	<div class="action-row" style="justify-content: flex-start">
		<button class="process-btn" disabled={mergeDisabled} onclick={handleProcess}>
			<span class="btn-text">Process file</span>
		</button>
	</div>

	<p class="error">{errorMsg}</p>
	<p class="summary">{summaryMsg}</p>

	<div class="results-layout">
		<div class="results-main">
			{#each displayGroups as group (group.key)}
				{@const anchorId = `group-${slugify(group.key)}`}
				{@const oosCount = countOos(group.rows)}
				<div class="parent-group" id={anchorId}>
					<div class="parent-group-header">
						<div class="parent-group-title">
							{group.name}
							<span class="parent-asin">
								{group.rows.length} listing{group.rows.length > 1 ? 's' : ''}{oosCount > 0 ? ` — ${oosCount} out of stock` : ''}
							</span>
						</div>
					</div>

					{#if oosCount > 0}
						<div class="oos-warning">{oosCount} variant{oosCount > 1 ? 's' : ''} out of stock in this table</div>
					{/if}

					<div class="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Colour</th>
									<th>Variant</th>
									<th>ASIN</th>
									<th>Status</th>
									<th>Price</th>
									<th>FBM Stock</th>
								</tr>
							</thead>
							<tbody>
								{#each group.rows as row, idx (row.sku || idx)}
									<tr class:row-oos={row.isOos}>
										<td>{row.color || '—'}</td>
										<td>{row.description || '—'}</td>
										<td>{row.asin}</td>
										<td>{row.status}</td>
										<td>{formatPrice(row.price)}</td>
										<td class:oos-label={row.isOos}>{row.isOos ? `${row.stock} (OUT OF STOCK)` : row.stock}</td>
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
