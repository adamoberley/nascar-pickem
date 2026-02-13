#!/bin/bash

# Clear cache script for NASCAR Pick'Em web app
# This clears Vite build cache and node_modules cache

echo "🧹 Clearing web app cache..."

# Clear Vite cache
if [ -d "node_modules/.vite" ]; then
  echo "  ✓ Removing Vite cache..."
  rm -rf node_modules/.vite
fi

# Clear TypeScript build info
if [ -f "tsconfig.app.tsbuildinfo" ]; then
  echo "  ✓ Removing TypeScript build info..."
  rm -f tsconfig.app.tsbuildinfo
fi

if [ -f "tsconfig.node.tsbuildinfo" ]; then
  echo "  ✓ Removing TypeScript node build info..."
  rm -f tsconfig.node.tsbuildinfo
fi

# Clear dist folder if it exists
if [ -d "dist" ]; then
  echo "  ✓ Removing dist folder..."
  rm -rf dist
fi

echo ""
echo "✅ Web cache cleared!"
echo ""
echo "⚠️  IMPORTANT: You still need to clear browser storage:"
echo "   1. Open DevTools (F12)"
echo "   2. Go to Application tab → Storage"
echo "   3. Click 'Clear site data'"
echo "   4. Or manually clear: Local Storage, IndexedDB, Session Storage"
echo ""
echo "   Firebase Auth stores user data in browser IndexedDB/localStorage"
echo "   which cannot be cleared via command line."
