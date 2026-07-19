<script lang="ts">
	interface NavEntry {
		anchorId: string;
		label: string;
	}

	interface Props {
		entries: NavEntry[];
	}

	let { entries }: Props = $props();

	let open = $state(false);
	const shown = $derived(open && entries.length > 0);

	function close() {
		open = false;
	}
</script>

<nav class="group-nav" class:open={shown}>
	{#if entries.length > 0}
		<div class="group-nav-title">Jump to product</div>
		{#each entries as entry, idx (entry.anchorId)}
			<a href={`#${entry.anchorId}`} title={entry.label} onclick={close}>
				{idx + 1}. {entry.label}
			</a>
		{/each}
	{/if}
</nav>

<div class="jump-nav-overlay" class:open={shown} onclick={close} role="presentation"></div>
<button
	class="jump-nav-toggle"
	class:visible={entries.length > 0}
	class:open={shown}
	type="button"
	onclick={() => (open = !open)}
>
	<span>Jump to product</span>
	<span class="jump-nav-toggle-arrow">▲</span>
</button>
