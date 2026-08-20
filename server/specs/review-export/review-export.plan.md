# Review Export Endpoint — Implementation Plan

## Overview
Add `GET /reviews/:id/export` endpoint that returns a persisted review (with all its findings) formatted as markdown. This is a READ-ONLY operation that respects workspace scoping.

## Architecture (Onion Layers)

### Layer 1: Route Handler (Presentation)
**File:** `server/src/modules/reviews/routes.ts`

Add new route:
```ts
app.get('/reviews/:id/export', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const markdown = await service.exportReviewAsMarkdown(workspaceId, req.params.id);
  if (!markdown) throw new NotFoundError('Review not found');
  
  // Set Content-Type and Content-Disposition for download
  reply.header('Content-Type', 'text/markdown; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="review-${req.params.id}.md"`);
  return markdown;
});
```

**Responsibilities:**
- Parse route params (reviewId)
- Call context resolution (workspace scoping)
- Handle 404 NotFoundError
- Set markdown headers for browser download
- Return raw markdown string

### Layer 2: Service (Business Logic)
**File:** `server/src/modules/reviews/service.ts`

Add new public method:
```ts
async exportReviewAsMarkdown(workspaceId: string, reviewId: string): Promise<string | null> {
  const review = await this.repo.getReviewWithFindings(workspaceId, reviewId);
  if (!review) return null;
  
  return this.formatReviewMarkdown(review);
}

private formatReviewMarkdown(review: { review: ReviewRow; findings: FindingRow[] }): string {
  // Orchestrate formatting — delegate to formatter
  return this.formatter.format(review);
}
```

**Responsibilities:**
- Workspace-scoped lookup (via repository)
- 404 handling (returns null)
- Delegate formatting to a separate formatter class
- Return markdown string

### Layer 3: Repository (Data Access)
**File:** `server/src/modules/reviews/repository.ts` (or create `repository/export.repo.ts`)

Add method (or update existing):
```ts
async getReviewWithFindings(workspaceId: string, reviewId: string): 
  Promise<{ review: ReviewRow; findings: FindingRow[] } | undefined> {
  // Scope to workspace via PR.workspace_id
  // Single query or 2-query pattern (join reviews → findings)
  // Must enforce workspace boundary
}
```

**Responsibilities:**
- Workspace-scoped data fetch
- Join reviews + findings tables
- Return type-safe row objects

### Layer 4: Formatter (Pure Business Logic)
**File:** `server/src/modules/reviews/formatters/markdown-formatter.ts` (NEW)

Create new formatter class:
```ts
export class MarkdownFormatter {
  format(review: { review: ReviewRow; findings: FindingRow[] }): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`# Review: ${review.review.agent_name || 'Summary'}`);
    lines.push(`**ID:** ${review.review.id}`);
    lines.push(`**Created:** ${review.review.created_at}`);
    lines.push(`**Verdict:** ${review.review.verdict || 'n/a'}`);
    lines.push('');
    
    // Summary
    if (review.review.summary) {
      lines.push('## Summary');
      lines.push(review.review.summary);
      lines.push('');
    }
    
    // Findings
    if (review.findings.length > 0) {
      lines.push(`## Findings (${review.findings.length})`);
      for (const f of review.findings) {
        lines.push(this.formatFinding(f));
      }
    }
    
    // Grounding
    if (review.review.grounding) {
      lines.push('## Grounding');
      lines.push(review.review.grounding);
    }
    
    return lines.join('\n');
  }
  
  private formatFinding(finding: FindingRow): string {
    // Format one finding as a markdown section
    // Include: severity, file, line, title, body, state (accepted/dismissed)
  }
}
```

**Responsibilities:**
- Pure markdown string building
- No DB access, no HTTP
- Format review metadata, summary, findings, grounding
- Include finding state (accepted/dismissed) visually

## Data Contract

### Input
- **Route:** GET `/reviews/:id/export`
- **Params:** `{ id: string }` (reviewId)
- **Auth:** Workspace-scoped (via getContext)

### Output
- **Content-Type:** `text/markdown; charset=utf-8`
- **Body:** Raw markdown string
- **Headers:** `Content-Disposition: attachment; filename="review-{id}.md"`

### Failure Cases
- **404 NotFoundError:** Review not found or workspace mismatch
- **Implicit 401/403:** If getContext fails (no auth/workspace)

## Workspace Scoping
- **getContext** extracts workspaceId from auth
- **Repository.getReviewWithFindings** MUST scope via PR.workspace_id join
- Service passes workspaceId to repo; repo enforces boundary

## Testing Strategy

### Unit Tests (no DB)
- Formatter: test each markdown section (header, findings, grounding)
- Service: mock repo, test null return and formatting delegation

### Integration Tests (Docker + Postgres)
- Full flow: insert review + findings, export, parse markdown, verify content
- Workspace scoping: insert as workspace A, try fetch as workspace B → 404
- Finding states: verify accepted/dismissed markers in output

## Checklist

- [ ] Add route to `routes.ts` with proper schema + headers
- [ ] Add `exportReviewAsMarkdown()` to ReviewService
- [ ] Create/update repository method `getReviewWithFindings()` with workspace scoping
- [ ] Create MarkdownFormatter class with finding formatting
- [ ] Add contract (optional): export schema in `vendor/shared/contracts/review-api.ts` if client will consume
- [ ] Write integration test: happy path + 404 + workspace boundary
- [ ] Write unit tests: formatter sections, service mock
- [ ] Verify no rate limiting needed (read-only, lightweight)
- [ ] Check error handling (NotFoundError path correct)
