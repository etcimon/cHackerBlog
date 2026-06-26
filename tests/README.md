# cHackerBlog Test Suite

This directory contains the test suite for cHackerBlog, including end-to-end tests with Puppeteer and unit tests using Jest.

## Test Structure

- `e2e/` - End-to-end tests using Puppeteer
  - `setup.ts` - Test utilities and helpers
  - `article.test.ts` - Article creation and editing tests
  - `wysiwyg.test.ts` - WYSIWYG editor functionality tests
  - `theme.test.ts` - Theme switching tests
  - `feed.test.ts` - Feed and infinite scroll tests

- `unit/` - Unit tests
  - `cache.test.ts` - KV/cache layer tests
  - `logger.test.ts` - Logging service tests

## Running Tests

### Prerequisites

1. Ensure the development server is running:
   ```bash
   bun run dev
   ```

2. Set up environment variables for testing (create `.env.test`):
   ```
   TEST_BASE_URL=http://localhost:3000
   TEST_ADMIN_EMAIL=admin@test.com
   TEST_ADMIN_PASSWORD=admin123
   THEME=hacker
   FEED_EXPANDED_COUNT=2
   CACHE_DRIVER=memory
   LOG_LEVEL=trace
   ```

### Run All Tests

```bash
bun run test
```

### Run Specific Test Files

```bash
# E2E tests
bun run test tests/e2e/article.test.ts
bun run test tests/e2e/wysiwyg.test.ts
bun run test tests/e2e/theme.test.ts
bun run test tests/e2e/feed.test.ts

# Unit tests
bun run test tests/unit/cache.test.ts
bun run test tests/unit/logger.test.ts
```

### Run Tests by Category

```bash
# E2E tests only
bun run test:e2e

# Unit tests only
bun run test:unit
```

### Run Tests with Coverage

```bash
bun run test --coverage
```

## Test Data

The tests use placeholder data that should be seeded in the test database. The seed data includes:

- Default admin user
- Sample articles with various tags
- Sample site settings

## CI/CD Integration

For theme switching tests, you may need to run separate test runs with different `THEME` environment variables:

```bash
THEME=hacker bun run test tests/e2e/theme.test.ts
THEME=medium bun run test tests/e2e/theme.test.ts
THEME=substack bun run test tests/e2e/theme.test.ts
```

## Known Limitations

- Theme switching tests require server restarts with different env vars
- Some E2E tests assume the database is pre-seeded with test data
- File upload tests in WYSIWYG are mocked (actual file upload not tested)
