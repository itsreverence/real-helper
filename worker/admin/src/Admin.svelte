<script lang="ts">
    import { onMount } from "svelte";

    let stats: any = $state(null);
    let users: any[] = $state([]);
    let loading = $state(true);
    let error = $state("");

    const token = new URLSearchParams(window.location.search).get("token");

    async function loadData() {
        loading = true;
        error = "";
        try {
            const statsRes = await fetch(`/admin/api/stats?token=${token}`);
            const usersRes = await fetch(`/admin/api/users?token=${token}`);

            if (!statsRes.ok || !usersRes.ok) {
                throw new Error("UNAUTHORIZED ACCESS DETECTED");
            }

            stats = await statsRes.json();
            const userData = await usersRes.json();
            users = userData.users || [];
        } catch (e: any) {
            error = e.message || "SIGNAL LOST";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        loadData();
    });
</script>

<main>
    <div class="texture-overlay"></div>

    <header>
        <div class="title">
            <i>✦</i> RSDH ADMIN_CORE_SCAN
        </div>
        <div class="flex-row">
            {#if loading}
                <div class="spinner"></div>
            {/if}
            <button class="secondary" onclick={loadData}> REFRESH_SYNC </button>
        </div>
    </header>

    <div class="content">
        {#if error}
            <div class="card error">
                <div class="h">DATA_FETCH_RESISTANCE</div>
                <div class="sub">{error}</div>
            </div>
        {:else}
            <div class="grid">
                <div class="card stat-card">
                    <div class="h">DAILY_THROUGHPUT</div>
                    <div class="stat-value">{stats?.totalRequests || 0}</div>
                    <div class="sub">TOTAL_SESSION_REQUESTS</div>
                </div>

                <div class="card">
                    <div class="h">MODEL_DISTRIBUTION</div>
                    <div class="list">
                        {#if stats?.modelUsage}
                            {#each Object.entries(stats.modelUsage) as [model, count]}
                                <div class="row">
                                    <div class="font-mono text-accent">
                                        {model}
                                    </div>
                                    <div class="font-mono text-green">
                                        {count}
                                    </div>
                                </div>
                            {/each}
                        {:else}
                            <div class="sub">NO_MODEL_DATA_RETURNED</div>
                        {/if}
                    </div>
                </div>
            </div>

            <div
                class="card"
                style="border-left-color: var(--rsdh-accent-green);"
            >
                <div class="h">
                    <span>ACTIVE_OPERATIVES</span>
                    <span class="status-pill text-green status-pulsing"
                        >LIVE_FEED</span
                    >
                </div>
                <div class="table-wrap">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>OPERATIVE</th>
                                <th>REQ_TODAY</th>
                                <th>LAST_SYNC</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each users as user}
                                <tr>
                                    <td>
                                        <div style="font-weight: 800;">
                                            {user.displayName || "ANONYMOUS"}
                                        </div>
                                        <div
                                            class="font-mono"
                                            style="font-size: 10px; opacity: 0.5;"
                                        >
                                            {user.username}
                                        </div>
                                    </td>
                                    <td class="font-mono text-accent"
                                        >{user.todayRequests}</td
                                    >
                                    <td
                                        class="font-mono"
                                        style="font-size: 11px;"
                                        >{new Date(
                                            user.lastSeen,
                                        ).toLocaleString()}</td
                                    >
                                </tr>
                            {/each}
                            {#if users.length === 0}
                                <tr
                                    ><td
                                        colspan="3"
                                        style="text-align:center; padding: 48px; opacity: 0.3;"
                                        >NO_OPERATIVES_DETECTED</td
                                    ></tr
                                >
                            {/if}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}
    </div>
</main>

<style>
    :global(:root) {
        --rsdh-bg: #0d0d12;
        --rsdh-panel-bg: rgba(18, 18, 26, 0.95);
        --rsdh-accent: #00e5ff; /* Electric Blue */
        --rsdh-accent-green: #7cff01; /* RealSports Green */
        --rsdh-accent-red: #ff3d00;
        --rsdh-text: #f5f5f7;
        --rsdh-text-muted: #8e8e93;
        --rsdh-border: rgba(255, 255, 255, 0.08);
    }

    :global(body) {
        background-color: var(--rsdh-bg);
        color: var(--rsdh-text);
        font-family: "Inter", system-ui, sans-serif;
        margin: 0;
        overflow-x: hidden;
    }

    main {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    .texture-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: 0.03;
        background-image: radial-gradient(
            circle at 2px 2px,
            white 1px,
            transparent 0
        );
        background-size: 24px 24px;
        z-index: 10;
    }

    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24px 40px;
        background: linear-gradient(
            90deg,
            rgba(0, 229, 255, 0.05) 0%,
            transparent 100%
        );
        border-bottom: 1px solid var(--rsdh-border);
        backdrop-filter: blur(10px);
        z-index: 20;
    }

    .title {
        font-weight: 900;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        color: var(--rsdh-accent);
    }

    .title i {
        color: var(--rsdh-accent-green);
        font-style: normal;
        margin-right: 8px;
    }

    .content {
        flex: 1;
        padding: 40px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        z-index: 20;
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 24px;
        margin-bottom: 24px;
    }

    .card {
        background: rgba(255, 255, 255, 0.01);
        border: 1px solid var(--rsdh-border);
        border-left: 4px solid var(--rsdh-accent);
        padding: 24px;
        position: relative;
        overflow: hidden;
    }

    .card.error {
        border-left-color: var(--rsdh-accent-red);
    }

    .h {
        font-weight: 900;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .stat-value {
        font-size: 48px;
        font-weight: 900;
        color: var(--rsdh-accent);
        letter-spacing: -0.02em;
        margin-bottom: 8px;
    }

    .sub {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--rsdh-text-muted);
    }

    .list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .row {
        display: flex;
        justify-content: space-between;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--rsdh-border);
    }

    .table-wrap {
        overflow-x: auto;
    }

    .table {
        width: 100%;
        border-collapse: collapse;
    }

    .table th {
        text-align: left;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 12px;
        border-bottom: 2px solid var(--rsdh-border);
        color: var(--rsdh-text-muted);
    }

    .table td {
        padding: 16px 12px;
        border-bottom: 1px solid var(--rsdh-border);
    }

    button {
        background: #fff;
        color: #000;
        border: none;
        border-radius: 2px;
        padding: 10px 20px;
        font-weight: 900;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(255, 255, 255, 0.2);
    }

    button.secondary {
        background: transparent;
        color: var(--rsdh-text);
        border: 1px solid var(--rsdh-border);
    }

    .text-accent {
        color: var(--rsdh-accent);
    }
    .text-green {
        color: var(--rsdh-accent-green);
    }
    .font-mono {
        font-family: "JetBrains Mono", monospace;
    }

    .status-pill {
        padding: 4px 10px;
        font-size: 9px;
        font-weight: 900;
        background: rgba(124, 255, 1, 0.1);
    }

    .flex-row {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--rsdh-border);
        border-top-color: var(--rsdh-accent);
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .status-pulsing {
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0% {
            opacity: 1;
        }
        50% {
            opacity: 0.4;
        }
        100% {
            opacity: 1;
        }
    }
</style>
