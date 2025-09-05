#!/bin/bash

echo "🚀 Setting up Cloudinary to S3 Migration Project"
echo "================================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js is installed: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm is installed: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please update it with your credentials."
else
    echo "✅ .env file already exists"
fi

# Create downloads directory
if [ ! -d downloads ]; then
    mkdir downloads
    echo "✅ Downloads directory created"
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update the .env file with your Cloudinary and AWS credentials"
echo "2. Run 'npm run analyze' to analyze your Cloudinary assets"
echo "3. Run 'npm run migrate' to start the migration"
echo "4. Run 'npm run verify' to verify the migration"
echo ""
echo "Available commands:"
echo "  npm run analyze    - Analyze Cloudinary assets"
echo "  npm run migrate    - Run full migration"
echo "  npm run selective  - Run selective migration with options"
echo "  npm run verify     - Verify migration completeness"
echo ""
