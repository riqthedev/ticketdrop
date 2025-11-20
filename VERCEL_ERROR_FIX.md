# Vercel FUNCTION_INVOCATION_FAILED Error - Fix & Explanation

## 1. The Fix ✅

**IMPORTANT:** The actual runtime error was an **ESM/CommonJS module compatibility issue**, not connection errors!

### The Real Error (from logs):
```
Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/api/node_modules/uuid/dist-node/index.js 
from /var/task/api/src/routes/waiting-room.js not supported.
```

### Root Cause:
- `uuid` v13.0.0 is **ESM-only** (doesn't support `require()`)
- TypeScript compiles to **CommonJS** (`"module": "commonjs"` in tsconfig.json)
- Vercel compiles `import { v4 as uuidv4 } from 'uuid'` → `require('uuid')`
- ESM modules can't be `require()`'d → **FUNCTION_INVOCATION_FAILED**

### The Fix:
**Downgrade uuid to v9.0.1** (last version that supports CommonJS):
```json
"uuid": "^9.0.1"  // Changed from "^13.0.0"
```

Then run:
```bash
cd api && npm install
```

---

### Additional Fixes (Still Important):

The following fixes are still valuable for production resilience, even though they weren't the immediate cause:

### Changes Made:

1. **Database Connection Error Handling** (`api/src/db/index.ts`)
   - Added try-catch blocks around `query()` and `getClient()` functions
   - Added detailed error logging for connection failures (ECONNREFUSED, ETIMEDOUT)
   - Logs include connection details (host, port) for debugging

2. **Redis Connection Error Handling** (`api/src/redis/index.ts`)
   - Added `enableOfflineQueue: false` to fail fast instead of queuing
   - Added `maxRetriesPerRequest: 3` to limit retry attempts
   - Created `safeRedisOperation()` helper function for graceful error handling
   - Enhanced error logging with connection details

3. **Global Error Handlers** (`api/src/index.ts`)
   - Added `unhandledRejection` handler to catch unhandled promise rejections
   - Added `uncaughtException` handler for synchronous errors
   - Added Express error handler middleware (must be last)
   - Added 404 handler for unknown routes

4. **Rate Limiter Resilience** (`api/src/utils/rateLimiter.ts`)
   - Wrapped Redis operations in try-catch
   - Implements "fail open" strategy: if Redis is unavailable, allow requests
   - Prevents Redis outages from breaking the entire application

### Environment Variables Required in Vercel:

Make sure these are set in your Vercel project settings:

```
DB_HOST=your-database-host
DB_PORT=5432
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
REDIS_HOST=your-redis-host
REDIS_PORT=6379
```

---

## 2. Root Cause Analysis

### The Actual Error: ESM/CommonJS Module Incompatibility

**What Was Happening:**
1. Your code uses: `import { v4 as uuidv4 } from 'uuid'` (ES6 import syntax)
2. TypeScript compiles to CommonJS: `const { v4: uuidv4 } = require('uuid')`
3. `uuid` v13+ is **ESM-only** - it has `"type": "module"` in its package.json
4. Node.js throws `ERR_REQUIRE_ESM` when you try to `require()` an ESM module
5. This happens **at module load time** (before any routes execute)
6. Function crashes → `FUNCTION_INVOCATION_FAILED`

**Why This Happens:**
- **ESM (ES Modules)**: Uses `import/export`, native in modern Node.js
- **CommonJS**: Uses `require/module.exports`, the older Node.js module system
- **They're incompatible**: You can't `require()` an ESM module, and you can't `import()` a CommonJS module in some contexts
- **uuid v13+**: Switched to ESM-only to align with modern JavaScript standards

**The Fix:**
- Use `uuid` v9.0.1 (last version with CommonJS support)
- OR: Switch your entire project to ESM (more complex, requires changing tsconfig.json and package.json)

---

### What Was Happening vs. What Should Happen (Connection Errors - Still Important)

**What Was Happening:**
- When Vercel invoked your serverless function, it would:
  1. Import modules (including `api/src/index.ts`)
  2. Initialize database pool and Redis client at module load time
  3. If database/Redis connections failed (missing env vars, wrong host, timeout), the errors were:
     - **Unhandled promise rejections** from async connection attempts
     - **Uncaught exceptions** from synchronous initialization failures
  4. These unhandled errors caused the function invocation to fail before it could even handle a request

**What Should Happen:**
- Connections should be established lazily (on first use)
- All async operations should have error handling
- Unhandled rejections should be caught and logged
- The function should return a proper error response instead of crashing

### Conditions That Triggered This Error

1. **Missing Environment Variables**: If `DB_HOST`, `REDIS_HOST`, etc. aren't set in Vercel, connections fail
2. **Unreachable Services**: If database/Redis hosts are wrong or unreachable, connection timeouts occur
3. **Connection Timeouts**: Serverless functions have strict timeouts; slow connections can cause failures
4. **Unhandled Promise Rejections**: Any async operation (Redis/database) that fails without a catch block triggers this

### The Misconception

The main misconception was: **"If I handle errors in route handlers, I'm covered."**

**Reality**: In serverless environments:
- Module-level code runs on every cold start
- Unhandled rejections at module load time crash the function before routes are even registered
- Database/Redis connection attempts happen during import, not just during request handling
- Error handling must exist at multiple levels: module initialization, route handlers, and global handlers

---

## 3. Teaching the Concept: ESM vs CommonJS

### Understanding Module Systems

**ESM (ES Modules)** - Modern JavaScript:
```javascript
// ESM syntax
import { v4 as uuidv4 } from 'uuid';
export default function myFunction() { }
```

**CommonJS** - Traditional Node.js:
```javascript
// CommonJS syntax
const { v4: uuidv4 } = require('uuid');
module.exports = function myFunction() { }
```

### Why They're Incompatible

1. **Different Loading Mechanisms:**
   - ESM: Static analysis at compile time, asynchronous loading
   - CommonJS: Dynamic loading at runtime, synchronous

2. **Package.json Declaration:**
   ```json
   // ESM package
   { "type": "module" }
   
   // CommonJS package (default)
   { "type": "commonjs" }  // or omitted
   ```

3. **The Error:**
   ```
   ERR_REQUIRE_ESM: require() of ES Module not supported
   ```
   - You **cannot** use `require()` on an ESM module
   - You **cannot** use `import` in a CommonJS file (without special config)

### How TypeScript Compilation Works

**Your Setup:**
```json
// tsconfig.json
{
  "module": "commonjs",  // ← Compiles to CommonJS
  "target": "ES2022"
}
```

**What Happens:**
```typescript
// Source (TypeScript)
import { v4 as uuidv4 } from 'uuid';

// Compiled (JavaScript)
const { v4: uuidv4 } = require('uuid');  // ← Fails if uuid is ESM!
```

### Solutions

**Option 1: Use CommonJS-Compatible Version (✅ What We Did)**
```json
"uuid": "^9.0.1"  // Last version with CommonJS support
```

**Option 2: Switch to ESM (More Complex)**
```json
// package.json
{ "type": "module" }

// tsconfig.json
{ "module": "ES2022" }  // or "ESNext"
```

**Option 3: Dynamic Import (Works but Awkward)**
```typescript
// Can't use top-level await in CommonJS easily
const { v4: uuidv4 } = await import('uuid');
```

---

## 4. Teaching the Concept: Serverless Error Handling

### Why This Error Exists

`FUNCTION_INVOCATION_FAILED` exists to protect you from:
- **Silent failures**: Without it, your function might appear to work but fail unpredictably
- **Resource leaks**: Unhandled errors can leave connections open, consuming resources
- **Poor user experience**: Users would see generic 500 errors without knowing why

### The Correct Mental Model

Think of serverless functions as **stateless, ephemeral processes**:

1. **Cold Start**: Function container starts fresh → imports modules → initializes connections
2. **Warm Invocation**: Reuses existing container (connections may be reused)
3. **Request Handling**: Routes handle requests → use connections → return responses
4. **Error Propagation**: Errors must be caught at each level or they bubble up and crash the function

```
Module Load → Connection Init → Route Handler → Response
     ↓              ↓                ↓              ↓
  [Errors here]  [Errors here]  [Errors here]  [Errors here]
     ↓              ↓                ↓              ↓
  [Must catch]  [Must catch]  [Must catch]  [Return error]
```

### How This Fits Into Serverless Architecture

**Serverless Design Principles:**
- **Stateless**: Each invocation is independent
- **Fast cold starts**: Minimize initialization work
- **Graceful degradation**: Fail gracefully when dependencies are unavailable
- **Observability**: Log errors for debugging (you can't SSH into the server)

**Connection Management:**
- **Connection pooling**: Reuse connections across invocations (warm containers)
- **Lazy connections**: Don't connect until needed
- **Timeout handling**: Fail fast if connections take too long
- **Error recovery**: Retry with exponential backoff, or fail gracefully

---

## 5. Warning Signs to Recognize This Pattern

### Code Smells That Indicate This Issue

1. **ERR_REQUIRE_ESM Errors** ⚠️ **YOUR ACTUAL ERROR**
   ```typescript
   // ❌ BAD: Using ESM-only package with CommonJS
   import { v4 as uuidv4 } from 'uuid';  // uuid v13+ is ESM-only
   // Compiles to: require('uuid') → ERR_REQUIRE_ESM
   
   // ✅ GOOD: Use CommonJS-compatible version
   "uuid": "^9.0.1"  // Last version with CommonJS support
   
   // OR: Switch entire project to ESM
   // package.json: { "type": "module" }
   // tsconfig.json: { "module": "ES2022" }
   ```

2. **Module-Level Async Operations Without Error Handling**
   ```typescript
   // ❌ BAD: Unhandled rejection if this fails
   const result = await someAsyncOperation();
   
   // ✅ GOOD: Wrapped in try-catch
   try {
     const result = await someAsyncOperation();
   } catch (error) {
     console.error('Operation failed:', error);
   }
   ```

2. **Database/Redis Clients Created at Module Level**
   ```typescript
   // ⚠️ WARNING: If connection fails, module load fails
   const pool = new Pool({ ... });
   const redis = new Redis({ ... });
   
   // ✅ BETTER: Use lazy connections
   const redis = new Redis({ ..., lazyConnect: true });
   ```

3. **Missing Global Error Handlers**
   ```typescript
   // ❌ BAD: Unhandled rejections crash the function
   // (no global handlers)
   
   // ✅ GOOD: Catch all unhandled rejections
   process.on('unhandledRejection', (reason, promise) => {
     console.error('Unhandled rejection:', reason);
   });
   ```

4. **Route Handlers Without Try-Catch**
   ```typescript
   // ❌ BAD: Error bubbles up and crashes function
   router.post('/endpoint', async (req, res) => {
     const result = await db.query('...');
     res.json(result);
   });
   
   // ✅ GOOD: Errors are caught and returned as responses
   router.post('/endpoint', async (req, res) => {
     try {
       const result = await db.query('...');
       res.json(result);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

### Similar Mistakes in Related Scenarios

1. **AWS Lambda**: Same pattern - unhandled rejections cause function failures
2. **Google Cloud Functions**: Module-level errors cause invocation failures
3. **Azure Functions**: Unhandled async errors crash the function
4. **Docker containers**: Similar issues if process crashes on startup

### Patterns to Watch For

- ✅ **Good**: All async operations wrapped in try-catch
- ✅ **Good**: Global error handlers for unhandled rejections
- ✅ **Good**: Lazy connection initialization
- ✅ **Good**: Fail-open strategies for non-critical dependencies (e.g., rate limiting)
- ❌ **Bad**: Module-level await without error handling
- ❌ **Bad**: Assuming route-level error handling is sufficient
- ❌ **Bad**: No global error handlers
- ❌ **Bad**: Synchronous connection attempts at module load

---

## 6. Alternative Approaches & Trade-offs

### Approach 1: Current Fix (Recommended)
**What**: Add error handling at all levels + global handlers

**Pros:**
- Comprehensive coverage
- Graceful degradation
- Good observability (detailed logging)
- Production-ready

**Cons:**
- More code to maintain
- Slightly more verbose

**Use When**: Production applications, critical systems

---

### Approach 2: Connection Wrapper Pattern
**What**: Create wrapper functions that handle all connection errors

```typescript
// Example: Database wrapper
export async function safeQuery<T>(queryFn: () => Promise<T>): Promise<T> {
  try {
    return await queryFn();
  } catch (error) {
    // Handle, log, retry, or fail gracefully
    throw new DatabaseError(error);
  }
}
```

**Pros:**
- Centralized error handling
- Consistent error responses
- Easier to add retry logic

**Cons:**
- Additional abstraction layer
- May hide important error details if not careful

**Use When**: You have many database/Redis operations, want consistent error handling

---

### Approach 3: Circuit Breaker Pattern
**What**: Stop attempting connections after repeated failures

```typescript
// Example: Circuit breaker for Redis
class RedisCircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error('Circuit breaker is open');
    }
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

**Pros:**
- Prevents cascading failures
- Reduces load on failing services
- Automatic recovery

**Cons:**
- More complex implementation
- Requires state management
- May delay recovery

**Use When**: Services are frequently unavailable, you want to prevent thundering herd

---

### Approach 4: Health Check Endpoint
**What**: Create a lightweight health check that doesn't require database/Redis

```typescript
router.get('/health', (req, res) => {
  // Don't check database/Redis here - just return OK
  res.json({ status: 'ok' });
});

router.get('/health/detailed', async (req, res) => {
  // Check database and Redis
  const dbOk = await checkDatabase();
  const redisOk = await checkRedis();
  res.json({ db: dbOk, redis: redisOk });
});
```

**Pros:**
- Fast health checks for load balancers
- Detailed checks for debugging
- Doesn't block on dependencies

**Cons:**
- Doesn't solve the root cause
- Still need error handling elsewhere

**Use When**: You need health checks for monitoring/load balancing

---

### Approach 5: Fail-Open for Non-Critical Features
**What**: Allow the app to work even if Redis/database is down (for non-critical features)

```typescript
// Example: Rate limiting fails open
async function rateLimit(key: string) {
  try {
    return await redis.incr(key);
  } catch (error) {
    // Redis is down - allow all requests (fail open)
    console.warn('Rate limiting unavailable, allowing request');
    return { allowed: true };
  }
}
```

**Pros:**
- High availability
- Graceful degradation
- Better user experience during outages

**Cons:**
- May allow abuse if rate limiting fails
- Need to carefully decide what can fail open

**Use When**: Features are nice-to-have, not critical for core functionality

---

## Summary: Best Practices

1. **Always handle errors at multiple levels**:
   - Global handlers (unhandledRejection, uncaughtException)
   - Route-level handlers (try-catch in route handlers)
   - Operation-level handlers (try-catch around specific operations)

2. **Use lazy connections**:
   - Don't connect at module load time
   - Connect on first use
   - Handle connection failures gracefully

3. **Log everything**:
   - Connection errors with context (host, port, error code)
   - Unhandled rejections with stack traces
   - Route errors with request details

4. **Fail gracefully**:
   - Return proper HTTP error responses
   - Don't crash the function
   - Use fail-open for non-critical features

5. **Test error scenarios**:
   - Missing environment variables
   - Unreachable services
   - Connection timeouts
   - Unhandled rejections

---

## Next Steps

1. **Deploy the fixes** to Vercel
2. **Set environment variables** in Vercel project settings
3. **Monitor logs** in Vercel dashboard to verify errors are handled
4. **Test error scenarios** by temporarily breaking connections
5. **Set up alerts** for unhandled rejections in production

If you continue to see `FUNCTION_INVOCATION_FAILED` errors after these fixes, check:
- Vercel function logs for specific error messages
- Environment variables are set correctly
- Database/Redis hosts are reachable from Vercel's network
- Connection timeouts aren't too aggressive

---

## 7. Deeper Understanding: The Event Loop & Promise Rejection Handling

### How Node.js Handles Unhandled Rejections

**Node.js Event Loop & Promises:**
- When you create a Promise, it's added to the microtask queue
- If a Promise rejects and there's no `.catch()` or `await` in a try-catch, it becomes an "unhandled rejection"
- Node.js emits the `unhandledRejection` event **before** the rejection bubbles up

**The Critical Timing Issue:**
```typescript
// ❌ PROBLEM: This happens at module load time
import redis from './redis';  // Module loads
const pool = new Pool({...}); // Pool tries to connect

// If connection fails here, the rejection happens BEFORE:
// - Routes are registered
// - Express app is ready
// - Any request handlers exist

// Result: FUNCTION_INVOCATION_FAILED
```

**Why `lazyConnect: true` Fixes This:**
```typescript
// ✅ SOLUTION: Defer connection until first use
const redis = new Redis({ lazyConnect: true });

// Module loads successfully ✅
// Connection only happens when you call:
await redis.get('key');  // NOW it connects (inside a route handler with try-catch)
```

### The Serverless Execution Model

**Traditional Server:**
```
Process starts → Connections established → Server listens → Handles requests
     ↓                ↓                        ↓              ↓
  [Once]          [Once]                  [Always]      [Per request]
```

**Serverless Function:**
```
Cold Start → Module Load → Connection Init → Request Handler → Response → Function Ends
     ↓            ↓              ↓                  ↓              ↓           ↓
  [Per cold]   [Per cold]    [Per cold]        [Per request]  [Per req]   [Per req]
```

**Key Insight:** In serverless, **module loading happens on every cold start**, not just once. If module loading fails, the function never gets to handle requests.

### Why Global Handlers Are Essential

**The Error Propagation Chain:**
```
Module-level error
    ↓
Unhandled Promise Rejection
    ↓
process.on('unhandledRejection') ← YOU MUST CATCH HERE
    ↓
(If not caught) → Function crashes → FUNCTION_INVOCATION_FAILED
```

**Your Global Handler:**
```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  // This prevents the function from crashing
  // But you still need to handle the error at the source!
});
```

**Important:** The global handler is a **safety net**, not the primary error handling. You should still handle errors at their source (try-catch in routes, connection wrappers, etc.).

---

## 8. Advanced: Connection Pool Behavior in Serverless

### The Connection Pool Challenge

**Problem:** Connection pools are designed for long-running processes, but serverless functions are ephemeral.

**What Happens:**
1. **Cold Start:** New container → New pool → No connections
2. **First Request:** Pool creates connection → Query executes → Connection stays open
3. **Warm Container:** Next request reuses connection (good!)
4. **Container Idle:** After ~10-15 minutes, container destroyed → Connections closed

**Your Current Setup:**
```typescript
const pool = new Pool({
  connectionTimeoutMillis: 5000,  // ✅ Fail fast
  idleTimeoutMillis: 30000,       // ✅ Close idle connections
});
```

**Why This Works:**
- `connectionTimeoutMillis`: Prevents hanging on connection attempts
- `idleTimeoutMillis`: Closes connections that aren't being used (important for serverless)
- Error handlers: Catch connection failures gracefully

### Redis Connection Strategy

**Your Redis Configuration:**
```typescript
const redis = new Redis({
  lazyConnect: true,        // ✅ Don't connect at module load
  enableOfflineQueue: false, // ✅ Fail fast (don't queue commands)
  maxRetriesPerRequest: 3,   // ✅ Limit retries
  connectTimeout: 5000,      // ✅ Timeout quickly
});
```

**Why `enableOfflineQueue: false`?**
- **Default behavior:** Redis queues commands when disconnected, then executes them when reconnected
- **Problem:** In serverless, if Redis is down, queued commands would execute on the NEXT function invocation (wrong context!)
- **Solution:** Fail fast, handle errors immediately

---

## 9. Testing Your Fixes

### How to Verify the Fixes Work

**1. Test Missing Environment Variables:**
```bash
# Temporarily remove env vars in Vercel
# Function should still load (with errors logged)
# Requests should return 500 with error message (not FUNCTION_INVOCATION_FAILED)
```

**2. Test Unreachable Services:**
```bash
# Point DB_HOST to invalid host
# Function should load, but queries should fail gracefully
# Check logs for connection error messages
```

**3. Test Unhandled Rejections:**
```typescript
// Add this temporarily to a route handler:
router.get('/test-rejection', async (req, res) => {
  Promise.reject(new Error('Test unhandled rejection'));
  // Should be caught by global handler, not crash function
});
```

**4. Monitor Vercel Logs:**
- Look for "Unhandled Rejection" messages (should be logged, not crash)
- Check for connection error logs with context
- Verify requests return proper HTTP error codes (not FUNCTION_INVOCATION_FAILED)

---

## 10. Common Pitfalls to Avoid

### ❌ Pitfall 1: Assuming Global Handlers Are Enough
```typescript
// ❌ BAD: Relying only on global handler
process.on('unhandledRejection', ...);
// No try-catch in routes → Errors still cause issues

// ✅ GOOD: Multi-layer defense
process.on('unhandledRejection', ...);  // Safety net
try {
  await db.query(...);  // Primary error handling
} catch (error) {
  // Handle here
}
```

### ❌ Pitfall 2: Connecting at Module Level
```typescript
// ❌ BAD: Connection happens during import
import { connect } from './db';
await connect();  // Module-level await = unhandled rejection risk

// ✅ GOOD: Lazy connection
const pool = new Pool({ lazyConnect: true });
// Connection happens on first query (inside route handler)
```

### ❌ Pitfall 3: Ignoring Connection Errors
```typescript
// ❌ BAD: Silent failure
redis.on('error', () => {});  // Ignore errors

// ✅ GOOD: Log and handle
redis.on('error', (err) => {
  console.error('Redis error:', err);
  // Don't crash, but log for debugging
});
```

### ❌ Pitfall 4: No Timeout on Connections
```typescript
// ❌ BAD: Hangs forever if service is down
const pool = new Pool({ ... });  // No timeout

// ✅ GOOD: Fail fast
const pool = new Pool({
  connectionTimeoutMillis: 5000,  // Fail after 5 seconds
});
```

---

## 11. Mental Model Summary

**Think of error handling in serverless as a multi-layered defense:**

```
Layer 1: Operation-Level (try-catch around DB/Redis calls)
    ↓ (if error escapes)
Layer 2: Route-Level (try-catch in route handlers)
    ↓ (if error escapes)
Layer 3: Express Error Middleware (catches Express errors)
    ↓ (if error escapes)
Layer 4: Global Handlers (unhandledRejection, uncaughtException)
    ↓ (if error escapes)
Layer 5: Vercel Platform (FUNCTION_INVOCATION_FAILED)
```

**Your goal:** Catch errors at Layer 1-4, never let them reach Layer 5.

**Key Principles:**
1. **Fail Fast:** Timeout quickly, don't hang
2. **Fail Gracefully:** Return HTTP errors, don't crash
3. **Log Everything:** You can't SSH into serverless, logs are your only visibility
4. **Lazy Connections:** Don't connect until needed
5. **Defense in Depth:** Multiple layers of error handling

