# Vercel NOT_FOUND Error - Complete Fix Guide

## 1. The Fix

The primary issue is that Vercel's serverless function at `api/index.ts` imports from `../src/index`, but Vercel's build process may not automatically include the `src/` directory in the function bundle when using relative imports that go outside the function's directory.

### Solution: Update vercel.json Configuration

The `vercel.json` has been updated to ensure proper routing. However, if you're still experiencing issues, the problem might be:

1. **Build-time import resolution failure** - The function can't resolve `../src/index` during build
2. **Runtime import failure** - The function builds but fails at runtime when trying to import
3. **Missing route rewrites** - Some routes aren't properly configured in rewrites

### Immediate Actions:

1. **Verify the function builds correctly:**
   - Check Vercel deployment logs for TypeScript compilation errors
   - Look for "Cannot find module" errors
   - Check if the function appears in the Vercel dashboard

2. **Test the function locally:**
   ```bash
   vercel dev
   ```
   This will help identify if the issue is build-related or deployment-related.

3. **Check environment variables:**
   - Ensure all required environment variables are set in Vercel dashboard
   - Database connection strings (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)
   - Redis connection (REDIS_URL or similar)
   - QR_SECRET and other config values

## 2. Root Cause Analysis

### What was the code actually doing vs. what it needed to do?

**What it was doing:**
- The `api/index.ts` file imports the Express app from `../src/index`
- Vercel's `@vercel/node` runtime compiles TypeScript and bundles the function
- The build process should automatically include all imported files

**What it needed to do:**
- Vercel needs to include the entire `src/` directory in the function bundle
- All imports must be resolvable at build time
- The function must export a handler that Vercel can invoke

### What conditions triggered this specific error?

1. **Build-time failure:** When Vercel tries to build `api/index.ts`, it can't resolve `../src/index` because:
   - The `src/` directory isn't in the function's build context
   - TypeScript compilation fails silently
   - The function never gets created

2. **Runtime failure:** The function builds but fails when imported:
   - Missing dependencies (database, Redis connections fail)
   - Environment variables not set
   - Import path resolution issues at runtime

3. **Routing mismatch:** The function exists but routes don't match:
   - Rewrite rules in `vercel.json` don't match Express routes
   - Path prefixes are incorrect
   - Catch-all route conflicts

### What misconception or oversight led to this?

1. **Assumption about automatic file inclusion:** Assuming that `@vercel/node` would automatically include all files referenced by imports, even when they're outside the function directory
2. **Local vs. production differences:** The code works locally because the file system is available, but serverless functions are isolated
3. **Build process misunderstanding:** Not realizing that Vercel's build process might not include parent directories by default

## 3. Understanding the Concept

### Why does this error exist and what is it protecting me from?

The `NOT_FOUND` error exists because:
- **Security:** Prevents access to non-existent or improperly deployed functions
- **Clarity:** Signals that something is wrong with the deployment configuration
- **Isolation:** Serverless functions are isolated - they can't access arbitrary files on the file system

### What's the correct mental model for this concept?

**Serverless Function Isolation:**
- Each serverless function is a self-contained unit
- All code and dependencies must be bundled at build time
- Files outside the function directory need explicit inclusion
- Imports are resolved at build time, not runtime

**Vercel's Build Process:**
1. Vercel detects functions based on `vercel.json` or file structure
2. For each function, it compiles TypeScript and bundles dependencies
3. Only files that are imported (directly or transitively) are included
4. The function is deployed as an isolated unit

**Routing in Vercel:**
- `rewrites` map incoming requests to functions
- The original path is preserved when forwarding to the function
- Express routes must match the incoming path (not the rewrite destination)

### How does this fit into the broader framework/language design?

**Serverless Architecture:**
- Functions are stateless and isolated
- No persistent file system access
- All code must be bundled at build time
- Cold starts require fast initialization

**TypeScript in Serverless:**
- TypeScript is compiled during build, not at runtime
- Import resolution happens at build time
- Module resolution follows Node.js rules, but in an isolated context

**Express in Serverless:**
- Express apps can run in serverless functions
- The app is exported as a handler
- Vercel's `@vercel/node` wraps the Express app automatically
- Routes work the same as in traditional servers

## 4. Warning Signs

### What should I look out for that might cause this again?

1. **Relative imports outside function directory:**
   ```typescript
   // ⚠️ Warning sign
   import app from '../src/index'; // Goes outside api/ directory
   ```

