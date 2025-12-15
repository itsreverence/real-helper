# ✦ RealSports Draft Helper

A powerful **in-browser overlay** for [realsports.io](https://realsports.io) that helps you build optimal draft lineups with AI assistance — all without leaving the site.

![Version](https://img.shields.io/badge/version-0.7.0-blue)
![Svelte](https://img.shields.io/badge/svelte-5-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **Smart Capture** — Automatically detects draft modals and extracts slot multipliers, player pools, and current selections
- **AI-Powered Recommendations** — Send your lineup context to AI (via OpenRouter) for optimal lineup suggestions
- **Web Search Integration** — AI can search the web for real-time player news and injury updates
- **Adaptive Theming** — Automatically picks up accent colors from the current sport tab
- **Structured JSON Responses** — Gets clean, parseable lineup recommendations from AI
- **Modern UI** — Glassmorphism design with smooth animations and responsive layout

## 🚀 Installation

### Quick Install

Install the built userscript directly into [Tampermonkey](https://www.tampermonkey.net/):

1. Install Tampermonkey extension for your browser
2. Open the userscript file: `script/realsports-draft-helper.user.js`
3. Click "Install" when Tampermonkey prompts you

### Build from Source

```bash
cd userscript-svelte
bun install
bun run build:userscript
```

The compiled userscript will be at `script/realsports-draft-helper.user.js`.

## 📖 Usage

1. **Navigate** to [realsports.io](https://realsports.io) and open any Draft Lineup modal
2. **Click** the floating action button (bottom right) to open the helper panel
3. **Capture** your current draft context with the Capture button
4. Either:
   - **Copy Prompt** to paste into ChatGPT/Claude manually, or
   - **Ask AI** to get instant recommendations (requires OpenRouter API key)

### Settings

Configure in the Settings tab:

| Setting | Description |
|---------|-------------|
| **API Key** | Your OpenRouter API key (stored locally, never shared) |
| **Model** | AI model to use (default: `google/gemini-2.5-flash`) |
| **Temperature** | Response creativity (lower = more consistent) |
| **Max Tokens** | Maximum response length |
| **Web Results** | Number of web search results for Ask AI + Web |
| **Structured JSON** | Return parseable lineup recommendations |
| **Response Healing** | Attempt to fix malformed AI responses |

## 🎨 Design

The overlay features a modern dark theme with:

- **Glassmorphism** — Frosted glass effect with backdrop blur
- **Accent Sync** — Automatically matches the current sport's theme color
- **Micro-animations** — Smooth hover states and transitions
- **Custom Typography** — Inter font for clean readability

## 🛠️ Development

```bash
# Install dependencies
bun install

# Development server (for testing components)
bun run dev

# Build userscript
bun run build:userscript

# Type check
bun run typecheck
```

### Project Structure

```
userscript-svelte/
├── src/
│   ├── core/           # Business logic (capture, AI, storage)
│   ├── ui/             # Svelte components and styles
│   ├── uiBridge/       # State management and bridges
│   └── entry-userscript.ts
├── script/             # Built userscript output
└── tools/              # Build utilities
```

## 📄 License

MIT © 2024

