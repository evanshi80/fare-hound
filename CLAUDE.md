# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fare-hound is a flight price scraping API that uses Playwright to fetch flight prices from Google Flights.

## Commands

```bash
# Install dependencies
npm install

# Run the API server
node flight_api.js
```

The server runs on `http://localhost:3001`.

## API Endpoints

- `GET /price?from=CITY&to=CITY&depart=DATE&return=DATE` - Single flight price query
- `GET /batch?combinations=[...]` - Batch flight price queries
- `GET /health` - Health check

Example: `http://localhost:3001/price?from=Toronto&to=Shanghai&depart=2026-03-06&return=2026-03-22`

## Architecture

- [flight_api.js](flight_api.js) - Express server with Playwright-based web scraper
- Uses headless Chromium to navigate Google Flights and extract price data
- Returns JSON with flight details and price information

## Dependencies

- `express` - Web framework
- `playwright` - Browser automation for scraping
