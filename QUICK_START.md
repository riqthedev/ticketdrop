# Quick Start Guide

## 🚀 Get Everything Running

### Step 1: Start Docker Services
```bash
docker compose up -d
```

This starts PostgreSQL and Redis.

### Step 2: Initialize Database (First Time Only)
```bash
cd api
npm run db:init
```

### Step 3: Seed Database with Sample Events
```bash
cd api
npm run db:seed
```

This creates 10 sample events (4 basketball games + 6 concerts).

### Step 4: Start API Server
```bash
cd api
npm run dev
```

The API will run on `http://localhost:4000`

### Step 5: Start Web App (in a new terminal)
```bash
cd web
npm run dev
```

The web app will run on `http://localhost:5173`

### Step 6: Open Browser
Go to `http://localhost:5173` and you should see all the events!

---

## ✅ Verify Everything is Working

1. **Check Docker:**
   ```bash
   docker compose ps
   ```
   Should show `db` and `redis` running.

2. **Check API:**
   ```bash
   curl http://localhost:4000/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

3. **Check Events:**
   ```bash
   curl http://localhost:4000/events
   ```
   Should return a JSON array with 10 events.

4. **Check Web App:**
   Open `http://localhost:5173` - you should see the events grid.

---

## 🐛 Troubleshooting

### "Cannot connect to API"
- Make sure the API server is running: `cd api && npm run dev`
- Check that port 4000 is not in use
- Look for errors in the API terminal

### "No events available"
- Run the seed script: `cd api && npm run db:seed`
- Check the database has events: `curl http://localhost:4000/events`

### "Database connection error"
- Make sure Docker is running: `docker compose up -d`
- Check Docker containers: `docker compose ps`
- Restart Docker if needed: `docker compose restart`

### Events not showing in browser
- Open browser console (F12) and check for errors
- Make sure API is running on port 4000
- Check CORS errors in console
- Try refreshing the page

---

## 📝 Common Commands

```bash
# Start everything
docker compose up -d
cd api && npm run dev  # Terminal 1
cd web && npm run dev  # Terminal 2

# Reset database and reseed
cd api
npm run db:init
npm run db:seed

# Check API health
curl http://localhost:4000/health

# List all events
curl http://localhost:4000/events
```

---

## 🎯 What You Should See

1. **User View** (default): Grid of 10 events
2. **Click any event**: See details and join waiting room
3. **Join waiting room**: Get token and see countdown
4. **Admin View**: Click "Admin View" button to see admin panel

---

## 💡 Pro Tips

- Keep the API server running in one terminal
- Keep the web app running in another terminal
- Use `npm run db:seed` anytime to reset and recreate events
- Check browser console (F12) for detailed error messages

