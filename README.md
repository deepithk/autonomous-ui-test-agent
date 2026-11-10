# Autonomous UI Test Execution Agent

An AI-powered autonomous UI testing agent using Anthropic Claude API and Microsoft Playwright MCP.

The agent reads GitHub issues, understands acceptance criteria, generates functional test scenarios, explores the target application and executes browser tests autonomously.

## Technology Stack

- TypeScript
- Node.js
- Anthropic Claude API
- Playwright MCP
- GitHub API
- Vitest
- Zod

## Current Development Status

Phase 2: Development Environment and Project Initialization.

The current implementation provides:
- Environment configuration validation.
- Secret redaction.
- Cross-platform filesystem utilities.
- Playwright MCP executable resolution.
- Unit tests for configuration and platform utilities.

Full autonomous execution will be implemented in subsequent phases.

## Prerequisites

- Node.js 24.22+ or 26.13+.
- npm.
- Git.
- Windows 11+ or macOS 14+.

## Installation

Clone the repository:

```bash
git clone <REPOSITORY_URL>
cd autonomous-ui-test-agent
```

Install dependencies:

```bash
npm ci
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure the required credentials in `.env`.

## Build and Test

```bash
npm run build
npm test
```

## Start

```bash
npm start
```

Note: During Phase 2, this command runs a configuration and evidence-directory bootstrap smoke test. Autonomous browser execution will be implemented in later phases.

## Security

- Never commit `.env`.
- Never expose API keys or GitHub tokens.
- Final test evidence will be stored in `/evidence`.