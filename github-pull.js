#!/usr/bin/env node

/**
 * GitHub Pull Script - Download updates from atlaspetco/APC-planner repository
 * Fetches files that may have been updated by Codex
 */

import fs from 'fs';
import path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const REPO_OWNER = 'atlaspetco';
const REPO_NAME = 'APC-planner';

if (!GITHUB_TOKEN) {
  console.error('GITHUB_PERSONAL_ACCESS_TOKEN not found');
  process.exit(1);
}

async function downloadFile(filePath) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Check if file content has changed
      let hasChanged = true;
      if (fs.existsSync(filePath)) {
        const currentContent = fs.readFileSync(filePath, 'utf8');
        hasChanged = currentContent !== content;
      }
      
      if (hasChanged) {
        fs.writeFileSync(filePath, content);
        console.log(`📥 Updated: ${filePath}`);
        return true;
      } else {
        console.log(`✅ No changes: ${filePath}`);
        return false;
      }
    } else if (response.status === 404) {
      console.log(`⚠️  Not found: ${filePath}`);
      return false;
    } else {
      console.error(`❌ Failed to download ${filePath}:`, response.status, await response.text());
      return false;
    }
  } catch (error) {
    console.error(`❌ Error downloading ${filePath}:`, error.message);
    return false;
  }
}

async function checkForUpdates() {
  console.log('🔍 Checking for updates from GitHub...');
  
  // Key files that might be updated by Codex
  const filesToCheck = [
    'README.md',
    'replit.md',
    'package.json',
    'server/routes.ts',
    'server/index.ts',
    'server/storage.ts',
    'server/fulfil-current.ts',
    'client/src/components/dashboard/production-grid.tsx',
    'client/src/components/dashboard/operator-dropdown.tsx',
    'client/src/components/dashboard/operator-workload-summary.tsx',
    'client/src/pages/dashboard.tsx',
    'shared/schema.ts'
  ];
  
  let updatedFiles = 0;
  
  for (const filePath of filesToCheck) {
    const wasUpdated = await downloadFile(filePath);
    if (wasUpdated) updatedFiles++;
  }
  
  if (updatedFiles > 0) {
    console.log(`\n🎉 Downloaded ${updatedFiles} updated files from GitHub!`);
  } else {
    console.log('\n✨ All files are up to date');
  }
}

checkForUpdates().catch(console.error);