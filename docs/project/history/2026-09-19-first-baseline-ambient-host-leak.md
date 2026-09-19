# First Real Baseline Attempt — Ambient Host Configuration Leak

Date: 2026-09-19

## Intent

Run the first unchanged Cloudflare-skill baseline against the synthetic `tenant-documents` fixture using Claude Code in source-only mode.

Invocation constraints:

- model: sonnet
- profile: quick
- max budget: USD 1
- no Bash tool
- no target execution
- answer key excluded from the model workspace
- runner timeout: 900 seconds

## Observation

The runner restricted the model tool set to Read, Glob, Grep, Write, and Agent. Despite that, the Claude Code host spawned an ambient user-configured MCP process (`npm exec @supadata/mcp`) as a child.

No audit artifacts had been produced at the time of detection.

## Decision during the run

The run was cancelled immediately. It is **not** a valid baseline result and is not scored.

Reason: the source-only baseline contract was violated by host-level ambient capabilities even though model-level Bash was disabled.

No retry was performed before changing the adapter.

## Root cause

The initial Claude adapter constrained model tools but did not suppress host-level configuration sources. Claude Code was still loading ambient user MCP/plugin configuration.

This demonstrated that:

> model tool policy and host capability isolation are separate boundaries.

## Corrective action

The adapter must use:

- project-only settings sources in a clean temporary workspace;
- strict empty MCP configuration;
- disabled slash commands / skills;
- disabled Chrome integration;
- no Bash;
- no target-controlled execution.

The model workspace must live outside the repository tree so future project settings cannot be inherited accidentally.

A non-model probe with these flags exposed only Claude Code's built-in agents and no user/plugin agents.

## Evidence treatment

This cancelled attempt is operational evidence, not an audit result:

- no `run-record.json` from the aborted process is promoted as a baseline;
- no finding/coverage score is claimed;
- the reusable lesson is recorded in `LESSONS.md`;
- the next real baseline must run only after the host-isolation regression checks pass.
