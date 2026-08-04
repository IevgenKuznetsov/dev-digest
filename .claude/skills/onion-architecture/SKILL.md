---
name: onion-architecture
description: "Enforces Onion Architecture patterns for backend modules. Use when designing new feature modules, refactoring toward clean layering, reviewing code for dependency violations, or setting up domain-driven boundaries. Covers four concentric layers (Domain, Application, Infrastructure, Presentation), the dependency rule, DI via composition root, adapter pattern, and testing strategy. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, dependency rule, domain layer, use case, repository interface, composition root."
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 1.0.0
  tags: architecture, onion, clean-architecture, ddd, dependency-injection, layering, backend
---

# Onion Architecture

Architectural guidance for building and maintaining backend feature modules with clean layer separation, inward-pointing dependencies, and testable boundaries.

## When to Use

- Designing a new feature module in `server/src/modules/`
- Refactoring an existing module toward clean layering
- Reviewing PRs for dependency rule violations
- Deciding whether a module needs full onion structure vs simplified CRUD
- Writing tests that benefit from port/adapter isolation
- Resolving coupling between modules

## Quick Reference

| Layer | Responsibility | DevDigest Location | Allowed Dependencies |
|-------|---------------|-------------------|---------------------|
| **Domain** | Entities, value objects, repo interfaces, domain services | `modules/<name>/domain/` or `helpers.ts`, `constants.ts` | Nothing (zero external deps) |
| **Application** | Use cases, DTOs, mappers, orchestration | `modules/<name>/service.ts` | Domain only |
| **Infrastructure** | Drizzle repos, external adapters, DB-row mappers | `modules/<name>/repository.ts`, `adapters/` | Domain, Application |
| **Presentation** | Fastify routes, Zod request schemas, HTTP status codes | `modules/<name>/routes.ts` | Application |

## Core Principles

1. **Dependencies point inward only** -- an inner layer never imports from an outer layer
2. **Domain has zero external dependencies** -- no Drizzle, no Fastify, no npm packages
3. **Inner layers define interfaces (ports); outer layers implement them (adapters)**
4. **The composition root wires everything** -- `platform/container.ts` is the single place that binds concrete implementations to abstract interfaces
5. **Be pragmatic** -- simple CRUD modules (settings, workspace) don't need full onion; apply layering when complexity warrants it

## Recommended Reading Order

**New to Onion Architecture?**
`dependency-rule.md` -> `layer-structure.md` -> `module-structure.md`

**Building a new feature module:**
`module-structure.md` -> `domain-layer.md` -> `application-layer.md` -> `infrastructure-layer.md` -> `presentation-layer.md` -> `dependency-injection.md`

**Refactoring an existing module:**
`anti-patterns.md` -> `layer-structure.md` -> `domain-layer.md` -> `dependency-injection.md`

**Reviewing a PR for architecture compliance:**
`dependency-rule.md` -> `anti-patterns.md`

**Setting up tests:**
`testing-strategy.md` -> `dependency-injection.md`

## How to Use

Read individual rule files for detailed explanations and code examples:

- [rules/dependency-rule.md](rules/dependency-rule.md) - The cardinal rule: dependencies point inward only
- [rules/layer-structure.md](rules/layer-structure.md) - Four layers and their responsibilities
- [rules/domain-layer.md](rules/domain-layer.md) - Entities, value objects, repository interfaces
- [rules/application-layer.md](rules/application-layer.md) - Use cases, DTOs, mappers, orchestration
- [rules/infrastructure-layer.md](rules/infrastructure-layer.md) - Drizzle repos, adapter implementations
- [rules/presentation-layer.md](rules/presentation-layer.md) - Thin Fastify routes, Zod validation
- [rules/dependency-injection.md](rules/dependency-injection.md) - Composition root, Container, test mocking
- [rules/module-structure.md](rules/module-structure.md) - Folder layout, flat vs full onion decision
- [rules/anti-patterns.md](rules/anti-patterns.md) - Common violations with detection heuristics
- [rules/testing-strategy.md](rules/testing-strategy.md) - Testing pyramid enabled by onion layering

## References

1. [Jeffrey Palermo (2008) -- The Onion Architecture Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) -- The original article coining the term
2. [Herberto Graca (2017) -- Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) -- Evolution from Hexagonal/Ports & Adapters
3. [Eric Damtoft -- Onion vs Clean vs Hexagonal](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91) -- Comparison showing they are fundamentally the same concept
4. [Allegro Tech Blog (2023) -- Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) -- Practical best practices, anti-patterns, enforcement strategies
