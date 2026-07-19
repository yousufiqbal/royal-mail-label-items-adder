<script lang="ts">
	import { readFileAsText, formatFileDate } from '$lib/csv';
	import { parseRawTable, dedupeAndAddChannel, buildDedupedCsv, type DedupeResult } from '$lib/dedup';

	let file: File | null = $state(null);
	let channelSuffix = $state('MSF AM');

	let logLines: { type: string; icon: string; msg: string }[] = $state([]);
	let logStatus = $state('');
	let showLog = $state(false);
	let showDownload = $state(false);
	let processing = $state(false);
	let result: DedupeResult | null = $state(null);

	function log(type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) {
		const icons = { info: '·', ok: '✓', warn: '⚠', err: '✗', head: '▸' };
		logLines = [...logLines, { type, icon: icons[type], msg }];
	}

	// "Deduplicated 19 July 2026 - Sunday.csv"
	function buildDedupedFilename(): string {
		const d = new Date();
		const day = d.getDate();
		const month = d.toLocaleDateString('en-GB', { month: 'long' });
		const year = d.getFullYear();
		const wday = d.toLocaleDateString('en-GB', { weekday: 'long' });
		return `Deduplicated ${day} ${month} ${year} - ${wday}.csv`;
	}

	function onFileChange(e: Event) {
		file = (e.target as HTMLInputElement).files?.[0] ?? null;
	}

	async function process() {
		if (!file) return;
		result = null;
		showDownload = false;
		logLines = [];
		showLog = true;
		logStatus = '';
		processing = true;

		try {
			log('head', 'Reading orders file…');
			const text = await readFileAsText(file);
			const table = parseRawTable(text);
			log('ok', `File loaded — ${table.rows.length} rows`);

			log('head', 'Removing duplicate order IDs…');
			result = dedupeAndAddChannel(table, channelSuffix);
			log('ok', `${result.rows.length} unique orders kept, ${result.duplicateCount} duplicate row(s) removed`);

			logStatus = `${result.rows.length} rows, ${result.duplicateCount} duplicates removed`;
			showDownload = true;
		} catch (err) {
			log('err', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
			console.error(err);
		} finally {
			processing = false;
		}
	}

	function download() {
		if (!result) return;
		const csv = buildDedupedCsv(result);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildDedupedFilename();
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}
</script>

<svelte:head><title>Order Deduplicator — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Order Deduplicator</h2>
		<p>
			Upload the orders TXT — the app drops duplicate order-id rows and adds a "channel" column
			("order-id / reference") at the start, ready to export as CSV.
		</p>
	</div>

	<section class="fields-section">
		<div class="fields-grid">
			<div class="field-group">
				<label class="field-label" for="channel-suffix">Order Reference</label>
				<input class="field-input" type="text" id="channel-suffix" placeholder="MSF AM" bind:value={channelSuffix} />
				<span class="field-hint">Appended after " / " to build the channel column</span>
			</div>
		</div>
	</section>

	<section class="upload-grid single">
		<div class="upload-card" class:has-file={!!file}>
			<h3>Orders TXT</h3>
			<p class="upload-hint">Same tab-delimited orders file — must have an <code>order-id</code> column</p>
			<label class="file-btn" for="dedup-input">
				Choose TXT
				<input type="file" id="dedup-input" accept=".txt,.tsv,.tab,.csv" hidden onchange={onFileChange} />
			</label>
			{#if file}
				<div class="file-name-row">
					<span class="file-name ready">{file.name}</span>
					<span class="file-name-date">{formatFileDate(file)}</span>
				</div>
			{:else}
				<div class="file-name">No file chosen</div>
			{/if}
		</div>
	</section>

	<div class="action-row">
		<button class="process-btn" class:loading={processing} disabled={!file || processing} onclick={process}>
			<span class="btn-text">{processing ? 'Processing…' : 'Remove Duplicates'}</span>
			<span class="btn-icon">{processing ? '' : '→'}</span>
		</button>
	</div>

	{#if showLog}
		<section class="log-section">
			<div class="log-header">
				<h3>Processing Log</h3>
				<div class="log-status">{logStatus}</div>
			</div>
			<div class="log-body">
				{#each logLines as line, i (i)}
					<div class="log-line {line.type}">
						<span class="icon">{line.icon}</span><span class="msg">{line.msg}</span>
					</div>
				{/each}
			</div>
			{#if showDownload}
				<div class="download-row">
					<button class="download-btn" onclick={download}>↓ Download Deduplicated CSV</button>
				</div>
			{/if}
		</section>
	{/if}
</main>
