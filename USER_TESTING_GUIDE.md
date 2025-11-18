# User Testing Guide

## 🎯 How End Users Can Test the System

This guide explains how regular users (not admins) can test the TicketDrop waiting room system.

---

## 🚀 Quick Start

1. **Start the services:**
   ```bash
   docker compose up -d
   ```

2. **Start the API:**
   ```bash
   cd api
   npm run dev
   ```

3. **Start the web app:**
   ```bash
   cd web
   npm run dev
   ```

4. **Open your browser** to `http://localhost:5173`

5. **You'll see the User View by default** - a clean, user-friendly interface!

---

## 👤 User View Features

### 1. Browse Events
- See all **public events** (non-draft events)
- Events are displayed in a card grid
- Each card shows:
  - Event name
  - Venue
  - Event date
  - On-sale date

### 2. View Event Details
- Click any event card to see full details
- View:
  - Full event description
  - All ticket tiers with prices
  - Available capacity per tier
  - Event and sale dates

### 3. Join Waiting Room
- Click **"Join Waiting Room"** button on any event
- You'll receive a unique token (stored in browser)
- Status automatically updates every 2 seconds

### 4. Monitor Status
- **Waiting State** (⏳):
  - Shows countdown timer until sale opens
  - Displays exact time when sale will open
  - Auto-refreshes every 2 seconds
  
- **Sale Open State** (🟢):
  - Shows "Sale is Open!" message
  - Indicates tickets are now available

---

## 🧪 Testing Scenarios

### Scenario 1: Event with Future Sale Date
1. Create an event (in Admin View) with `on_sale_at` in the future
2. Set status to `"scheduled"` or `"on_sale"` (not `"draft"`)
3. Switch to User View
4. Click the event
5. Click "Join Waiting Room"
6. **Expected:** See countdown timer showing time until sale opens

### Scenario 2: Event with Past Sale Date
1. Create an event with `on_sale_at` in the past
2. Set status to `"scheduled"` or `"on_sale"`
3. Switch to User View
4. Click the event
5. Click "Join Waiting Room"
6. **Expected:** Immediately see "Sale is Open!" status

### Scenario 3: Multiple Users
1. Open the app in multiple browser tabs/windows
2. Join the same event's waiting room in each
3. **Expected:** Each gets a unique token
4. **Expected:** All see the same countdown (if sale hasn't opened)

### Scenario 4: Draft Events
1. Create an event with status `"draft"`
2. Switch to User View
3. **Expected:** Draft event does NOT appear in the list

---

## 🎨 User Interface

### Event List Page
- Clean, modern card-based layout
- Hover effects on event cards
- Responsive grid (adapts to screen size)
- Empty state message when no events

### Event Detail Page
- Large, readable event information
- Clear ticket tier pricing
- Prominent "Join Waiting Room" button
- Status display with color coding:
  - **Yellow** = Waiting
  - **Green** = Sale Open
  - **Red** = Error

---

## 🔄 Switching Views

- **User View → Admin View:** Click "Admin View" button (top right)
- **Admin View → User View:** Click "User View" button (in header)

The app **starts in User View by default** for the best end-user experience.

---

## 📱 Mobile Friendly

The User View is responsive and works well on:
- Desktop browsers
- Tablets
- Mobile phones

---

## 🐛 Troubleshooting

### "No events available"
- Make sure you've created events with status `"scheduled"` or `"on_sale"` (not `"draft"`)
- Check that the API is running
- Verify events exist in the database

### "Failed to join waiting room"
- Check that Redis is running: `docker compose ps`
- Verify the event exists and is not draft
- Check browser console for errors

### Status not updating
- Check browser console for API errors
- Verify the API server is running
- Check network tab for failed requests

---

## 💡 Tips for Testing

1. **Create test events with different sale dates:**
   - One with sale date in 1 hour (to see countdown)
   - One with sale date in the past (to see "sale open")
   - One with sale date far in future (to test long countdown)

2. **Test in multiple browsers:**
   - Chrome, Firefox, Safari
   - Each browser = different user session

3. **Test the countdown:**
   - Create event with sale date 1-2 minutes in future
   - Watch the countdown update in real-time
   - See it transition from "waiting" to "sale_open"

4. **Test error handling:**
   - Try joining waiting room for a draft event (should fail)
   - Try checking status with invalid token (should show error)

---

## 🎯 What End Users Can Do

✅ Browse all public events  
✅ View event details and ticket tiers  
✅ Join waiting rooms  
✅ See real-time countdown timers  
✅ Monitor when sales open  
✅ See clear status indicators  

❌ Cannot create events (admin only)  
❌ Cannot see draft events  
❌ Cannot access admin features  

---

## 📊 Current Limitations

- No queue positions yet (Feature 3)
- No ticket purchasing yet (Features 5-8)
- No user accounts (uses tokens only)
- Status updates every 2 seconds (not real-time WebSocket)

These will be added in future features!

