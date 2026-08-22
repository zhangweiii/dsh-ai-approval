# ADR 0001: Keep the reviewer independent from host execution

- Status: Accepted
- Date: 2026-08-20

## Context

Approval review needs model reasoning, but allowing the reviewer to mutate files, run commands, trigger approvals, or replace host policy would make the review path an execution authority and create a confused deputy.

## Decision

The plugin uses a separately configured LLM route and reviews exactly one pending action. It does not implement tools, modify the sandbox provider, change the host approval vocabulary, or change the session permission preset. The model receives untrusted evidence and must return a strict assessment; only the host can execute the action.

## Consequences

The reviewer can provide useful risk and authorization classification without becoming an executor. It cannot independently inspect missing context, so unavailable or ambiguous inputs fail closed and human approval remains necessary for high-impact actions. Provider isolation and retention are deployment responsibilities.
