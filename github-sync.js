#!/usr/bin/env node

/**
 * GitHub Sync Script - Alternative to Git interface
 * Syncs project files to atlaspetco/planner repository via GitHub API
 */

import fs from 'fs';
import path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const REPO_OWNER = 'atlaspetco';
const REPO_NAME = 'planner';

if (!GITHUB_TOKEN) {
  console.error('GITHUB_PERSONAL_ACCESS_TOKEN not found');
  process.exit(1);
}

async function uploadFile(filePath, content) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  
  // Get current file SHA if it exists
  let sha = null;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      sha = data.sha;
    }
  } catch (e) {
    // File doesn't exist, will create new
  }

  const body = {
    message: `Update ${filePath}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha && { sha })
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (response.ok) {
    console.log(`✅ Uploaded: ${filePath}`);
  } else {
    console.error(`❌ Failed to upload ${filePath}:`, await response.text());
  }
}

async function syncProject() {
  console.log('🚀 Starting GitHub sync...');
  
  // Key files to sync
  const filesToSync = [
    'package.json',
    'README.md',
    'replit.md',
    'server/index.ts',
    'server/routes.ts',
    'server/fulfil-current.ts',
    'client/src/App.tsx',
    'client/src/components/dashboard/planning-grid.tsx',
    'client/src/components/dashboard/batch-section.tsx',
    'client/src/components/dashboard/operator-summary.tsx',
    'client/src/pages/uph-analytics.tsx',
    'shared/schema.ts'
  ];

  for (const file of filesToSync) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        await uploadFile(file, content);
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error syncing ${file}:`, error.message);
    }
  }

  console.log('✅ GitHub sync completed!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  syncProject().catch(console.error);
}