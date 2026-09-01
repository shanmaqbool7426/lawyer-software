---
name: Clerk setup
description: Workspace-specific lessons for managed Clerk authentication and package installation.
---

Managed Clerk authentication should be provisioned through the workspace auth setup, with browser sessions carried by same-origin cookies and API data routes enforcing the session.

**Why:** The generic package installer targets the monorepo root and refuses workspace dependency changes; package-scoped installs are required for this layout.

**How to apply:** When adding Clerk to a monorepo artifact, provision managed Clerk first, install dependencies with the affected package filter, and keep the health endpoint public while protecting application data.