2. **Build logs showing import errors:**
   - "Cannot find module '../src/index'"
   - "Module not found" errors
   - TypeScript compilation failures

3. **Functions that work locally but fail on Vercel:**
   - Local file system vs. serverless isolation
   - Environment differences

4. **Missing route rewrites:**
   - Routes defined in Express but not in `vercel.json` rewrites
   - Path mismatches between rewrites and Express routes

### Are there similar mistakes I might make in related scenarios?

1. **Importing from parent directories in other serverless platforms:**
   - AWS Lambda, Google Cloud Functions have similar constraints
   - Always bundle code within the function directory

2. **Assuming file system access:**
   - Serverless functions can't read arbitrary files
   - Use environment variables or bundled files instead

3. **Not testing locally with `vercel dev`:**
   - Always test serverless functions locally before deploying
   - Use `vercel dev` to simulate the production environment

4. **Missing environment variables:**
   - Functions might build but fail at runtime
   - Always check Vercel dashboard for environment variables

### What code smells or patterns indicate this issue?

1. **Functions in subdirectories importing from parent:**
   ```typescript
   // api/index.ts
   import something from '../src/...' // ⚠️ Code smell
   ```

2. **Complex directory structures:**
   - Multiple levels of nesting
   - Shared code outside function directories

3. **Build succeeds but function returns 404:**
   - Function builds but isn't accessible
   - Routing configuration issues

4. **"Works on my machine" syndrome:**
   - Code works locally but fails on Vercel
   - Indicates environment or build differences

## 5. Alternatives & Trade-offs

### Alternative 1: Move all code into `api/` directory
**Approach:** Restructure so all code is within the function directory

**Pros:**
- No relative imports outside directory
- Self-contained function
- Clearer structure
- Guaranteed to work with Vercel

**Cons:**
- Requires significant refactoring
- Loses separation of concerns
- Harder to share code with other parts of the project

**When to use:** Small projects or when you want maximum compatibility

### Alternative 2: Use Vercel's automatic function detection
**Approach:** Place functions in `api/` directory and let Vercel auto-detect

**Pros:**
- Simpler configuration
- Less manual setup
- Vercel handles routing automatically

**Cons:**
- Less control over routing
- Might not work with your current structure
- Requires restructuring

**When to use:** New projects or when you can restructure

### Alternative 3: Pre-compile TypeScript before deployment
**Approach:** Compile TypeScript locally and deploy JavaScript

**Pros:**
- More control over build process
- Can catch errors earlier
- Consistent output

**Cons:**
- Additional build step
- More complex CI/CD
- Slower development cycle

**When to use:** When you need fine-grained control over compilation

### Alternative 4: Use a monorepo with proper package structure
**Approach:** Structure as a monorepo with shared packages

**Pros:**
- Better code organization
- Shared dependencies
- More scalable
- Proper module resolution

**Cons:**
- More complex setup
- Requires additional tooling (Turborepo, Nx, etc.)
- Overkill for smaller projects

**When to use:** Large projects or when sharing code across multiple functions

### Alternative 5: Keep current structure but ensure proper build configuration
**Approach:** Keep current structure but ensure Vercel includes all files

**Pros:**
- Minimal changes
- Maintains current architecture
- Works with existing codebase

**Cons:**
- Might require trial and error
- Less predictable
- Depends on Vercel's build process

**When to use:** When you want to minimize changes (current approach)

## Recommended Solution

For your current setup, I recommend **Alternative 5** with the following steps:

1. **Ensure vercel.json is correctly configured** (already done)
2. **Test locally with `vercel dev`** to catch issues early
3. **Check Vercel build logs** for any import resolution errors
4. **Verify all environment variables** are set in Vercel dashboard
5. **If issues persist, consider Alternative 1** (restructure to keep code in `api/`)

## Next Steps

1. Deploy and check build logs in Vercel dashboard
2. Test each endpoint to identify which routes are failing
3. Check function logs for runtime errors
4. Verify database and Redis connections are working
5. Test with `vercel dev` locally to reproduce the issue

## Debugging Checklist

- [ ] Function appears in Vercel dashboard
- [ ] Build logs show no TypeScript errors
- [ ] Build logs show no import resolution errors
- [ ] All environment variables are set
- [ ] Database connection is configured
- [ ] Redis connection is configured
- [ ] Routes are properly defined in `vercel.json`
- [ ] Express routes match the rewrite paths
- [ ] Function logs show requests are reaching the function
- [ ] CORS is configured correctly for your domain

