# Atlas Pet Co Planner - Project Backup

## Project Structure & Key Files

This document serves as a complete backup reference for the manufacturing planning dashboard project.

### Core Configuration Files
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration  
- `vite.config.ts` - Build configuration
- `tailwind.config.ts` - Styling configuration
- `drizzle.config.ts` - Database configuration
- `.replit` - Replit deployment configuration

### Database Schema
- `shared/schema.ts` - Complete database schema with production orders, work orders, operators, UPH data

### Backend Files
- `server/index.ts` - Main server entry point
- `server/routes.ts` - All API endpoints including refresh functionality
- `server/db.ts` - Database connection
- `server/storage.ts` - Data storage interface
- `server/fulfil-api.ts` - Fulfil API integration

### Frontend Files
- `client/src/App.tsx` - Main React application
- `client/src/pages/dashboard.tsx` - Main dashboard page
- `client/src/components/dashboard/` - Dashboard components
  - `planning-grid.tsx` - Main planning interface
  - `filter-controls.tsx` - Filtering and refresh controls
  - `batch-section.tsx` - Batch management interface
  - `summary-cards.tsx` - Summary statistics

### Key Features Implemented
- ✅ Database refresh functionality with foreign key handling
- ✅ Production order and work order management
- ✅ UPH calculation system with work cycles data
- ✅ Operator management and assignment
- ✅ Fulfil API integration with authentication
- ✅ Manufacturing dashboard with planning grid
- ✅ Real-time data synchronization

### Current Database State
- 5 Active Production Orders (MO2025351 through MO2025355)
- 15 Work Orders across Cutting, Sewing, Packaging operations
- 13 Operators with UPH performance data
- Complete Fulfil API field mapping

### Environment Requirements
- PostgreSQL database (DATABASE_URL)
- Fulfil API access token (FULFIL_ACCESS_TOKEN)
- OpenAI API key (OPENAI_API_KEY) for anomaly detection

## GitHub Connection Instructions

Since Git operations are restricted in Replit, here are the manual steps to connect to GitHub:

### 1. Access Replit Shell
Open the Shell tab in Replit and run these commands as the repository owner:

```bash
# Check current Git status
git status

# Add GitHub remote (if not already set)
git remote add origin https://github.com/atlaspetco/planner.git

# Or update existing remote
git remote set-url origin https://github.com/atlaspetco/planner.git

# Stage all files
git add .

# Commit current state
git commit -m "Production planning dashboard - working refresh functionality"

# Push to GitHub
git push -u origin main
```

### 2. For Codex Integration
After pushing to GitHub, you can:
- Clone the repository locally: `git clone https://github.com/atlaspetco/planner.git`
- Use with VS Code + GitHub Copilot
- Set up automated backups via GitHub Actions

### 3. Future Sync Process
To keep GitHub updated with Replit changes:
```bash
git add .
git commit -m "Update: [description of changes]"
git push origin main
```

## Project Status: Ready for GitHub Backup
The project is in a stable, working state with all core functionality implemented and tested.