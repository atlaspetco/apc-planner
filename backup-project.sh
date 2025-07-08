#!/bin/bash

# Production Planning Dashboard Backup Script
# Creates a comprehensive backup of the project for manual GitHub upload

echo "Creating backup of Production Planning Dashboard..."

# Create backup directory with timestamp
BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

# Copy main project files
echo "Copying main project files..."
cp -r client $BACKUP_DIR/
cp -r server $BACKUP_DIR/
cp -r shared $BACKUP_DIR/

# Copy configuration files
echo "Copying configuration files..."
cp package.json $BACKUP_DIR/
cp package-lock.json $BACKUP_DIR/
cp tsconfig.json $BACKUP_DIR/
cp vite.config.ts $BACKUP_DIR/
cp tailwind.config.ts $BACKUP_DIR/
cp components.json $BACKUP_DIR/
cp drizzle.config.ts $BACKUP_DIR/
cp postcss.config.js $BACKUP_DIR/
cp .replit $BACKUP_DIR/

# Copy documentation
echo "Copying documentation..."
cp replit.md $BACKUP_DIR/
cp README.md $BACKUP_DIR/
cp PROJECT_BACKUP.md $BACKUP_DIR/
cp DEPLOYMENT_STATUS.md $BACKUP_DIR/

# Create archive
echo "Creating backup archive..."
tar -czf "${BACKUP_DIR}.tar.gz" $BACKUP_DIR

echo "Backup created: ${BACKUP_DIR}.tar.gz"
echo "This file can be manually uploaded to GitHub repository: atlaspetco/planner"

# List backup contents
echo "Backup contents:"
ls -la $BACKUP_DIR/