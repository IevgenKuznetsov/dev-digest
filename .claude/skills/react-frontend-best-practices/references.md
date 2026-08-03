# React Frontend Architecture — References

Sources that informed the rules in [SKILL.md](SKILL.md). Organized for citation in documentation.

---

## Official Documentation

- **React — "Thinking in React"**
  https://react.dev/learn/thinking-in-react
  Component hierarchy from data model, minimal state identification, state ownership rules, unidirectional data flow.

- **Next.js — "Project Structure and Organization"**
  https://nextjs.org/docs/app/getting-started/project-structure
  Private folders (`_` prefix), route groups, colocation in `app/`, `src/` folder convention. The authoritative guide for App Router file organization.

- **TanStack Query — "Does This Replace Client State?"**
  https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state
  TanStack Query manages server-state; it complements (not replaces) client-state. Most apps need minimal global state after adopting TQ.

---

## Key Authors

- **Kent C. Dodds — "Colocation"**
  https://kentcdodds.com/blog/colocation
  The foundational article: "Place code as close to where it's relevant as possible." Applies to components, tests, styles, state, and utilities. Informs Rules 1.2, 2.2, 3.2, 5.2.

- **Kent C. Dodds — "AHA Programming"**
  https://kentcdodds.com/blog/aha-programming
  Avoid Hasty Abstractions. Prefer duplication over the wrong abstraction. Wait for patterns to emerge (typically 3rd occurrence) before extracting. Informs the promotion trigger and extraction criteria.

- **Kent C. Dodds — "State Colocation Will Make Your React App Faster"**
  https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
  Decision tree for state placement: local → child → parent → context → global store. Start local, lift only when forced.

- **Dan Abramov — "Writing Resilient Components"**
  https://overreacted.io/writing-resilient-components/
  Four principles: don't stop the data flow, always be ready to render, no component is a singleton, keep local state isolated. Informs business logic boundaries and component independence.

- **Alex Kondov — "Tao of React"**
  https://alexkondov.com/tao-of-react/
  Comprehensive guide to React project organization: component grouping by feature, naming conventions, where helpers and constants live, module boundaries.

---

## Architecture Guides

- **Bulletproof React — Project Structure**
  https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
  Feature-based folder organization (`features/<name>/api|components|hooks|types|utils`), unidirectional dependency flow (`shared → features → app`), ESLint enforcement of import boundaries, direct imports over barrel files.

- **Bulletproof React — Components and Styling**
  https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md
  Colocate resources with components, avoid nested render functions, limit component props, wrap third-party components for adaptability.

- **Feature-Sliced Design**
  https://feature-sliced.design/docs/get-started/overview
  Formal methodology: layers (app → pages → widgets → features → entities → shared), slices (business domain), segments (technical purpose). Strict downward-only dependency between layers, no horizontal imports between slices.

- **Patterns.dev — Container/Presentational Pattern**
  https://www.patterns.dev/react/presentational-container-pattern
  Separation of data-fetching (container) from rendering (presentational). Modern React with Hooks achieves the same separation without wrapper components — the mental model remains valid even when the implementation changes.
