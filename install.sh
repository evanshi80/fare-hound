#!/bin/bash

# Fare Hound - One-click Install Script
# Supported: Ubuntu/Debian, macOS, WSL

set -e

echo "🚀 Installing Fare Hound..."

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux-musl"* ]]; then
    OS="linux"
else
    OS="unknown"
fi

echo "📦 Detected OS: $OS"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    if [[ "$OS" == "macos" ]]; then
        brew install node
    elif [[ "$OS" == "linux" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi

echo "📦 Node.js version: $(node --version)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install Playwright browsers (required for scraping)
echo "🌐 Installing Playwright browsers..."
npx playwright install chromium

echo "✅ Installation complete!"

# Start the service
echo ""
echo "Starting Fare Hound API on http://localhost:3001..."
echo ""

# Run in background with pm2 if available, otherwise run directly
if command -v pm2 &> /dev/null; then
    pm2 start flight_api.js --name fare-hound
    pm2 save
    echo "Service started with pm2. Use 'pm2 status' to check."
else
    node flight_api.js
fi
