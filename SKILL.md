# Fare Hound - Flight Price API

A Playwright-based flight price scraping API that fetches real-time prices from Google Flights.

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/evanshi80/fare-hound.git
cd fare-hound

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Start the API server
node flight_api.js
```

The API runs on `http://localhost:3001`.

## API Endpoints

### GET /price

Main endpoint to search flight prices.

**Required Parameters:**
- `from` - Departure city (e.g., "Toronto")
- `to` - Destination city (e.g., "Tokyo")
- `depart` - Departure date (YYYY-MM-DD format, e.g., "2026-04-10")
- `return` - Return date (YYYY-MM-DD format, e.g., "2026-04-24")

**Optional Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `topBest` | 8 | Number of results from Best tab |
| `topCheapest` | 8 | Number of results from Cheapest tab |
| `maxStops` | 1 | Maximum number of stops allowed |
| `maxDurationHours` | 26 | Maximum flight duration in hours |
| `stopsPenalty` | 220 | CAD penalty added per stop in scoring |
| `durationPenaltyPerHour` | 35 | CAD penalty per hour over 15h in scoring |
| `mode` | "both" | "best", "cheapest", or "both" |
| `headless` | false | Run browser in headless mode |

**Extension 1 - Avoid Airports:**
- `avoidAirports` - Comma-separated list of airport codes to exclude (e.g., "PEK,DOH")

**Extension 2 - Prefer/Avoid Airlines:**
- `preferAirlines` - Comma-separated preferred airlines (e.g., "United,Air Canada")
- `avoidAirlines` - Comma-separated airlines to exclude
- `airlineBias` | 150 | Score reduction for preferred airlines

**Extension 3 - Time Windows:**
- `preferDepartWindow` - Preferred departure time window (e.g., "15:00-23:59")
- `avoidDepartWindow` - Departure time window to avoid (e.g., "00:00-06:00")
- `timeBias` | 120 | Score penalty/bonus for time preferences
- `strictTime` | false | If true, filter out flights instead of penalizing

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "endpoints": ["/price", "/search"],
  "screenshotsDir": "C:\\Users\\lobst\\foxdenlab\\fare-hound\\screenshots",
  "timestamp": "2026-03-04T02:37:55.091Z"
}
```

## Example Requests

### Basic Search
```bash
curl "http://localhost:3001/price?from=Toronto&to=Tokyo&depart=2026-04-10&return=2026-04-24&headless=true"
```

### With Filters
```bash
curl "http://localhost:3001/price?from=Toronto&to=Shanghai&depart=2026-04-10&return=2026-04-24&maxStops=1&avoidAirports=PEK,DOH&headless=true"
```

### With Preferred Airlines
```bash
curl "http://localhost:3001/price?from=Toronto&to=Tokyo&depart=2026-04-10&return=2026-04-24&preferAirlines=United,Air%20Canada&headless=true"
```

### With Time Window
```bash
curl "http://localhost:3001/price?from=Toronto&to=Tokyo&depart=2026-04-10&return=2026-04-24&preferDepartWindow=15:00-23:59&strictTime=true&headless=true"
```

## Response Format

```json
{
  "success": true,
  "query": {
    "from": "Toronto",
    "to": "Tokyo",
    "depart": "2026-04-10",
    "return": "2026-04-24"
  },
  "googleFlightsUrl": "https://www.google.com/travel/flights?q=...",
  "currencyDetected": "CAD",
  "recommended": [
    {
      "totalPrice": 1107,
      "priceText": "CA$1,107",
      "currency": "CAD",
      "durationMinutes": 1155,
      "stops": 1,
      "layoverAirports": ["ORD"],
      "airlinesText": "United, ANA",
      "times": ["1:00 PM", "9:15 PM"],
      "arrivalDayOffset": 1,
      "sourceTab": "Best",
      "score": 1475.75,
      "scoreBreakdown": {
        "base": 1107,
        "stopsPenalty": 220,
        "durationPenalty": 149,
        "timePenalty": 0,
        "airlineBonus": 0
      }
    }
  ],
  "raw": {
    "best": [...],
    "cheapest": [...]
  },
  "filtersApplied": {
    "maxStops": 1,
    "maxDurationHours": 26,
    "avoidAirports": [],
    "avoidAirlines": [],
    "preferAirlines": [],
    "preferDepartWindow": null,
    "avoidDepartWindow": null,
    "strictTime": false
  },
  "scoringConfig": {
    "stopsPenalty": 220,
    "durationPenaltyPerHour": 35,
    "airlineBias": 150,
    "timeBias": 120
  },
  "diagnostics": {
    "tabClicks": { "best": false, "cheapest": true },
    "counts": { "best": 4, "cheapest": 4 },
    "screenshots": { "best": "Best_xxx.png", "cheapest": "Cheapest_xxx.png" },
    "url": "...",
    "totalCollected": 8,
    "afterDedup": 4,
    "afterFilter": 4,
    "filteredTotal": 0
  }
}
```

## Deployment

### Production Deployment Options

**Option 1: Direct Run**
```bash
node flight_api.js
```

**Option 2: PM2 Process Manager**
```bash
npm install -g pm2
pm2 start flight_api.js --name fare-hound
pm2 save
```

**Option 3: Docker**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["node", "flight_api.js"]
```

**Option 4: Systemd Service** (Linux/WSL)
```ini
[Unit]
Description=Fare Hound Flight API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/fare-hound
ExecStart=/usr/bin/node /home/ubuntu/fare-hound/flight_api.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## Architecture

- **flight_api.js** - Express server with Playwright-based web scraper
- Uses headless Chromium to navigate Google Flights
- Captures Best and Cheapest tabs separately
- Applies scoring and filtering to flight results
- Saves screenshots to `screenshots/` directory for debugging

## Key Features

1. **Tab Switching**: Automatically switches between Best and Cheapest tabs
2. **Data Refresh Detection**: Uses fingerprinting to verify tab data changed
3. **Deduplication**: Removes duplicate flights from Best/Cheapest tabs
4. **Filtering**: Supports max stops, max duration, avoid airports, avoid airlines
5. **Scoring**: Computes scores based on price, stops, duration, and preferences
6. **Time Windows**: Supports preferred/avoided departure time windows
7. **Screenshot Capture**: Saves screenshots for debugging

## Troubleshooting

- If screenshots are blank, try running with `headless=false` to see the browser
- If prices are missing, check the screenshots for page loading issues
- If tabs don't switch properly, check browser console logs for errors

## License

MIT
