<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	let navOpen = $state(false);
	function toggleNav() {
		navOpen = !navOpen;
	}
	function closeNav() {
		navOpen = false;
	}

	interface NavLink {
		href: string;
		label: string;
	}
	interface NavGroup {
		title: string;
		links: NavLink[];
	}

	const groups: NavGroup[] = [
		{
			title: 'Labels',
			links: [
				{ href: '/labels/label-filler', label: 'Label Filler' },
				{ href: '/labels/tracking-export', label: 'Tracking Export' },
				{ href: '/labels/purchasing-list', label: 'Purchasing List' },
				{ href: '/labels/merge-pdf', label: 'Merge PDF' }
			]
		},
		{
			title: 'FBA Restock',
			links: [
				{ href: '/restock/restock-report', label: 'Restock Report' },
				{ href: '/restock/fbm-stock', label: 'FBM Stock Check' }
			]
		},
		{
			title: 'Reseller',
			links: [{ href: '/reseller', label: 'Flat File Generator' }]
		}
	];

	const currentPath = $derived(page.url.pathname);
</script>

<svelte:head>
	<title>Amazon Tools</title>
</svelte:head>

<header class="mobile-header">
	<div class="mobile-header-inner">
		<a class="logo" href="/labels/label-filler">
			<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
				<rect x="2" y="2" width="10" height="10" rx="2" fill="var(--accent)" />
				<rect x="16" y="2" width="10" height="10" rx="2" fill="var(--accent)" opacity="0.5" />
				<rect x="2" y="16" width="10" height="10" rx="2" fill="var(--accent)" opacity="0.5" />
				<rect x="16" y="16" width="10" height="10" rx="2" fill="var(--accent)" />
			</svg>
			<span class="logo-text-group">
				<span class="logo-text">Amazon Tools</span>
				<span class="logo-subheading">by Yousuf Iqbal</span>
			</span>
		</a>
		<button
			class="nav-toggle"
			id="nav-toggle"
			aria-label="Toggle menu"
			aria-expanded={navOpen}
			onclick={(e) => {
				e.stopPropagation();
				toggleNav();
			}}
		>
			<span></span><span></span><span></span>
		</button>
	</div>
	<nav class="nav" id="mobile-nav" class:open={navOpen}>
		{#each groups as group (group.title)}
			<div class="nav-group">
				<div class="nav-group-title">{group.title}</div>
				<div class="nav-group-items">
					{#each group.links as link (link.href)}
						<a
							class="nav-btn"
							class:active={currentPath === link.href}
							href={link.href}
							onclick={closeNav}
						>
							{link.label}
						</a>
					{/each}
				</div>
			</div>
		{/each}
	</nav>
</header>

<svelte:window
	onclick={(e) => {
		if (!navOpen) return;
		const target = e.target as Node;
		const navEl = document.getElementById('mobile-nav');
		const toggleEl = document.getElementById('nav-toggle');
		if (navEl && !navEl.contains(target) && target !== toggleEl) closeNav();
	}}
/>

<div class="layout">
	<aside class="sidebar">
		<a class="logo" href="/labels/label-filler">
			<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
				<rect x="2" y="2" width="10" height="10" rx="2" fill="var(--accent)" />
				<rect x="16" y="2" width="10" height="10" rx="2" fill="var(--accent)" opacity="0.5" />
				<rect x="2" y="16" width="10" height="10" rx="2" fill="var(--accent)" opacity="0.5" />
				<rect x="16" y="16" width="10" height="10" rx="2" fill="var(--accent)" />
			</svg>
			<span class="logo-text-group">
				<span class="logo-text">Amazon Tools</span>
				<span class="logo-subheading">by Yousuf Iqbal</span>
			</span>
		</a>
		<nav class="nav nav-sidebar">
			{#each groups as group (group.title)}
				<div class="nav-group">
					<div class="nav-group-title">{group.title}</div>
					<div class="nav-group-items">
						{#each group.links as link (link.href)}
							<a class="nav-btn" class:active={currentPath === link.href} href={link.href}>
								{link.label}
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</nav>
	</aside>

	<div class="content">
		{@render children()}
	</div>
</div>
