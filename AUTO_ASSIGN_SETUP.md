# Auto-Assign Setup Guide

## Issue Identified
The auto-assign functionality is failing because required environment variables are not configured in the Replit environment.

## Required Environment Variables

The auto-assign feature requires the following environment variables to be set:

### 1. OPENAI_API_KEY
- **Purpose**: Required for AI-powered work order assignment
- **How to get**: 
  1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
  2. Create a new API key
  3. Copy the key (starts with `sk-`)

### 2. DATABASE_URL
- **Purpose**: Connection string for Neon Database (PostgreSQL)
- **How to get**:
  1. Go to [Neon Console](https://console.neon.tech/)
  2. Create a new project or use existing one
  3. Copy the connection string from the dashboard

### 3. FULFIL_ACCESS_TOKEN (Optional)
- **Purpose**: Integration with Fulfil system for work order data
- **How to get**: From your Fulfil system administrator

## How to Set Environment Variables in Replit

### Method 1: Using Replit Secrets (Recommended)
1. In your Replit project, click on the "Secrets" tab in the left sidebar
2. Add the following secrets:
   - Key: `OPENAI_API_KEY`, Value: `your_openai_api_key_here`
   - Key: `DATABASE_URL`, Value: `your_neon_database_url_here`
   - Key: `FULFIL_ACCESS_TOKEN`, Value: `your_fulfil_token_here`

### Method 2: Create a .env file
1. Create a `.env` file in the project root:
```bash
OPENAI_API_KEY=your_openai_api_key_here
DATABASE_URL=your_neon_database_url_here
FULFIL_ACCESS_TOKEN=your_fulfil_token_here
```
2. Add `.env` to your `.gitignore` file to keep secrets safe

## Testing the Fix

After setting the environment variables:

1. Restart your Replit project
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Test the auto-assign endpoint:
   ```bash
   curl -X POST http://localhost:5000/api/auto-assign
   ```

## Current Status

✅ **Fixed Issues:**
- Server no longer crashes when environment variables are missing
- Auto-assign provides clear error messages about missing configuration
- Database connection is handled gracefully

❌ **Still Needs Configuration:**
- OpenAI API key for AI functionality
- Neon Database URL for data persistence
- Fulfil token for work order integration

## Next Steps

1. Set up the environment variables as described above
2. Restart the Replit project
3. Test the auto-assign functionality from the dashboard
4. Monitor the console for any additional configuration needs

## Troubleshooting

If you're still experiencing issues:

1. Check the console output for specific error messages
2. Verify your API keys are valid and have sufficient credits
3. Ensure your database URL is correct and the database is accessible
4. Check that all required npm packages are installed (`npm install`)