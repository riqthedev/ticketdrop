# TypeScript Module Resolution Fix - prom-client Error

## The Error

```
src/metrics.ts(1,20): error TS2307: Cannot find module 'prom-client' or its corresponding type declarations.
```

## Root Cause

### What was happening:
1. **Dependencies location**: All API dependencies (including `prom-client`) were installed in `api/node_modules/`
2. **Source code location**: The actual source code lives in `src/` directory (outside of `api/`)
3. **TypeScript compilation**: When Vercel builds `api/index.ts`, it compiles TypeScript files from `src/`
4. **Module resolution failure**: TypeScript couldn't find `prom-client` because:
   - It was looking in `api/node_modules/` (correct location)
   - But the module resolution wasn't configured to look there when compiling from `src/`
   - Vercel's build process runs from the root, so relative paths to `api/node_modules` weren't resolving correctly

### Why this happened:
- **Directory structure mismatch**: Source code (`src/`) is separate from where dependencies are installed (`api/node_modules/`)
- **Build context**: Vercel's `@vercel/node` runtime compiles TypeScript, but the module resolution context wasn't set up correctly
- **Missing root-level dependencies**: No `package.json` at root level meant Node.js module resolution couldn't find dependencies when building from the root

## The Fix

### Solution 1: Root-level package.json
Created a `package.json` at the root level that includes all API dependencies. This ensures:
- When Vercel builds from the root, `node_modules` at root level contains all dependencies
- TypeScript can resolve modules from root `node_modules/`
- Both `api/node_modules/` and root `node_modules/` are available (Node.js checks both)

### Solution 2: Updated installCommand
Changed `vercel.json` installCommand to:
```json
"installCommand": "npm install && cd api && npm install && cd ../web && npm install"
```

This ensures:
- Dependencies are installed at root level first
- Then in `api/` (for local development)
- Then in `web/` (for frontend)

### Solution 3: TypeScript configuration
Updated `api/tsconfig.json` to include root-level type definitions:
```json
"typeRoots": ["./node_modules/@types", "../node_modules/@types"]
```

This allows TypeScript to find type definitions in both locations.

## Understanding Module Resolution

### How Node.js resolves modules:
1. Checks `node_modules/` in the current directory
2. Walks up the directory tree checking each `node_modules/`
3. Stops at the filesystem root or when found

### How TypeScript resolves modules:
1. Uses the same algorithm as Node.js
2. But respects `tsconfig.json` settings like `baseUrl`, `paths`, `typeRoots`
3. When compiling files outside the `tsconfig.json` location, module resolution can be tricky

### In serverless environments:
- Build happens in an isolated context
- All dependencies must be available at build time
- Module resolution must work from the build root
- TypeScript compilation happens during build, not runtime

## Why This Error Exists

The error protects you from:
- **Missing dependencies**: Ensures all required packages are installed
- **Build-time failures**: Catches issues before deployment
- **Runtime errors**: Prevents "Cannot find module" errors in production

## Warning Signs

### What to look for:
1. **"Cannot find module" errors during build**
   - Usually means dependencies aren't in the right location
   - Or module resolution isn't configured correctly

2. **Source code outside dependency directory**
   - `src/` separate from `api/` where `node_modules/` lives
   - Relative imports that go up directory levels

3. **Build works locally but fails on Vercel**
   - Different module resolution contexts
   - Local has full file system, serverless is isolated

4. **TypeScript compilation errors in build logs**
   - Module resolution issues
   - Missing type definitions

### Code smells:
- Source code in one directory, dependencies in another
- Complex directory structures with nested `node_modules/`
- Relative imports that traverse multiple directory levels
- Build succeeds locally but fails in CI/CD

## Alternatives Considered

### Alternative 1: Move source into `api/` directory
**Pros:**
- Dependencies and source in same location
- Simpler module resolution
- No need for root `package.json`

**Cons:**
- Requires significant refactoring
- Breaks current project structure

### Alternative 2: Use npm workspaces
**Pros:**
- Proper monorepo structure
- Shared dependencies
- Better for large projects

**Cons:**
- More complex setup
- Overkill for this project size
- Requires restructuring

### Alternative 3: Symlink node_modules
**Pros:**
- Keeps current structure
- Dependencies accessible from root

**Cons:**
- Platform-specific (symlinks work differently on Windows)
- Can cause issues in CI/CD
- Not recommended for production

### Alternative 4: Copy node_modules during build
**Pros:**
- Works with current structure

**Cons:**
- Inefficient (duplicates files)
- Can cause conflicts
- Slower builds

**Chosen solution (root package.json) is best because:**
- Minimal changes to existing structure
- Works reliably across platforms
- Standard Node.js module resolution
- Easy to maintain

## Testing the Fix

After deploying, verify:
1. ✅ Build completes without TypeScript errors
2. ✅ Function appears in Vercel dashboard
3. ✅ All endpoints respond correctly
4. ✅ No "Cannot find module" errors in logs

## Files Changed

1. **`package.json`** (new): Root-level package with API dependencies
2. **`vercel.json`**: Updated `installCommand` to install at root first
3. **`api/tsconfig.json`**: Updated `typeRoots` to include root node_modules

## Key Takeaways

1. **Module resolution matters**: When source and dependencies are in different directories, ensure module resolution works from the build root
2. **Serverless is different**: Build context is isolated - all dependencies must be accessible
3. **Root-level dependencies help**: Having dependencies at root level ensures they're accessible during build
4. **TypeScript respects Node.js resolution**: But needs proper configuration when files are outside the tsconfig location

## Prevention

To avoid similar issues:
1. **Keep source and dependencies close**: Or ensure proper module resolution configuration
2. **Test builds locally**: Use `vercel dev` to catch build issues early
3. **Check build logs**: TypeScript errors appear in build logs, not just runtime
4. **Understand your structure**: Know where dependencies are and how they're resolved
5. **Use root package.json**: When source is outside dependency directory, include dependencies at root

